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
      var textarea = document.getElementById("code")
      var from = scope.node.pos - 1;
      var to   = scope.node.end - 1;

      if (textarea.setSelectionRange) {
        textarea.setSelectionRange(from, to);
      } else if(textarea.createTextRange) {
        var rng = textarea.createTextRange();
        rng.moveStart("character",  from );
        rng.moveEnd("character",  to);
        rng.select();
      }
      return false;
    }

    // collapseAll / expandAll use ui-tree's built-in implementation.

}]);
