var goastapp = angular.module('goast', ['ui.tree'], function($rootScopeProvider) {
  $rootScopeProvider.digestTtl(30);
});

// Directive
// ---------
goastapp.directive('fileChange', function () {

    var linker = function ($scope, element, attributes) {
        // onChange, push the files to $scope.files.
        element.bind('change', function (event) {
            var files = event.target.files;
            var file = files && files[0];
            if (!file) return;

            // Read file content into the editor textarea (ng-model="source").
            var reader = new FileReader();
            reader.onload = function () {
                var text = reader.result || "";
                $scope.$apply(function () {
                    $scope.sourcefile = file;
                    $scope.source = text;
                    // Reset previous results; user can click Parse to re-generate AST.
                    $scope.asts = null;
                    $scope.dump = null;
                });

                // If CodeMirror is active, force-update it too (covers async load/init timing).
                try {
                    var editor = $scope.editor || window.__goastEditor;
                    if (editor && typeof editor.setValue === "function") {
                        editor.setValue(text);
                    }
                } catch (e) {
                    // ignore
                }

                // Auto-parse after file load (debounced in controller).
                try {
                    if (typeof $scope.parse === "function") {
                        // Let the controller's debounce schedule handle it (via $watch/editor change).
                        // If editor isn't ready yet, manual parse is still safe later.
                    }
                } catch (e) {
                    // ignore
                }
            };
            reader.onerror = function () {
                $scope.$apply(function () {
                    $scope.sourcefile = file;
                });
                console.error("Failed to read file:", reader.error);
                alert("读取文件失败: " + (reader.error && reader.error.message ? reader.error.message : "unknown error"));
            };
            reader.readAsText(file);
        });
    };

    return {
        restrict: 'A',
        link: linker
    };

});


// Factory
// -------
goastapp.factory('uploadService', ['$rootScope', '$http',  function ($rootScope, $http) {

    return {
        send: function (file, callback) {
            var data = new FormData(),
                xhr = new XMLHttpRequest();

            // When the request starts.
            xhr.onloadstart = function () {
                $rootScope.$emit('upload:loadstart', xhr);
            };

            // When the request has failed.
            xhr.onerror = function (e) {
                $rootScope.$emit('upload:error', e);
            };

            // Send to server
            data.append('sourcefile', file, file.name);
            // xhr.open('POST', '/parse.json');
            // xhr.send(data);
            $http.post('parse.json',data,
            {
                headers:{"Content-type":undefined}
                ,transformRequest: null
            }).success(callback) ;
        }
    };

}]);


// Controller
// ----------
goastapp.controller('GoastController', ['$scope', '$rootScope', 'uploadService', '$http', '$timeout', function ($scope, $rootScope, uploadService, $http, $timeout) {

    // 'file' is a JavaScript 'File' objects.
    $scope.sourcefile = null;

    $scope.asts   = null;
    $scope.dump   = null;
    $scope.source = "package main\n\
\n\
import (\n\
	\"fmt\"\n\
)\n\
\n\
func main() {\n\
	fmt.Printf(\"Hello, Golang\\n\")\n\
}\n\
";

    // CodeMirror (syntax highlighting) setup
    $scope.editor = null;
    $scope._updatingFromEditor = false;
    $scope._updatingFromModel = false;
    $scope._autoParseTimer = null;
    $scope._suppressAutoParse = false;
    $scope._lastParsedSource = null;
    $scope._parseInFlight = false;
    $scope._astRoot = null;
    $scope._astIdCounter = 0;
    $scope._astClickTimer = null;

    function getCurrentSource() {
      var editor = $scope.editor || window.__goastEditor;
      if (editor && typeof editor.getValue === "function") {
        return editor.getValue() || "";
      }
      return $scope.source || "";
    }

    function scheduleAutoParse() {
      // Debounced auto-parse so AST stays up-to-date with editor content.
      if ($scope._suppressAutoParse) return;
      if ($scope._autoParseTimer) {
        $timeout.cancel($scope._autoParseTimer);
        $scope._autoParseTimer = null;
      }
      $scope._autoParseTimer = $timeout(function() {
        $scope._autoParseTimer = null;
        // Avoid re-parsing identical content.
        var src = getCurrentSource();
        if (src === ($scope._lastParsedSource || "")) return;
        // Don't start another parse if one is running; next keystroke will schedule again.
        if ($scope._parseInFlight) return;
        $scope.parse();
      }, 500);
    }

    function ensureEditor() {
      if ($scope.editor) return $scope.editor;
      if (typeof window.CodeMirror === "undefined") return null;

      var textarea = document.getElementById("code");
      if (!textarea) return null;

      document.body.classList.add("goast-has-codemirror");

      var editor = window.CodeMirror.fromTextArea(textarea, {
        mode: "text/x-go",
        theme: "material-darker",
        lineNumbers: true,
        lineWrapping: true,
        indentUnit: 4,
        tabSize: 4,
        viewportMargin: 20, // keep it responsive for big files
      });

      editor.setValue($scope.source || "");

      // Click in editor -> reveal AST node (debounced, avoids firing during drag selection)
      editor.on("mousedown", function(cm, e) {
        if (e && e.button !== 0) return;
        if ($scope._astClickTimer) {
          clearTimeout($scope._astClickTimer);
          $scope._astClickTimer = null;
        }
        $scope._astClickTimer = setTimeout(function() {
          $scope._astClickTimer = null;
          try {
            if (cm.somethingSelected && cm.somethingSelected()) return;
            var cur = cm.getCursor();
            var charIndex = cm.indexFromPos(cur);
            $scope.$applyAsync(function() {
              $scope.revealAstNodeAtCharIndex(charIndex);
            });
          } catch (err) {
            // ignore
          }
        }, 120);
      });

      editor.on("change", function(cm) {
        if ($scope._updatingFromModel) return;
        $scope._updatingFromEditor = true;
        var v = cm.getValue();
        $scope.$applyAsync(function() {
          $scope.source = v;
          $scope._updatingFromEditor = false;
          scheduleAutoParse();
        });
      });

      // expose for other helpers
      window.__goastEditor = editor;
      $scope.editor = editor;
      return editor;
    }

    // Keep editor in sync when model changes from outside (file load / parse result)
    $scope.$watch('source', function(newValue, oldValue) {
      if (newValue === oldValue) return;
      if ($scope._updatingFromEditor) return;
      var editor = ensureEditor();
      if (!editor) return;
      $scope._updatingFromModel = true;
      editor.setValue(newValue || "");
      $scope._updatingFromModel = false;
      scheduleAutoParse();
    });

    // Initialize editor after initial render
    setTimeout(ensureEditor, 0);

    function buildSourceIndex(source) {
      // Builds mapping from UTF-8 byte offset -> JS string index (UTF-16 code units).
      // This makes AST byte positions accurate even with non-ASCII source.
      var maxBytes = 2 * 1024 * 1024; // safety: don't build for extremely huge files

      if (typeof TextEncoder === "undefined") {
        return { byteToCharIndex: null, charToByteIndex: null, source: source || "", maxBytes: maxBytes };
      }

      var s = source || "";
      var byteToCharIndex = null;
      var charToByteIndex = null;
      try {
        var enc = new TextEncoder();
        var bytes = enc.encode(s);
        if (bytes.length > maxBytes) {
          return { byteToCharIndex: null, charToByteIndex: null, source: s, maxBytes: maxBytes };
        }
        byteToCharIndex = new Uint32Array(bytes.length + 1);
        charToByteIndex = new Uint32Array(s.length + 1);
      } catch (e) {
        return { byteToCharIndex: null, charToByteIndex: null, source: s, maxBytes: maxBytes };
      }

      var bytePos = 0;
      for (var i = 0; i < s.length; i++) {
        var startIndex = i;
        charToByteIndex[startIndex] = bytePos;
        var code = s.charCodeAt(i);
        var cp = code;

        // Surrogate pair -> full code point
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) {
          var next = s.charCodeAt(i + 1);
          if (next >= 0xDC00 && next <= 0xDFFF) {
            cp = ((code - 0xD800) << 10) + (next - 0xDC00) + 0x10000;
            // map the 2nd UTF-16 code unit to the same byte position
            charToByteIndex[startIndex + 1] = bytePos;
            i++; // consume low surrogate
          }
        }

        var utf8Len = 1;
        if (cp <= 0x7F) utf8Len = 1;
        else if (cp <= 0x7FF) utf8Len = 2;
        else if (cp <= 0xFFFF) utf8Len = 3;
        else utf8Len = 4;

        for (var b = 0; b < utf8Len; b++) {
          if (bytePos + b >= byteToCharIndex.length) break;
          byteToCharIndex[bytePos + b] = startIndex;
        }
        bytePos += utf8Len;
        if (bytePos >= byteToCharIndex.length) break;
      }

      byteToCharIndex[Math.min(bytePos, byteToCharIndex.length - 1)] = s.length;
      charToByteIndex[s.length] = bytePos;
      return { byteToCharIndex: byteToCharIndex, charToByteIndex: charToByteIndex, source: s, byteLen: bytePos, maxBytes: maxBytes };
    }

    function annotateAstParentsAndIds(root) {
      if (!root) return;
      $scope._astIdCounter = 0;
      (function walk(node, parent) {
        if (!node) return;
        node._parent = parent || null;
        node._id = (++$scope._astIdCounter);
        if (node.children && node.children.length) {
          for (var i = 0; i < node.children.length; i++) {
            walk(node.children[i], node);
          }
        }
      })(root, null);
    }

    function findDeepestNodeContaining(root, byteOffset) {
      if (!root || typeof root.pos !== "number" || typeof root.end !== "number") return null;
      var start = root.pos - 1;
      var end = root.end - 1;
      if (byteOffset < start || byteOffset > end) return null;

      var best = root;
      if (root.children && root.children.length) {
        for (var i = 0; i < root.children.length; i++) {
          var child = root.children[i];
          var cand = findDeepestNodeContaining(child, byteOffset);
          if (cand) {
            var bestSpan = (best.end - best.pos);
            var candSpan = (cand.end - cand.pos);
            if (candSpan <= bestSpan) best = cand;
          }
        }
      }
      return best;
    }

    function pathToRoot(node) {
      var path = [];
      var cur = node;
      while (cur) {
        path.push(cur);
        cur = cur._parent;
      }
      path.reverse();
      return path;
    }

    function getRootNodesScope() {
      var el = document.getElementById("tree-root");
      if (!el) return null;
      return angular.element(el).scope();
    }

    function findNodeScopeByModel(nodesScope, model) {
      if (!nodesScope || !model || typeof nodesScope.childNodes !== "function") return null;
      var nodes = nodesScope.childNodes();
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].$modelValue === model) return nodes[i];
      }
      return null;
    }

    function flashTreeNodeById(id) {
      try {
        var el = document.querySelector('[data-ast-id="' + id + '"]');
        if (!el) return;
        el.classList.remove("goast-tree-flash");
        void el.offsetWidth;
        el.classList.add("goast-tree-flash");
        setTimeout(function() { el.classList.remove("goast-tree-flash"); }, 2900);
      } catch (e) {
        // ignore
      }
    }

    function revealNodeInTree(node) {
      if (!node) return;
      var path = pathToRoot(node);
      var rootNodesScope = getRootNodesScope();
      if (!rootNodesScope) return;

      // Expand each level sequentially using angular-ui-tree's real node scopes.
      (function step(i, nodesScope, triesLeft) {
        triesLeft = (typeof triesLeft === "number") ? triesLeft : 40;
        if (i >= path.length) {
          $timeout(function() {
            var el = document.querySelector('[data-ast-id="' + node._id + '"]');
            if (el && el.scrollIntoView) {
              el.scrollIntoView({ block: "center", inline: "nearest" });
            }
            flashTreeNodeById(node._id);
          }, 0);
          return;
        }

        var model = path[i];
        var nodeScope = findNodeScopeByModel(nodesScope, model);
        if (!nodeScope) {
          if (triesLeft <= 0) return;
          return $timeout(function() { step(i, nodesScope, triesLeft - 1); }, 0);
        }

        if (typeof nodeScope.expand === "function") {
          nodeScope.expand();
        }

        var nextNodesScope = nodeScope.$childNodesScope || nodesScope;
        $timeout(function() { step(i + 1, nextNodesScope, 40); }, 0);
      })(0, rootNodesScope, 40);
    }

    $scope.revealAstNodeAtCharIndex = function(charIndex) {
      if (!$scope._astRoot) return;
      var src = getCurrentSource();
      if (!$scope._sourceIndex || $scope._sourceIndex.source !== (src || "")) {
        $scope._sourceIndex = buildSourceIndex(src || "");
      }
      var byteOffset = charIndex;
      if ($scope._sourceIndex && $scope._sourceIndex.charToByteIndex) {
        var map = $scope._sourceIndex.charToByteIndex;
        var idx = Math.max(0, Math.min(charIndex, map.length - 1));
        byteOffset = map[idx];
      }
      var target = findDeepestNodeContaining($scope._astRoot, byteOffset);
      if (!target) return;
      revealNodeInTree(target);
    };


    // File input is handled by `fileChange` directive using FileReader.
    // (Legacy uploadService/parse.json flow removed to avoid unnecessary network + overwrite.)

    $scope.collapsedLabel = function(scope) {

      if (scope.node.children.length > 0 ) {
        if (scope.collapsed) {
          return "+";
        } else {
          return "−";
        }
      } else {
        return " ";
      }
    }

    var getRootNodesScope = function() {
      return angular.element(document.getElementById("tree-root")).scope();
    };

    $scope.collapseAll = function() {
      var scope = getRootNodesScope();
      scope.collapseAll();
    };

    $scope.expandAll = function() {
      var scope = getRootNodesScope();
      scope.expandAll();
    };

    $scope.parse = async function() {
      // Always parse from the *current editor content*.
      var current = getCurrentSource();
      $scope.source = current;

      if (!current || current.trim() === "") {
        alert("请输入 Go 源代码");
        return;
      }
      
      // 设置源代码到全局变量，WASM 会从这里读取
      window.global.source = current;
      window.source = current; // 也设置到 window，确保兼容性
      
      // 清空之前的输出
      window.output = "";
      
      try {
        $scope._parseInFlight = true;
        if (typeof window.wasmReady === 'undefined' || !window.wasmReady) {
          alert("WASM 模块正在加载中，请稍候...");
          return;
        }

        // Start WASM runtime once (idempotent).
        await window.startWasm();

        // Hint options for big inputs (Go side also has defaults).
        var srcLen = (current || "").length;
        window.goastOptions = window.goastOptions || {};
        if (srcLen > 200000) {
          window.goastOptions.includeDump = false;
          window.goastOptions.includeComments = false;
          window.goastOptions.maxNodes = 25000;
          window.goastOptions.maxDepth = 35;
          window.goastOptions.maxChildren = 200;
          window.goastOptions.maxAttrLen = 140;
        } else {
          window.goastOptions.includeDump = true;
          window.goastOptions.includeComments = true;
        }

        // Parse synchronously via Go-exported function (faster than re-running go.run).
        var out = window.parseGoSource();
        if (!out) out = window.output;
        if (!out) {
          alert("解析失败: 未获取到输出结果");
          return;
        }

        let data = JSON.parse(out);
        
        // 检查是否有错误
        if (data.error) {
          console.error("Parse error:", data.error);
          alert("解析错误: " + data.error);
          return;
        }
        
        $scope._astRoot = data.ast;
        annotateAstParentsAndIds($scope._astRoot);
        $scope.asts   = [data.ast];
        $scope.dump   = data.dump;

        // Build byte->char index once per parse, used for accurate jump (esp. non-ASCII).
        $scope._sourceIndex = buildSourceIndex(current || "");
        $scope._lastParsedSource = current || "";
        
        // 手动触发 Angular 更新
        $scope.$apply();
      } catch (err) {
        console.error("Error parsing source:", err);
        alert("解析错误: " + err.message);
      } finally {
        $scope._parseInFlight = false;
      }
    }

    $scope.toggle = function(scope) {
      scope.toggle();
    };

    $scope.focus = function(scope) {
      var fromByte = scope.node.pos - 1;
      var toByte   = scope.node.end - 1;

      var from = fromByte;
      var to = toByte;
      // Ensure mapping corresponds to current source.
      if (!$scope._sourceIndex || $scope._sourceIndex.source !== ($scope.source || "")) {
        $scope._sourceIndex = buildSourceIndex($scope.source || "");
      }
      if ($scope._sourceIndex && $scope._sourceIndex.byteToCharIndex) {
        var map = $scope._sourceIndex.byteToCharIndex;
        var max = map.length - 1;
        var fb = Math.max(0, Math.min(fromByte, max));
        var tb = Math.max(0, Math.min(toByte, max));
        // Go positions are byte offsets; CodeMirror expects a [from, to) range in char indices.
        // Use tb+1 to make the end exclusive and avoid gaps (especially around spaces/punctuation).
        from = map[fb] || 0;
        var tb1 = Math.max(0, Math.min(toByte + 1, max));
        to = map[tb1] || from;
        if (to < from) to = from;
      }

      // Prefer CodeMirror selection when available
      var editor = $scope.editor || window.__goastEditor;
      if (editor && typeof editor.posFromIndex === "function") {
        var a = editor.posFromIndex(Math.max(0, from));
        var b = editor.posFromIndex(Math.max(0, to));
        editor.focus();
        editor.setSelection(a, b);
        editor.scrollIntoView({ from: a, to: b }, 80);
        // Flash highlight 3 times to draw attention.
        (function flashSelection3Times() {
          try {
            if ($scope._flashClearTimer) {
              clearTimeout($scope._flashClearTimer);
              $scope._flashClearTimer = null;
            }

            // Flash the selection itself (continuous across spaces), instead of markText spans.
            var wrapper = editor.getWrapperElement && editor.getWrapperElement();
            if (!wrapper) return;

            // restart animation
            wrapper.classList.remove("goast-flash-selection");
            // force reflow so animation restarts even when clicking quickly
            void wrapper.offsetWidth;
            wrapper.classList.add("goast-flash-selection");

            // Keep in sync with CSS: 900ms * 3 (+ a small buffer)
            $scope._flashClearTimer = setTimeout(function() {
              wrapper.classList.remove("goast-flash-selection");
              $scope._flashClearTimer = null;
            }, 2900);
          } catch (e) {
            // Don't break navigation if marking fails.
          }
        })();
        return false;
      }

      var textarea = document.getElementById("code");
      if (textarea) {
        if (textarea.setSelectionRange) {
          textarea.setSelectionRange(from, to);
        } else if(textarea.createTextRange) {
          var rng = textarea.createTextRange();
          rng.moveStart("character",  from );
          rng.moveEnd("character",  to);
          rng.select();
        }
      }
      return false;
    }

    // collapseAll / expandAll use ui-tree's built-in implementation.

}]);
