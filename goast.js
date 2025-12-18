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
                $scope.$apply(function () {
                    $scope.sourcefile = file;
                    $scope.source = reader.result || "";
                    // Reset previous results; user can click Parse to re-generate AST.
                    $scope.asts = null;
                    $scope.dump = null;
                });
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
goastapp.controller('GoastController', ['$scope', '$rootScope', 'uploadService', '$http', function ($scope, $rootScope, uploadService, $http) {

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

      editor.on("change", function(cm) {
        if ($scope._updatingFromModel) return;
        $scope._updatingFromEditor = true;
        var v = cm.getValue();
        $scope.$applyAsync(function() {
          $scope.source = v;
          $scope._updatingFromEditor = false;
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
    });

    // Initialize editor after initial render
    setTimeout(ensureEditor, 0);

    function buildSourceIndex(source) {
      // Builds mapping from UTF-8 byte offset -> JS string index (UTF-16 code units).
      // This makes AST byte positions accurate even with non-ASCII source.
      var maxBytes = 2 * 1024 * 1024; // safety: don't build for extremely huge files

      if (typeof TextEncoder === "undefined") {
        return { byteToCharIndex: null, source: source || "", maxBytes: maxBytes };
      }

      var s = source || "";
      var byteToCharIndex = null;
      try {
        var enc = new TextEncoder();
        var bytes = enc.encode(s);
        if (bytes.length > maxBytes) {
          return { byteToCharIndex: null, source: s, maxBytes: maxBytes };
        }
        byteToCharIndex = new Uint32Array(bytes.length + 1);
      } catch (e) {
        return { byteToCharIndex: null, source: s, maxBytes: maxBytes };
      }

      var bytePos = 0;
      for (var i = 0; i < s.length; i++) {
        var startIndex = i;
        var code = s.charCodeAt(i);
        var cp = code;

        // Surrogate pair -> full code point
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) {
          var next = s.charCodeAt(i + 1);
          if (next >= 0xDC00 && next <= 0xDFFF) {
            cp = ((code - 0xD800) << 10) + (next - 0xDC00) + 0x10000;
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
      return { byteToCharIndex: byteToCharIndex, source: s, byteLen: bytePos, maxBytes: maxBytes };
    }


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
      if (!$scope.source || $scope.source.trim() === "") {
        alert("请输入 Go 源代码");
        return;
      }
      
      // 设置源代码到全局变量，WASM 会从这里读取
      window.global.source = $scope.source;
      window.source = $scope.source; // 也设置到 window，确保兼容性
      
      // 清空之前的输出
      window.output = "";
      
      try {
        if (typeof window.wasmReady === 'undefined' || !window.wasmReady) {
          alert("WASM 模块正在加载中，请稍候...");
          return;
        }

        // Start WASM runtime once (idempotent).
        await window.startWasm();

        // Hint options for big inputs (Go side also has defaults).
        var srcLen = ($scope.source || "").length;
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
        
        $scope.asts   = [data.ast];
        $scope.source = data.source;
        $scope.dump   = data.dump;

        // Build byte->char index once per parse, used for accurate jump (esp. non-ASCII).
        $scope._sourceIndex = buildSourceIndex($scope.source || "");
        
        // 手动触发 Angular 更新
        $scope.$apply();
      } catch (err) {
        console.error("Error parsing source:", err);
        alert("解析错误: " + err.message);
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
        from = map[fb] || 0;
        to = map[tb] || from;
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
            if ($scope._flashMarker) {
              $scope._flashMarker.clear();
              $scope._flashMarker = null;
            }

            // If selection is empty, still flash a small range.
            var fromPos = a;
            var toPos = b;
            if (editor.indexFromPos(fromPos) === editor.indexFromPos(toPos)) {
              var idx = editor.indexFromPos(fromPos);
              fromPos = editor.posFromIndex(Math.max(0, idx));
              toPos = editor.posFromIndex(Math.max(0, idx + 1));
            }

            $scope._flashMarker = editor.markText(fromPos, toPos, {
              className: "goast-flash",
              inclusiveLeft: true,
              inclusiveRight: true
            });

            // Total duration matches CSS animation: 450ms * 3 = 1350ms (+ a small buffer)
            $scope._flashClearTimer = setTimeout(function() {
              if ($scope._flashMarker) {
                $scope._flashMarker.clear();
                $scope._flashMarker = null;
              }
              $scope._flashClearTimer = null;
            }, 1450);
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
