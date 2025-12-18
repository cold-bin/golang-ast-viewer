package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"reflect"
	"strings"
)

type Ast struct {
	Label    string            `json:"label"`
	Pos      int               `json:"pos"`
	End      int               `json:"end"`
	Attrs    map[string]string `json:"attrs"`
	Children []*Ast            `json:"children"`
}

type AstConverter interface {
	ToAst() *Ast
}

type ParseOptions struct {
	IncludeDump     bool
	IncludeComments bool

	// Safety limits for huge files/trees (0 means unlimited).
	MaxNodes    int
	MaxDepth    int
	MaxChildren int
	MaxAttrLen  int
}

func DefaultParseOptionsForSource(source string) ParseOptions {
	// Defaults tuned for interactive UI.
	// For small inputs, keep the original behavior (dump+comments, no truncation).
	// For large inputs, prioritize responsiveness: skip dump, drop comments, cap tree size.
	n := len(source)
	if n > 200_000 { // ~200KB
		return ParseOptions{
			IncludeDump:     false,
			IncludeComments: false,
			MaxNodes:        25_000,
			MaxDepth:        35,
			MaxChildren:     200,
			MaxAttrLen:      140,
		}
	}
	return ParseOptions{
		IncludeDump:     true,
		IncludeComments: true,
		MaxNodes:        0,
		MaxDepth:        0,
		MaxChildren:     0,
		MaxAttrLen:      0,
	}
}

func Parse(filename string, source string) (a *Ast, dump string, err error) {
	return ParseWithOptions(filename, source, DefaultParseOptionsForSource(source))
}

func ParseWithOptions(filename string, source string, opt ParseOptions) (a *Ast, dump string, err error) {

	// Create the AST by parsing src.
	fset := token.NewFileSet() // positions are relative to fset
	parseMode := parser.Mode(0)
	if opt.IncludeComments {
		parseMode = parser.ParseComments
	}
	f, err := parser.ParseFile(fset, filename, source, parseMode)
	if err != nil {
		return nil, "", err
	}

	// Print the AST.
	var bf bytes.Buffer
	if opt.IncludeDump {
		ast.Fprint(&bf, fset, f, func(string, reflect.Value) bool {
			return true
		})
	}

	ctx := &buildCtx{opt: opt}
	a, err = BuildAstWithCtx("", f, ctx, 0)
	if err != nil {
		return nil, "", err
	}
	return a, bf.String(), nil
}

type buildCtx struct {
	opt   ParseOptions
	nodes int
}

func BuildAst(prefix string, n interface{}) (astobj *Ast, err error) {
	ctx := &buildCtx{opt: ParseOptions{}}
	return BuildAstWithCtx(prefix, n, ctx, 0)
}

func BuildAstWithCtx(prefix string, n interface{}, ctx *buildCtx, depth int) (astobj *Ast, err error) {
	if ctx != nil {
		if ctx.opt.MaxDepth > 0 && depth > ctx.opt.MaxDepth {
			return &Ast{
				Label:    prefix + " : … (max depth reached)",
				Attrs:    map[string]string{},
				Children: []*Ast{},
			}, nil
		}
		if ctx.opt.MaxNodes > 0 && ctx.nodes >= ctx.opt.MaxNodes {
			return &Ast{
				Label:    prefix + " : … (node limit reached)",
				Attrs:    map[string]string{},
				Children: []*Ast{},
			}, nil
		}
		ctx.nodes++
	}

	v := reflect.ValueOf(n)
	t := v.Type()

	a := Ast{Label: Label(prefix, n), Attrs: map[string]string{}, Children: []*Ast{}}

	if node, ok := n.(ast.Node); ok {
		a.Pos = int(node.Pos())
		a.End = int(node.End())
	}

	if v.Kind() == reflect.Ptr {
		v = v.Elem()
		t = v.Type()
	}

	if !v.IsValid() {
		return nil, nil
	}

	switch v.Kind() {
	case reflect.Array, reflect.Slice:

		limit := v.Len()
		if ctx != nil && ctx.opt.MaxChildren > 0 && limit > ctx.opt.MaxChildren {
			limit = ctx.opt.MaxChildren
		}
		for i := 0; i < limit; i++ {
			f := v.Index(i)

			child, err := BuildAstWithCtx(fmt.Sprintf("%d", i), f.Interface(), ctx, depth+1)
			if err != nil {
				return nil, err
			}
			a.Children = append(a.Children, child)
		}
		if limit < v.Len() {
			a.Children = append(a.Children, &Ast{
				Label:    fmt.Sprintf("… (%d more items truncated)", v.Len()-limit),
				Attrs:    map[string]string{},
				Children: []*Ast{},
			})
		}
	case reflect.Map:
		keys := v.MapKeys()
		limit := len(keys)
		if ctx != nil && ctx.opt.MaxChildren > 0 && limit > ctx.opt.MaxChildren {
			limit = ctx.opt.MaxChildren
		}
		for i := 0; i < limit; i++ {
			kv := keys[i]
			f := v.MapIndex(kv)

			child, err := BuildAstWithCtx(fmt.Sprintf("%v", kv.Interface()), f.Interface(), ctx, depth+1)
			if err != nil {
				return nil, err
			}
			a.Children = append(a.Children, child)
		}
		if limit < len(keys) {
			a.Children = append(a.Children, &Ast{
				Label:    fmt.Sprintf("… (%d more entries truncated)", len(keys)-limit),
				Attrs:    map[string]string{},
				Children: []*Ast{},
			})
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			f := v.Field(i)
			fo := f
			name := t.Field(i).Name

			if f.Kind() == reflect.Ptr {
				f = f.Elem()
			}

			if !f.IsValid() {
				continue
			}

			if _, ok := v.Interface().(ast.Object); !ok && f.Kind() == reflect.Interface {

				switch f.Interface().(type) {
				case ast.Decl, ast.Expr, ast.Node, ast.Spec, ast.Stmt:

					child, err := BuildAstWithCtx(name, f.Interface(), ctx, depth+1)
					if err != nil {
						return nil, err
					}
					a.Children = append(a.Children, child)
					continue
				}
			}

			switch f.Kind() {
			case reflect.Struct, reflect.Array, reflect.Slice, reflect.Map:
				child, err := BuildAstWithCtx(name, fo.Interface(), ctx, depth+1)
				if err != nil {
					return nil, err
				}
				a.Children = append(a.Children, child)

			default:
				val := fmt.Sprintf("%v", f.Interface())
				if ctx != nil && ctx.opt.MaxAttrLen > 0 && len(val) > ctx.opt.MaxAttrLen {
					val = val[:ctx.opt.MaxAttrLen] + "…"
				}
				a.Attrs[name] = val
			}
		}
	}

	return &a, nil
}

func Label(prefix string, n interface{}) string {

	var bf bytes.Buffer

	if prefix != "" {
		fmt.Fprintf(&bf, "%s : ", prefix)
	}
	fmt.Fprintf(&bf, "%T", n)

	v := reflect.ValueOf(n)
	t := v.Type()

	if v.Kind() == reflect.Ptr {
		v = v.Elem()
		t = v.Type()
	}

	if !v.IsValid() {
		return ""
	}

	switch v.Kind() {

	case reflect.Array, reflect.Slice, reflect.Map, reflect.Chan:
		fmt.Fprintf(&bf, "(len = %d)", v.Len())

	case reflect.Struct:
		if v.Kind() == reflect.Struct {
			fs := []string{}
			for i := 0; i < v.NumField(); i++ {
				f := v.Field(i)
				name := t.Field(i).Name
				switch name {
				case "Name", "Kind", "Tok", "Op":
					fs = append(fs, fmt.Sprintf("%s: %v", name, f.Interface()))
				}
			}
			if len(fs) > 0 {
				fmt.Fprintf(&bf, " (%s)", strings.Join(fs, ", "))
			}
		}
	default:
		fmt.Fprintf(&bf, " : %s", n)
	}
	return bf.String()
}
