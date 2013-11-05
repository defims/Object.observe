/*
 * setImmediate polyfill
 * https://github.com/NobleJS/setImmediate
 * this polyfill works on Internet Explorer 6+, Firefox 3+, Webkit, Opera 9.5+, Node.js
 * Web workers in browsers that support MessageChannel will failed
 * the other browsers will fallback to using setTimeout, which means it's always safe to use
 * android 2.3.6 browsers test failed
 */
;(function (global, undefined) {
    "use strict";

    var tasks = (function () {
        function Task(handler, args) {
            this.handler = handler;
            this.args = args;
        }
        Task.prototype.run = function () {
            // See steps in section 5 of the spec.
            if (typeof this.handler === "function") {
                // Choice of `thisArg` is not in the setImmediate spec; `undefined` is in the setTimeout spec though:
                // http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html
                this.handler.apply(undefined, this.args);
            } else {
                var scriptSource = "" + this.handler;
                /*jshint evil: true */
                eval(scriptSource);
            }
        };

        var nextHandle = 1; // Spec says greater than zero
        var tasksByHandle = {};
        var currentlyRunningATask = false;

        return {
            addFromSetImmediateArguments: function (args) {
                var handler = args[0];
                var argsToHandle = Array.prototype.slice.call(args, 1);
                var task = new Task(handler, argsToHandle);

                var thisHandle = nextHandle++;
                tasksByHandle[thisHandle] = task;
                return thisHandle;
            },
            runIfPresent: function (handle) {
                // From the spec: "Wait until any invocations of this algorithm started before this one have completed."
                // So if we're currently running a task, we'll need to delay this invocation.
                if (!currentlyRunningATask) {
                    var task = tasksByHandle[handle];
                    if (task) {
                        currentlyRunningATask = true;
                        try {
                            task.run();
                        } finally {
                            delete tasksByHandle[handle];
                            currentlyRunningATask = false;
                        }
                    }
                } else {
                    // Delay by doing a setTimeout. setImmediate was tried instead, but in Firefox 7 it generated a
                    // "too much recursion" error.
                    global.setTimeout(function () {
                        tasks.runIfPresent(handle);
                    }, 0);
                }
            },
            remove: function (handle) {
                delete tasksByHandle[handle];
            }
        };
    }());

    function canUseNextTick() {
        // Don't get fooled by e.g. browserify environments.
        return typeof process === "object" &&
               Object.prototype.toString.call(process) === "[object process]";
    }

    function canUseMessageChannel() {
        return !!global.MessageChannel;
    }

    function canUsePostMessage() {
        // The test against `importScripts` prevents this implementation from being installed inside a web worker,
        // where `global.postMessage` means something completely different and can't be used for this purpose.

        if (!global.postMessage || global.importScripts) {
            return false;
        }

        var postMessageIsAsynchronous = true;
        var oldOnMessage = global.onmessage;
        global.onmessage = function () {
            postMessageIsAsynchronous = false;
        };
        global.postMessage("", "*");
        global.onmessage = oldOnMessage;

        return postMessageIsAsynchronous;
    }

    function canUseReadyStateChange() {
        return "document" in global && "onreadystatechange" in global.document.createElement("script");
    }

    function installNextTickImplementation(attachTo) {
        attachTo.setImmediate = function () {
            var handle = tasks.addFromSetImmediateArguments(arguments);

            process.nextTick(function () {
                tasks.runIfPresent(handle);
            });

            return handle;
        };
    }

    function installMessageChannelImplementation(attachTo) {
        var channel = new global.MessageChannel();
        channel.port1.onmessage = function (event) {
            var handle = event.data;
            tasks.runIfPresent(handle);
        };
        attachTo.setImmediate = function () {
            var handle = tasks.addFromSetImmediateArguments(arguments);

            channel.port2.postMessage(handle);

            return handle;
        };
    }

    function installPostMessageImplementation(attachTo) {
        // Installs an event handler on `global` for the `message` event: see
        // * https://developer.mozilla.org/en/DOM/window.postMessage
        // * http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#crossDocumentMessages

        var MESSAGE_PREFIX = "com.bn.NobleJS.setImmediate" + Math.random();

        function isStringAndStartsWith(string, putativeStart) {
            return typeof string === "string" && string.substring(0, putativeStart.length) === putativeStart;
        }

        function onGlobalMessage(event) {
            // This will catch all incoming messages (even from other windows!), so we need to try reasonably hard to
            // avoid letting anyone else trick us into firing off. We test the origin is still this window, and that a
            // (randomly generated) unpredictable identifying prefix is present.
            if (event.source === global && isStringAndStartsWith(event.data, MESSAGE_PREFIX)) {
                var handle = event.data.substring(MESSAGE_PREFIX.length);
                tasks.runIfPresent(handle);
            }
        }
        if (global.addEventListener) {
            global.addEventListener("message", onGlobalMessage, false);
        } else {
            global.attachEvent("onmessage", onGlobalMessage);
        }

        attachTo.setImmediate = function () {
            var handle = tasks.addFromSetImmediateArguments(arguments);

            // Make `global` post a message to itself with the handle and identifying prefix, thus asynchronously
            // invoking our onGlobalMessage listener above.
            global.postMessage(MESSAGE_PREFIX + handle, "*");

            return handle;
        };
    }

    function installReadyStateChangeImplementation(attachTo) {
        attachTo.setImmediate = function () {
            var handle = tasks.addFromSetImmediateArguments(arguments);

            // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
            // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
            var scriptEl = global.document.createElement("script");
            scriptEl.onreadystatechange = function () {
                tasks.runIfPresent(handle);

                scriptEl.onreadystatechange = null;
                scriptEl.parentNode.removeChild(scriptEl);
                scriptEl = null;
            };
            global.document.documentElement.appendChild(scriptEl);

            return handle;
        };
    }

    function installSetTimeoutImplementation(attachTo) {
        attachTo.setImmediate = function () {
            var handle = tasks.addFromSetImmediateArguments(arguments);

            global.setTimeout(function () {
                tasks.runIfPresent(handle);
            }, 0);

            return handle;
        };
    }

    if (!global.setImmediate) {
        // If supported, we should attach to the prototype of global, since that is where setTimeout et al. live.
        var attachTo = typeof Object.getPrototypeOf === "function" && "setTimeout" in Object.getPrototypeOf(global) ?
                          Object.getPrototypeOf(global)
                        : global;

        if (canUseNextTick()) {
            // For Node.js before 0.9
            installNextTickImplementation(attachTo);
        } else if (canUsePostMessage()) {
            // For non-IE10 modern browsers
            installPostMessageImplementation(attachTo);
        } else if (canUseMessageChannel()) {
            document.getElementById('debug').innerHTML += 'message channel'
            // For web workers, where supported
            installMessageChannelImplementation(attachTo);
        } else if (canUseReadyStateChange()) {
            // For IE 6–8
            installReadyStateChangeImplementation(attachTo);
        } else {
            // For older browsers
            installSetTimeoutImplementation(attachTo);
        }

        attachTo.clearImmediate = tasks.remove;
    }
}(typeof global === "object" && global ? global : this));




/*
 * Object.definePropery polyfill
 * this polyfill will use VBScript for pure object in ie6,ie7,ie8
 * like https://github.com/defims/avalon/blob/master/avalon.js#L1378
 * 
 */
;(function(){
if (Object.prototype.__defineGetter__ && !Object.defineProperty) {//__defineGetter__
   Object.defineProperty=function(obj,prop,desc) {
      if ("get" in desc) obj.__defineGetter__(prop,desc.get);
      if ("set" in desc) obj.__defineSetter__(prop,desc.set);
   }
}else{
    function doesDefinePropertyWorkOn(obj) {
        try {
            Object.defineProperty(obj, "x", {});
            return "x" in object;
        } catch (e) {
            // returns falsy
        }
    }
    var definePropertyWorksOnObject = doesDefinePropertyWorkOn({}),
        definePropertyWorksOnDom    = typeof document == "undefined" || doesDefinePropertyWorkOn(document.createElement("div"));
    if(!definePropertyWorksOnObject && window.VBArray){//defineProperty works failed on pure object such as ie8
        //use VBscript class
        //document.write('ie6 ie7 ie8');
        //getOwnPropertyDescriptor needed
        //building...
    }else if(!definePropertyWorksOnDom){//webkit dom defineProperty polyfill
        //getOwnPropertyDescriptor
        //building...
    }/*else{
        //document.write('modern'); 
        console.log('mordern')
    }*/
}
})();


/* nestObject2Array is a function used to parse nest Object, tree walker is slower than array walker
 * so use an Array for dirtycheck
 */
function nestObject2Array(obj, parent, key){
    var nodes   = [{key:key, value: obj, length: 0, parent: { key: '', value: parent, length: 0 }}],
        arr     = [],
        k,node,nodeKey;
    while(nodes.length){
        node        = nodes.pop();
        nodeKey     = node.key;
        nodeValue   = node.value;
        arr.push(node);
        if(typeof nodeValue == 'object')
            for(k in nodeValue){
                nodes.push({key: k, value: nodeValue[k], parent: node, length: 0});
                node.length ++;
            }
    }
    return arr;
}
/*test*
var obj = {
    a: {
        b: {
            c: [
                {d:''},
                {d1:true},
                {d2:'',d3:'string'}
            ],
            c1: {},
            c2: null,
            c3: undefined,
            c4: 1,
            c5: 0
        },
        b1: [],
        b2: function(){
        }
    },
    a1: ''
}
var arr = nestObject2Array(obj, window, 'obj');
//console.log(JSON.stringify(arr))

console.log(arr)
//for(var i=0; i<arr.length; i++) console.log(i,JSON.stringify(arr[i]));
var obj1 = 2;
var arr1    = nestObject2Array(obj1, window, 'obj1');
console.log(arr1);

/*
 * observeProperty 
 */
function observeProperty(obj, prop, updates, callback){
    var _value          = obj[prop];
    Object.defineProperty(obj, prop, {
        get: function(){
            //console.log('get')
            return _value;
        },
        set: function(value){//changeobserve
            //console.log('set')
            /*updates.push({
                name: prop,
                object: obj,
                type: 'updated',
                oldValue: _value,
                value: value
            });*/
            var oldValue    = _value;
                o           = {//its a little difference form the
                    name: prop,
                    object: obj,
                    type: 'updated',
                    oldValue: _value
                };
            _value  = value;
            Object.defineProperty(o, 'value', {
                get: function(){
                    return _value;
                },
                set: function(value){
                    _value = value;
                }
            });
            callback(o);
        }
    });
}
/*test*
for(var i=0; i<arr.length; i++){
    var item    = arr[i],
        key     = item.key,
        parent  = item.parent? item.parent.value : window,
        updates = [];

    if(key) observeProperty(parent, key, updates)
}
console.log(JSON.stringify(obj))
console.log(obj.a);
console.log(obj.a1);
obj.a1 = 'hi';
console.log(JSON.stringify(list));
/**/


/*
 * observe its difference from Objcet.observe of the updates array on
 * http://wiki.ecmascript.org/doku.php?id=harmony:observe
 * it use definePropery to detect the change of property, so each change will trigger a callback
 */
function observe(object, callback){
    var arr             = nestObject2Array(object),
        len             = arr.length,
        obj,parent,item,desc,childLen,childArr;
    //console.log('arr:',arr)   
    while(len--){
        item    = arr[len];
        k       = item.key;
        parent  = item.parent? item.parent.value : window;
        var updates = [];
        //setImmediate updates
        if(k) observeProperty(parent, k, updates, callback);
    }

    //setImmediate new property detect
    function detectNewProp(){
        //document.getElementById('debug').innerHTML += 'detect<br/>'
        len = arr.length;
        //handle root item
        while(len--){
            item    = arr[len];
            if(item){
                obj     = item.value;
                k       = item.key;
                parent  = item.parent? item.parent.value : window;
                if(parent && !parent[k]) {//trigger delete
                    callback({
                        name: k,
                        object: parent,
                        type: 'delete',
                        oldValue: item.value
                    });
                    delete arr[len];
                }
                if(typeof(obj) == 'object'){
                    for(k in obj){//only works on Object
                        if(obj.hasOwnProperty(k) ){//ignore prototype
                            desc        = Object.getOwnPropertyDescriptor(obj, k);
                            if(!desc.get && !desc.set){//detect new prop
                                childArr    = nestObject2Array(obj[k], obj, k);
                                childLen    = childArr.length;
                                while(childLen--){
                                    var updates = [],
                                        o       = childArr[childLen],
                                        ok      = o.key,
                                        ov      = o.value,
                                        op      = o.parent ? o.parent.value : obj;
                                    //trigger new
                                    callback({
                                        name: ok,
                                        object: op,
                                        type: 'new',
                                        oldValue: '',
                                        value: ov
                                    });
                                    observeProperty(op, ok, updates, callback);
                                }
                                arr = arr.concat(childArr);
                            }
                        }
                    }
                }
            }
        }
        //console.log('\n')
        var id = setImmediate(detectNewProp);
        //setTimeout(detectNewProp,0)
    };
    var id = setImmediate(detectNewProp);
    //setTimeout(detectNewProp,2000)
    //detectNewProp();
}

/*test*
var obj = {
    a: {
        b: {
            c: [
                {d:''},
                {d1:true},
                {d2:'',d3:'string'}
            ],
            c1: {},
            c2: null,
            c3: undefined,
            c4: 1,
            c5: 0
        },
        b1: [],
        b2: function(){
        }
    },
    a1: ''
}

observe(obj,function(change){
    console.log(change)
})
//console.log(JSON.stringify(obj))
//console.log(obj.a);
//console.log(obj.a1);
obj.a1 = 'hi';
obj.a1 = 'ok';
obj.a2 = '1'
setTimeout(function(){
    obj.a1 = 'dd';
},100);
/**
var obj1    = {
    a: 0
};
observe(obj1,function(change){
    console.log(change,change.object[change.name],change.value);
})
obj1.a=3
obj1.b=5
obj1.c={a:1}
delete obj1.a
setTimeout(function(){
    obj1.d = 1;
},1000)
setTimeout(function(){
    obj1.d = {d:0};
},1500)
/**/
