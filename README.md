observe.js
==============

##How it works?
it use defineProperty to detect property changes, so it will set defineProperty for all properties
for exists properties, direct use defineProperty method
for new properties, setImmediate is used
there is a setImmediate polyfill and a defineProperty polyfill included



##Browsers support
it's base on setImmediate and defineProperty

 * Internet Explorer 8+
 * Firefox 3+
 * WebKit
 * Opera 9.5+
 * Node.js
 * Web workers in browsers that support `MessageChannel`, which I can't find solid info on.

##difference between strawman:observe
it's a little different from http://wiki.ecmascript.org/doku.php?id=strawman:observe 
Objece.observe trigger with a changes Array and will fire each time after the browser parse javascript
defineProperty will trigger when you get or set the object

##Usage

    var obj1    = {
        a: 0
    };
    observe(obj1,function(change){
        console.log(change,change.object[change.name],change.value);
    })
    obj1.a=3
    obj1.b=5
    obj1.c={a:1}
    setTimeout(function(){
        obj1.d = 1;
    },1000)
    setTimeout(function(){
        obj1.d = {d:0};
    },1500)

##routemap
add ie6 ie7 ie8 defineProperty support reference https://github.com/defims/avalon/blob/master/avalon.js#L1378

