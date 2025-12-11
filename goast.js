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
            $scope.$apply(function () {
                 $scope.sourcefile = files[0];
            });
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


    $scope.$watch('sourcefile', function (newValue, oldValue) {
        // Only act when our property has changed.
        if (newValue != oldValue) {
            // Hand file off to uploadService.
            uploadService.send($scope.sourcefile,function(data, status, headers, config) {
              $scope.asts   = [data.ast];
              $scope.source = data.source;
              $scope.dump   = data.dump;
            });
        }
    }, true);

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

    $scope.parse = async function() {
      console.log("Parse button clicked, source:", $scope.source);
      
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
        // 检查 WASM 是否就绪
        if (typeof window.wasmReady === 'undefined' || !window.wasmReady) {
          alert("WASM 模块正在加载中，请稍候...");
          return;
        }
        
        console.log("Starting WASM execution...");
        // 等待 WASM 执行完成
        await window.run();
        
        console.log("WASM execution finished, checking output...");
        
        // 从全局变量读取输出
        if (typeof window.output === 'undefined' || window.output === "") {
          console.error("Output not found or empty. Make sure WASM module set the 'output' global variable.");
          alert("解析失败: 未获取到输出结果");
          return;
        }
        
        console.log("Output received:", window.output);
        let data = JSON.parse(window.output);
        
        // 检查是否有错误
        if (data.error) {
          console.error("Parse error:", data.error);
          alert("解析错误: " + data.error);
          return;
        }
        
        $scope.asts   = [data.ast];
        $scope.source = data.source;
        $scope.dump   = data.dump;
        
        console.log("AST parsed successfully:", data);
        
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

}]);
