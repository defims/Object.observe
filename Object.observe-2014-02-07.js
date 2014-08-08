(function(){
    /*ObservableObject.prototype  = objectElement.dataset;

    Object.defineProperty(objectElement.dataset, 'f', {
        get: function(){
            console.log('get')
        },
        set: function(){
            console.log('set')
        }
    })*/

/*    ObservableObject.prototype = {
        'f': 'fo'
    }
*/

    function ObservableObject(obj, callback){
        //console.log(obj, callback)
        //var originObj       = obj;
        var objectElement   = document.createElement('div'),
            obj             = objectElement.dataset;
        Object.defineProperty(objectElement.dataset,'a',{
            get: function(){
                console.log('get')
            },
            set: function(){
                console.log('set')
            }
        })
        objectElement.addEventListener('DOMSubtreeModified',function(){
            console.log('change',arguments)
            //detect new delete not change
            //new
            /*Object.defineProperty(objectElement, 'data-a', {
                get: function(){
                    console.log('get')
                },
                set: function(){
                    console.log('set')
                }
            });*/
        });
        document.body.appendChild(objectElement)
        return obj
    }

    function ObjectObserve(prop, callback){
        eval(prop+"= new ObservableObject("+prop+",callback)")
    }
    window.ObjectObserve = ObjectObserve;
})()
