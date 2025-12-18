package main

import (
	"strings"
	"testing"
)

func countAstNodes(n *Ast) int {
	if n == nil {
		return 0
	}
	c := 1
	for _, ch := range n.Children {
		c += countAstNodes(ch)
	}
	return c
}

func TestParseWithOptions_LargeSourceIsCappedAndDumpDisabled(t *testing.T) {
	var b strings.Builder
	b.Grow(400_000)
	b.WriteString("package main\n\nfunc main() {\n")
	// Make a large, repetitive function body.
	for i := 0; i < 60_000; i++ {
		b.WriteString("var _ = 1\n")
	}
	b.WriteString("}\n")
	src := b.String()

	opt := DefaultParseOptionsForSource(src)
	if opt.IncludeDump {
		t.Fatalf("expected IncludeDump=false for large source")
	}
	if opt.IncludeComments {
		t.Fatalf("expected IncludeComments=false for large source")
	}
	if opt.MaxNodes <= 0 || opt.MaxDepth <= 0 || opt.MaxChildren <= 0 || opt.MaxAttrLen <= 0 {
		t.Fatalf("expected limits to be enabled for large source, got %+v", opt)
	}

	a, dump, err := ParseWithOptions("foo.go", src, opt)
	if err != nil {
		t.Fatalf("ParseWithOptions failed: %v", err)
	}
	if a == nil {
		t.Fatalf("expected ast != nil")
	}
	if dump != "" {
		t.Fatalf("expected dump to be disabled for large source")
	}

	// Ensure we didn't build an unbounded tree.
	nodes := countAstNodes(a)
	if nodes > opt.MaxNodes+50 {
		t.Fatalf("expected node count to be capped (<= %d), got %d", opt.MaxNodes+50, nodes)
	}
}
