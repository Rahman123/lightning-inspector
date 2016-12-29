//*** Used by Aura Inspector
// This is injected in the DOM directly via <script> injection
(function(global){
    var $Aura = {};
    $Aura.actions = {
        "AuraDevToolService.HighlightElement": function(globalId) {
            // Ensure the classes are present that HighlightElement depends on.
            if(!$Aura.actions["AuraDevToolService.AddStyleRules"].addedStyleRules) {
                $Aura.actions["AuraDevToolService.AddStyleRules"](globalId);
                $Aura.actions["AuraDevToolService.AddStyleRules"].addedStyleRules = true;
            }

            var className = "auraDevToolServiceHighlight3";
            var previous = document.getElementsByClassName(className);
            for(var d=previous.length-1,current;d>=0;d--){
                current = previous[d];
                current.classList.remove(className);
                current.classList.remove("auraDevToolServiceHighlight4");
            }

            // Apply the classes to the elements
            if(globalId) {
                var cmp = $A.getCmp(globalId);
                if(cmp && cmp.isValid()) {
                    var elements = cmp.getElements();
                    // todo: add classes to elements
                    for(var c=0,length=elements.length;c<length;c++) {
                        if(elements[c].nodeType === 1){
                            elements[c].classList.add(className);
                        }
                    }
                }
            }
        },

        "AuraDevToolService.RemoveHighlightElement": function() {
            var removeClassName = "auraDevToolServiceHighlight3";
            var addClassName = "auraDevToolServiceHighlight4";
            var previous = document.getElementsByClassName(removeClassName);
            for(var d=previous.length-1;d>=0;d--){
                previous[d].classList.add(addClassName);
                //previous[d].classList.remove(removeClassName);
            }

        },

        "AuraDevToolService.AddStyleRules": function(globalId) {
            var styleRuleId = "AuraDevToolService.AddStyleRules";

            // Already added
            if(document.getElementById(styleRuleId)) { return; }

            var rules = `
                .auraDevToolServiceHighlight3:before{
                   position:absolute;
                   display:block;
                   width:100%;
                   height:100%;
                   z-index: 10000;
                   background-color:#006699;
                   opacity:.3;
                   content:' ';
                   border : 2px dashed white;
                }
                .auraDevToolServiceHighlight4.auraDevToolServiceHighlight3:before {
                   opacity: 0;
                   transition: opacity 2s;
                }
            `;

            var style = document.createElement("style");
                style.id = styleRuleId;
                style.textContent = rules;
                style.innerText = rules;

            var head = document.head;
                head.appendChild(style);


            document.body.addEventListener("transitionend", function removeClassHandler(event) {
                var removeClassName = "auraDevToolServiceHighlight3";
                var addClassName = "auraDevToolServiceHighlight4";
                var element = event.target;
                element.classList.remove(removeClassName);
                element.classList.remove(addClassName);
            });
        },
        /**
         * Is called after $A is loaded via aura_*.js, but before we run initAsync()
         */
        "AuraDevToolService.Bootstrap": function() {
            if (typeof $A !== "undefined" && $A.initAsync) {
                // Try catches for branches that don't have the overrides
                // This instrument is where we add the methods _$getRawValue$() and _$getSelfGlobalId$() to the
                // component prototype. This allowed us to move to outputing the component from injected code, vs code in the framework.
                // Would be nice to get rid of needing this.
                try {
                    $A.installOverride("outputComponent", function(){});
                } catch(e){}

                try {
                    // Counts how many times various things have happened.
                    bootstrapCounters();
                } catch(e){}

                try {
                    // Actions Tab
                    bootstrapActionsInstrumentation();
                 } catch(e){
                 }
                 try {
                    // Perf Tab
                    bootstrapPerfDevTools();
                 } catch(e){

                 }
                 try {
                    // Events Tab
                    bootstrapEventInstrumentation();
                } catch(e){}

                try {
                    bootstrapTransactionReporting();
                } catch(e){}

                // Currently in progress to get this going. Its work to be able to show the URL for the XHR in the transactions panel.
                // try {
                //     $A.installOverride("ClientService.decode", function(config, oldResponse, noStrip,timedOut){
                //         var transport = $A.metricsService.getCurrentMarks().transport;
                //         // get last
                //         var latest = transport[transport.length-1];
                //         latest[Symbol.for("url")] = oldReponse.responseUrl;

                //         var ret = config["fn"].call(config["scope"], oldResponse, noStrip, timedOut);

                //         return ret;
                //     });
                // }catch(e) {}

                // Need a way to conditionally do this based on a user setting.
                $A.PerfDevTools.init();

                window.postMessage({
                    "action": "AuraInspector:bootstrap",
                    "key":"AuraInspector:bootstrap",
                    "data": "InjectedScript: AuraDevToolService.Bootstrap()"
                }, window.location.origin);

                // Only do once, we wouldn't want to instrument twice, that would give us double listeners.
                this["AuraDevToolService.Bootstrap"] = function(){
                    // If you close the panel, then reopen it, the bootstrap will have already happened
                    // on the page. But the inspector doesn't know that, we still need to communicate
                    // to it that we're done. So we always post the bootstrap back.
                    window.postMessage({
                        "action": "AuraInspector:bootstrap",
                        "key": "AuraInspector:bootstrap",
                        "data": "InjectedScript: Aura is already present at initialization, calling bootstrap."
                    }, window.location.origin);
                };
            } else {
                console.warn('Could not attach AuraDevTools Extension.');
            }
        }

    };//end of $Aura.actions

    var $Symbol = Symbol.for("AuraDevTools");

    // Communicate directly with the aura inspector
    $Aura.Inspector = new AuraInspector();
    $Aura.Inspector.init();

    // Attach to the global object so our integrations can access it, but
    // use a symbol so it doesn't create a global property.
    global[$Symbol] = $Aura;

    // Subscribes!
    $Aura.Inspector.subscribe("AuraInspector:OnHighlightComponent", $Aura.actions["AuraDevToolService.HighlightElement"]);
    $Aura.Inspector.subscribe("AuraInspector:OnHighlightComponentEnd", $Aura.actions["AuraDevToolService.RemoveHighlightElement"]);

    function AuraInspector() {
        var subscribers = {};
        var PUBLISH_KEY = "AuraInspector:publish";
        var PUBLISH_BATCH_KEY = "AuraInspector:publishbatch";
        var BOOTSTRAP_KEY = "AuraInspector:bootstrap";
        var postMessagesQueue = [];
        var batchPostId = null;
        var COMPONENT_CONTROL_CHAR = "\u263A"; // ☺ - This value is a component Global Id
        var ACTION_CONTROL_CHAR = "\u2744"; // ❄ - This is an action
        var ESCAPE_CHAR = "\u2353"; // This value was escaped, unescape before using.
        var increment = 0;
        var lastItemInspected;
        var countMap = {};

        this.init = function() {
            // Add Rightclick handler. Just track what we rightclicked on.
            addRightClickObserver();

            this.subscribe("AuraInspector:ContextElementRequest", () => {
                if(lastItemInspected && lastItemInspected.nodeType === 1) {
                    this.publish("AuraInspector:ShowComponentInTree", lastItemInspected.getAttribute("data-aura-rendered-by"));
                }
            });

            // Aura's present, our script is present, bootstrap!
            this.subscribe("AuraInspector:OnAuraInitialized", () => {
                this.bootstrap();
                this.subscribe("AuraInspector:OnPanelConnect", AuraInspector_OnPanelLoad.bind(this));
            });

            // Aura is present and the root has already been initialized.
            if(window.$A && window.$A.getContext && !!window.$A.getContext()) {
                this.bootstrap();
                this.publish("AuraInspector:OnAuraInitialized", "InjectedScript: Aura Present already during load." );
            }

            if(document.readyState === "complete") {
                if(!window.$A) {
                    this.publish("AuraInspector:OnAuraUnavailable", {});
                }
            } else {
                window.addEventListener("load", () => {
                    if(!window.$A) {
                        this.publish("AuraInspector:OnAuraUnavailable", {});
                    }
                });
            }

            this.publish("AuraInspector:OnInjectionScriptInitialized")
        };

        this.bootstrap = function() {
            $Aura.actions["AuraDevToolService.Bootstrap"]();
        };

        this.publish = function(key, data) {
            if(!key) { return; }

            // We batch the post messages
            // to avoid excessive messages which was causing
            // stabalization issues.
            postMessagesQueue.push({"key":key, "data":data});

            if(batchPostId === null || batchPostId === undefined) {
                batchPostId = sendQueuedPostMessages();
            }
        };

        this.subscribe = function(key, callback) {
            if(!key || !callback) { return; }

            if(!subscribers[key]) {
                subscribers[key] = [];
            }

            subscribers[key].push(callback);
        };

        this.unsubscribe = function(key, callback) {
            if(!key || !callback) { return false; }

            if(!subscribers[key]) {
                return false;
            }

            var listeners = subscribers[key];
            subscribers[key] = listeners.filter(function(item){
                return item !== callback;
            });
        };

        // Overriden by some tricky code down below to try to get into the context of the app.
        this.accessTrap = function(callback) {
            if(typeof callback === "function") {
                callback();
            }
        };

        /**
         * Get all the top level elements.
         * This obviously includes $A.getRoot(), but for Lightning Out that is empty.
         * So we also include all the Disconnected components attached to dom elements.
         */
        this.getRootComponents = function() {
            var topLevelDomNodes = null;
            var rootNodes = [];
            try {
                var app = $A.getRoot();
                rootNodes.push({
                    "components": [this.getComponent(app.getGlobalId())]
                });

                if(app.isInstanceOf("ltng:outApp")) {
                    topLevelDomNodes = $x("//*[@data-aura-rendered-by and not(ancestor::*[@data-aura-rendered-by])]");

                    var map = {};
                    var parentNodes = [];

                    // Do some fancy dancing to identify Root dom nodes
                    var parent;
                    var position;
                    for(let c=0,length=topLevelDomNodes.length;c<length;c++) {
                        parent = topLevelDomNodes[c].parentNode;
                        position = parentNodes.indexOf(parent);
                        if(position === -1) {
                            position = parentNodes.length;
                            map[position] = [];
                            parentNodes.push(parent);
                        }
                        map[position].push($A.getComponent(topLevelDomNodes[c].getAttribute("data-aura-rendered-by")));
                    }

                    for(let key in map) {
                        rootNodes.push({
                            "dom": parentNodes[key],
                            "trace": getComponentForLtngOut(map[key]),
                            "components": [this.getComponent(getComponentForLtngOut(map[key]))]
                        });
                    }
                }
            } catch(e) {}

            return this.safeStringify(rootNodes);
        }

        this.getComponent = function(componentId, options) {
            var component = $A.util.isComponent(componentId) ? componentId : $A.getComponent(componentId);
            var configuration = Object.assign({
                "attributes": true, // True to serialize the attributes, if you just want the body you can set this to false and body to true. (Good for serializing supers)
                "body": true, // Serialize the Body? This can be expensive so you can turn it off.
                "elementCount": false, // Count all child elements of all the elements associated to a component.
                "model": false, // Serialize the model data as well
                "valueProviders": false, // Should we serialize the attribute and facet value providers to the output? Could be a little slow now since we serialize passthrough value keys which could be big objects.
                "handlers": false // Do we serialize the event handlers this component is subscribed to?
            }, options);
            if(component){
                if(!component.isValid()) {
                    return JSON.stringify({
                        "valid": false,
                        "__proto__": null // no inherited properties
                    });
                } else {
                    // This api is added by us in an override. If it's not there when we try to serialize a component we'll have issues.
                    // So if its not there, just run the bootstrap code.
                    if(!("_$getSelfGlobalId$" in component)){
                        $Aura.actions["AuraDevToolService.Bootstrap"]();
                    }
                    var output = {
                        "descriptor": component.getDef().getDescriptor().toString(),
                        "globalId": component._$getSelfGlobalId$(),
                        "localId": component.getLocalId(),
                        "rendered": component.isRendered(),
                        "isConcrete": component.isConcrete(),
                        "valid": true,
                        "expressions": {},
                        "attributes": {},
                        "__proto__": null, // no inherited properties
                        "elementCount": 0,
                        "rerender_count": this.getCount(component._$getSelfGlobalId$() + "_rerendered")

                        // Added Later
                        //,"super": ""
                        //,"model": null
                    };

                    // VALUE PROVIDERS
                    if(configuration.valueProviders) {
                        output["attributeValueProvider"] = getValueProvider(component.getAttributeValueProvider());
                        output["facetValueProvider"] = getValueProvider(component.getComponentValueProvider());
                    }

                    // ATTRIBUTES
                    if(configuration.attributes) {
                        var auraError=$A.error;
                        var attributes = component.getDef().getAttributeDefs();

                        try {
                            // The Aura Inspector isn't special, it doesn't
                            // have access to the value if the access check
                            // system prevents it. So we should notify we
                            // do not have access.
                            var accessCheckFailed;

                            // Track Access Check failure on attribute access
                            $A.error=function(message,error){
                                if(message.indexOf("Access Check Failed!")===0){
                                    accessCheckFailed = true;
                                }
                            };

                            attributes.each(function(attributeDef) {
                                var key = attributeDef.getDescriptor().getName();
                                var value;
                                var rawValue;
                                accessCheckFailed = false;

                                // BODY
                                // If we don't want the body serialized, skip it.
                                // We would only want the body if we are going to show
                                // the components children.
                                if(key === "body" && !configuration.body) { return; }
                                try {
                                    rawValue = component._$getRawValue$(key);
                                    value = component.get("v." + key);
                                } catch(e) {
                                    value = undefined;
                                }

                                if($A.util.isExpression(rawValue)) {
                                    output.expressions[key] = rawValue+"";
                                    output.attributes[key] = accessCheckFailed ? "[ACCESS CHECK FAILED]" : value;
                                } else {
                                    output.attributes[key] = rawValue;
                                }
                            }.bind(this));
                        } catch(e) {
                            console.error(e);
                        } finally {
                            $A.error = auraError;
                        }
                    }
                    // BODY
                    else if(configuration.body) {
                        var rawValue;
                        var value;
                        try {
                            rawValue = component._$getRawValue$("body");
                            value = component.get("v.body");
                        } catch(e) {
                            value = undefined;
                        }
                        if($A.util.isExpression(rawValue)) {
                            output.expressions["body"] = rawValue+"";
                            output.attributes["body"] = value;
                        } else {
                            output.attributes["body"] = rawValue;
                        }
                    }

                    var supers = [];
                    var superComponent = component;
                    while(superComponent = superComponent.getSuper()) {
                        supers.push(superComponent._$getSelfGlobalId$());
                    }

                    if(supers.length) {
                        output["supers"] = supers;
                    }

                    // ELEMENT COUNT
                    // Concrete is the only one with elements really, so doing it at the super
                    // level is duplicate work.
                    if(component.isConcrete() && configuration.elementCount) {
                        var elements = component.getElements() || [];
                        var elementCount = 0;
                        for(var c=0,length=elements.length;c<length;c++) {
                            if(elements[c] instanceof HTMLElement) {
                                // Its child components, plus itself.
                                elementCount += elements[c].getElementsByTagName("*").length + 1;
                            }
                        }
                        output.elementCount = elementCount;
                    }

                    // MODEL
                    if(configuration.model) {
                        var model = component.getModel();
                        if(model) {
                            output["model"] = model.data;
                        }
                    }

                    // HANDLERS
                    if(configuration.handlers){
                        var handlers = {};
                        var events = component.getEventDispatcher();
                        var current;
                        var apiSupported = true; // 204+ only. Don't want to error in 202. Should remove this little conditional in 204 after R2.
                        for(var eventName in events) {
                            current = events[eventName];
                            if(Array.isArray(current) && current.length && apiSupported) {
                                handlers[eventName] = [];
                                for(var c=0;c<current.length;c++){
                                    if(!current[c].hasOwnProperty("actionExpression")) {
                                        apiSupported = false;
                                        break;
                                    }
                                    handlers[eventName][c] = {
                                        "expression": current[c]["actionExpression"],
                                        "valueProvider": getValueProvider(current[c]["valueProvider"])
                                    };
                                }
                            }
                        }
                        if(apiSupported) {
                            output["handlers"] = handlers;
                        }
                    }

                    // Output to the dev tools
                    return this.safeStringify(output);
                }
            }
            return "";
        };

        /**
         * Safe because it handles circular references in the data structure.
         *
         * Will add control characters and shorten components to just their global ids.
         * Formats DOM elements in a pretty manner.
         */
        this.safeStringify = function(originalValue) {
            // For circular dependency checks
            var doNotSerialize = {
                "[object Window]": true,
                "[object global]": true,
                "__proto__": null
            };
            var visited = new Set();
            var toJSONCmp = $A.Component.prototype.toJSON;
            delete $A.Component.prototype.toJSON;
            var result = "{}";
            try {
                result = JSON.stringify(originalValue, function(key, value) {
                    if(value === document) { return {}; }
                    if(Array.isArray(this) || key) { value = this[key]; }
                    if(!value) { return value; }

                    if(typeof value === "string" && (value.startsWith(COMPONENT_CONTROL_CHAR) || value.startsWith(ACTION_CONTROL_CHAR))) {
                        return ESCAPE_CHAR + escape(value);
                    }

                    if(value instanceof HTMLElement) {
                        var attributes = value.attributes;
                        var domOutput = [];
                        for(var c=0,length=attributes.length,attribute;c<length;c++) {
                            attribute = attributes.item(c);
                            domOutput.push(attribute.name + "=" + attribute.value);
                        }
                        return `<${value.tagName} ${domOutput.join(' ')}>`; // Serialize it specially.
                    }

                    if(value instanceof Text) {
                        return value.nodeValue;
                    }

                    if($A.util.isComponent(value)) {
                        if(value.isValid()) {
                            return COMPONENT_CONTROL_CHAR + value.getGlobalId();
                        } else {
                            return value.toString();
                        }
                    }

                    if($A.util.isExpression(value)) {
                        return value.toString();
                    }

                    if($A.util.isAction(value)) {
                        return ACTION_CONTROL_CHAR + value.getDef().toString();
                    }

                    if(Array.isArray(value)) {
                        return value.slice();
                    }

                    if(typeof value === "object") {
                    //     try {
                    //     var primitive = value+"";
                    // } catch(ex) { debugger; }
                        if("$serId$" in value && visited.has(value)) {
                            return {
                                "$serRefId$": value["$serId$"],
                                "__proto__": null
                            };
                        }
                        else if(doNotSerialize[Object.prototype.toString.call(value)]) {
                            value = {};
                        }
                        else if(!$A.util.isEmpty(value)) {
                            visited.add(value);
                            value.$serId$ = increment++;
                        }
                    }

                    return value;
                });

            } catch(e) {
                console.error("AuraInspector: Error serializing object to json.");
            }


            visited.forEach(function(item){
                if("$serId$" in item) {
                    delete item["$serId$"];
                }
            });

            $A.Component.prototype.toJSON = toJSONCmp;

            return result;
        };

        /**
         * Increment a counter for the specified key.
         * @example
         * $Aura.Inspector.count('rendered');
         * $Aura.Inspector.count('rendered');
         * $Aura.Inspector.getCount('rendered'); // 2
         * @param  {String} key Any unique ID to count
         */
        this.count = function(key) {
            countMap[key] = countMap.hasOwnProperty(key) ? countMap[key] + 1 : 1;
        };

        /**
         * Get how many times a key has been counted without incrementing the counter.
         *
         * @param  {String} key Unique id to count.
         */
        this.getCount = function(key) {
            return countMap.hasOwnProperty(key) ? countMap[key] : 0;
        };

        /**
         * Reset a counted key to 0.
         *
         * @param  {String} key Unique id that you passed to this.count(key) to increment the counter.
         */
        this.clearCount = function(key) {
            if(countMap.hasOwnProperty(key)) {
                delete countMap[key];
            }
        };

        // Start listening for messages
        window.addEventListener("message", Handle_OnPostMessage);

        function Handle_OnPostMessage(event) {
            if(event && event.data) {
                if(event.data.action === PUBLISH_KEY) {
                    callSubscribers(event.data.key, event.data.data);
                } else if(event.data.action === PUBLISH_BATCH_KEY) {
                    var data = event.data.data || [];
                    for (var c = 0, length = data.length; c < length; c++) {
                        callSubscribers(data[c].key, data[c].data);
                    }
                }
            }
        }

        function AuraInspector_OnPanelLoad() {
            if(window.$A) {
                window.postMessage({
                    "action": "AuraInspector:bootstrap",
                    "key":"AuraInspector:bootstrap",
                    "data": "Panel connected, the injected script has already bootstrapped."
                }, window.location.origin);
            }
        }

        // This is temporary till we can add the data-ltngout-rendered-by attribute.
        function getComponentForLtngOut(components) {
            if(!components.length) { return; }
            let owner = components[0].getOwner();
            while(!owner.getOwner().isInstanceOf("aura:application") && owner.getOwner() !== owner) {
                owner = owner.getOwner();
            }
            return owner;
        }

        /** Serializing Passthrough Values as valueProviders is a bit complex, so we have this helper function to do it. */
        function getValueProvider(valueProvider) {
            if("_$getSelfGlobalId$" in valueProvider) {
                return valueProvider._$getSelfGlobalId$();
            }

            // Probably a passthrough value
            var output = {
                // Can't do providers yet since we don't have a way to get access to them.
                // We should though, it would be great to see in the inspector.
                //"providers": safeStringify()
                $type$: "passthrough"
            };

            if('getPrimaryProviderKeys' in valueProvider) {
                var values = {};
                var value;
                var keys;
                var provider = valueProvider;
                while(provider && !("_$getSelfGlobalId$" in provider)) {
                    keys = provider.getPrimaryProviderKeys();
                    for(var c = 0; c<keys.length;c++) {
                        key = keys[c];
                        if(!values.hasOwnProperty(key)) {
                            value = provider.get(key);
                            if($A.util.isComponent(value)) {
                                values[key] = {
                                    "id": value
                                };
                            } else {
                                values[key] = value;
                            }
                        }
                    }
                    provider = provider.getComponent();
                }
                if(provider && "_$getSelfGlobalId$" in provider) {
                    output["globalId"] = provider._$getSelfGlobalId$();
                }
                output["values"] = values;
            } else {
                while(!("_$getSelfGlobalId$" in valueProvider)) {
                    valueProvider = valueProvider.getComponent();
                }
                output["globalId"] = valueProvider._$getSelfGlobalId$();
            }

            return output;
        }

        function callSubscribers(key, data) {
            if(subscribers[key]) {
                subscribers[key].forEach(function(callback){
                    callback(data);
                });
            }
        }

        function sendQueuedPostMessages() {
            if("requestIdleCallback" in window) {
                batchPostId = window.requestIdleCallback(sendQueuedPostMessagesCallback);
            } else {
                batchPostId = window.requestAnimationFrame(sendQueuedPostMessagesCallback);
            }

            function sendQueuedPostMessagesCallback() {
                if(postMessagesQueue.length) {
                    try {
                        window.postMessage({
                            "action": PUBLISH_BATCH_KEY,
                            "data": postMessagesQueue
                        }, window.location.origin);
                    } catch(e) {
                        console.error("AuraInspector: Failed to communicate to inspector.", e);
                    }
                }
                postMessagesQueue = [];
                batchPostId = null;
            }
        }

        function addRightClickObserver(){
            document.addEventListener("mousedown", function(event){
                // Right Click
                if(event.button === 2) {
                    var current = event.target;
                    while(current && current != document && !current.hasAttribute("data-aura-rendered-by")) {
                        current = current.parentNode;
                    }
                    lastItemInspected = current;
                }
            });
        }

    }

    function wrapFunction(target, methodName, newFunction) {
        if(typeof target[methodName] != "function") {
            return;
        }
        var original = target[methodName];
        target[methodName] = function() {
            newFunction.apply(this, arguments);
            return original.apply(this, arguments);
        };
    }

    function bootstrapCounters() {
        // Count how many components are being created.
        $A.installOverride("ComponentService.createComponentPriv", function(){
             var config = Array.prototype.shift.apply(arguments);

             var ret = config["fn"].apply(config["scope"], arguments);

             $Aura.Inspector.count("component_created");

             return ret;
        });

        // No way of displaying this at the moment.
        // wrapFunction($A.Component.prototype, "render", function(){
        //     $Aura.Inspector.count("component_rendered");
        //     $Aura.Inspector.count(this.getGlobalId() + "_rendered");
        // });

        wrapFunction($A.Component.prototype, "rerender", function(){
            $Aura.Inspector.count("component_rerendered");
            $Aura.Inspector.count(this.getGlobalId() + "_rerendered");
        });

        /*
            I'll admit, this is a  hack into the Aura access check framework.
            I shouldn't rely on this, it's merely a best case scenario work around.
            Fallbacks should be present if I use this method.
         */
        var originalRender = $A.Component.prototype.render;
        wrapFunction($A.Component.prototype, "render", function(){
            var current = this.getDef();
            while(current.getSuperDef()) {
                current = current.getSuperDef();
            }
            if(current.getDescriptor().getQualifiedName() === "markup://aura:application") {
                $Aura.Inspector.accessTrap = $A.getCallback(function(callback) {
                    if(typeof callback === "function") {
                        callback();
                    }
                });
                // No need anymore to do the override. It's simply to attach this access trap.
                $A.Component.prototype.render = originalRender;
            }
        });
        // No way of displaying this at the moment.
        // wrapFunction($A.Component.prototype, "unrender", function(){
        //     $Aura.Inspector.count("component_unrendered");
        //     $Aura.Inspector.count(this.getGlobalId() + "_unrendered");
        // });
    }

    function bootstrapEventInstrumentation() {

        $A.installOverride("Event.fire", OnEventFire);

        function OnEventFire(config, params) {
            var startTime = performance.now();
            var eventId = "event_" + startTime;
            var data = {
                "id": eventId
            };

            $Aura.Inspector.publish("AuraInspector:OnEventStart", data);

            var ret = config["fn"].call(config["scope"], params);

            var event = config["scope"];
            var source = event.getSource();

            data = {
                "id": eventId,
                "caller": arguments.callee.caller.caller.caller+"",
                "name": event.getDef().getDescriptor().getQualifiedName(),
                "parameters": output(event.getParams()),
                "sourceId": source ? source.getGlobalId() : "",
                "startTime": startTime,
                "endTime": performance.now(),
                "type": event.getDef().getEventType()
            };

            $Aura.Inspector.publish("AuraInspector:OnEventEnd", data);

            return ret;
        }

        function output(data) {
            var componentToJSON = $A.Component.prototype.toJSON;
            delete $A.Component.prototype.toJSON;

            var json = $Aura.Inspector.safeStringify(data, function(key, value){
                if($A.util.isComponent(value)) {
                    return "[Component] {" + value.getGlobalId() + "}";
                } else if(value instanceof Function) {
                    return value +"";
                }
                return value;
            });

            $A.Component.prototype.toJSON = componentToJSON;

            return json;
        }
    }



    function bootstrapActionsInstrumentation() {

        $A.installOverride("enqueueAction", OnEnqueueAction);
        $A.installOverride("Action.finishAction", OnFinishAction);
        $A.installOverride("Action.abort", OnAbortAction);
        $A.installOverride("ClientService.send", OnSendAction);
        $A.installOverride("Action.runDeprecated", OnActionRunDeprecated);

        function OnEnqueueAction(config, action, scope) {
            var ret = config["fn"].call(config["scope"], action, scope);

            var cmp = action.getComponent();
            var data =  {
                "id"         : action.getId(),
                "params"     : $Aura.Inspector.safeStringify(action.getParams()),
                "abortable"  : action.isAbortable(),
                "storable"   : action.isStorable(),
                "background" : action.isBackground(),
                "state"      : action.getState(),
                "isRefresh"  : action.isRefreshAction(),
                "defName"    : action.getDef()+"",
                "fromStorage": action.isFromStorage(),
                "enqueueTime": performance.now(),
                "storageKey" : action.getStorageKey(),
                "callingCmp" : cmp && cmp.getGlobalId()
            };

            $Aura.Inspector.publish("AuraInspector:OnActionEnqueue", data);

            return ret;
        }

        function OnSendAction(config, auraXHR, actions, method, options) {
                if (actions) {
                    for(var c=0;c<actions.length;c++) {
                        //udpate action card on the left side anyway
                        $Aura.Inspector.publish("AuraInspector:OnActionStateChange", {
                            "id": actions[c].getId(),
                            "state": "RUNNING",
                            "sentTime": performance.now()
                        });
                    }
                }

                var ret = config["fn"].call(config["scope"], auraXHR, actions, method, options);

                return ret;
        }


        function OnFinishAction(config, context) {
            var startCounts = {
                "created": $Aura.Inspector.getCount("component_created")
            };

            var ret = config["fn"].call(config["scope"], context);

            var action = config["self"];

            var data = {
                "id": action.getId(),
                "state": action.getState(),
                "fromStorage": action.isFromStorage(),
                "returnValue": $Aura.Inspector.safeStringify(action.getReturnValue()),
                "error": $Aura.Inspector.safeStringify(action.getError()),
                "finishTime": performance.now(),
                "stats": {
                    "created": $Aura.Inspector.getCount("component_created") - startCounts.created
                }
            };

            $Aura.Inspector.publish("AuraInspector:OnActionStateChange", data);

            return ret;
        }

        function OnAbortAction(config, context) {
            var ret = config["fn"].call(config["scope"], context);

            var action = config["self"];

            var data = {
                "id": action.getId(),
                "state": action.getState(),
                "finishTime": performance.now()
            };

            $Aura.Inspector.publish("AuraInspector:OnActionStateChange", data);

            return ret;
        }



        function OnActionRunDeprecated(config, event) {
            var action = config["self"];
            var startTime = performance.now();
            var data = {
                "actionId": action.getId()
            };

            $Aura.Inspector.publish("AuraInspector:OnClientActionStart", data);

            var ret = config["fn"].call(config["scope"], event);

            data = {
                "actionId": action.getId(),
                "name": action.getDef().getName(),
                "scope": action.getComponent().getGlobalId()
            };

            $Aura.Inspector.publish("AuraInspector:OnClientActionEnd", data);
        }
    }


    function bootstrapTransactionReporting() {
        $A.metricsService.enablePlugins();

        $A.metricsService.transactionStart("AuraInspector", "transactionstab");

        $A.metricsService.onTransactionEnd(function(transaction){
            setTimeout(() => {
                $Aura.Inspector.publish("AuraInspector:OnTransactionEnd", transaction);
            }, 0);
        });

        $A.metricsService.onTransactionsKilled(function(transactions){
            if(transactions) {
                for(var c=0;c<transactions.length;c++) {
                    if(transactions[c].id === "AuraInspector:transactionstab") {
                        $A.metricsService.transactionStart("AuraInspector", "transactionstab");
                    }
                }
            }
        });
    }


    function bootstrapPerfDevTools() {
        $A.PerfDevToolsEnabled = true;

        var OPTIONS = {
                componentCreation  : true,
                componentRendering : true,
                timelineMarks      : false,
                transactions       : true,
            },
            CMP_CREATE_MARK   = 'componentCreation',
            START_SUFIX       = 'Start',
            END_SUFIX         = 'End',
            CMP_CREATE_END    = CMP_CREATE_MARK + END_SUFIX,
            SAMPLING_INTERVAL = 0.025;


        $A.PerfDevTools = {
            init: function (cfg) {
                cfg || (cfg = {});
                this._initializeOptions(cfg);
                this._hooks = {};
                this.collector = {
                    componentCreation : [],
                    rendering: []
                };
                this._initializeHooks();
            },
            clearMarks: function (marks) {
                this._resetCollector(marks);
            },
            _initializeOptions: function (cfg) {
                this.opts = {
                    componentCreation  : cfg.componentCreation  || OPTIONS.componentCreation,
                    componentRendering : cfg.componentRendering || OPTIONS.componentRendering,
                    timelineMarks      : typeof cfg.timelineMarks === 'boolean' ? cfg.timelineMarks : OPTIONS.timelineMarks,
                    transactions       : cfg.transactions || OPTIONS.transactions
                };
            },
            _initializeHooks: function () {
                if (this.opts.componentCreation /* && $A.getContext().mode !== 'PROD'*/) {
                    this._initializeHooksComponentCreation();
                }
            },
            _createNode: function (name, mark, id) {
                return {
                    id  : id,
                    mark: mark,
                    name: name,
                    timestamp: window.performance.now(),
                };
            },
            _resetCollector: function (type) {
                if (type) {
                    this.collector[type] = [];
                    return;
                }

                for (var i in this.collector) {
                    this.collector[i] = [];
                }
            },
            _initializeHooksComponentCreation: function () {
                this._hookOverride("ComponentService.createComponentPriv", CMP_CREATE_MARK);
            },
            getComponentCreationProfile: function () {
                return this._generateCPUProfilerDataFromMarks(this.collector.componentCreation);
            },
            _hookOverride: function(key, mark) {
                $A.installOverride(key, function(){
                    var config = Array.prototype.shift.apply(arguments);
                    var cmpConfig = arguments[0];
                    var descriptor = $A.util.isString(cmpConfig) ? cmpConfig : (cmpConfig["componentDef"]["descriptor"] || cmpConfig["componentDef"]) + '';

                    var collector = this.collector[mark];
                    collector.push(this._createNode(descriptor, mark + START_SUFIX));

                    var ret = config["fn"].apply(config["scope"], arguments);

                    var id = ret.getGlobalId && ret.getGlobalId() || "([ids])";
                    collector.push(this._createNode(descriptor, mark + END_SUFIX, id));

                    return ret;
                }.bind(this), this);
            },
            _hookMethod: function (host, methodName, mark) {
                var self = this;
                var hook = host[methodName];
                var collector = this.collector[mark];

                this._hooks[methodName] = hook;
                host[methodName] = function (config) {
                    if (Array.isArray(config)) {
                        return hook.apply(this, arguments);
                    }

                    var descriptor = (config.componentDef.descriptor || config.componentDef) + '',
                        collector  = self.collector[mark];

                    // Add mark
                    collector.push(self._createNode(descriptor, mark + START_SUFIX));

                    // Hook!
                    var result = hook.apply(this, arguments);
                    var id = result.getGlobalId && result.getGlobalId() || '([ids])';

                    // End mark
                    collector.push(self._createNode(descriptor, mark + END_SUFIX, id));
                    return result;
                };
            },
            _generateCPUProfilerDataFromMarks: function (marks) {
                if(!marks || !marks.length) { return {}; }

                //global stuff for the id
                var id = 0;
                function nextId () {return ++id;}
                function logTree(stack, mark) {
                    // UNCOMMENT THIS FOR DEBUGGING PURPOSES:
                    // var d = '||| ';
                    // console.log(Array.apply(0, Array(stack)).map(function(){return d;}).join(''), mark);
                }

                function hashCode(name) {
                    var hash = 0, i, chr, len;
                    if (name.length == 0) return hash;
                    for (i = 0, len = name.length; i < len; i++) {
                        chr   = name.charCodeAt(i);
                        hash  = ((hash << 5) - hash) + chr;
                        hash |= 0; // Convert to 32bit integer
                    }
                    return Math.abs(hash);
                }

                function generateNode (name, options) {
                    options || (options = {});
                    return  {
                        functionName: name || ("Random." + Math.random()),
                        scriptId: "3",
                        url: options.details || "",
                        lineNumber: 0,
                        columnNumber: 0,
                        hitCount: options.hit || 0,
                        callUID: hashCode(name),
                        children: [],
                        deoptReason: "",
                        id: nextId()
                    };
                }

                var endText    = CMP_CREATE_END,
                    startTime  = marks[0].timestamp, // Get from first and last mark
                    endTime    = marks[marks.length - 1].timestamp,
                    markLength = marks.length,
                    duration   = endTime - startTime,
                    sampling   = SAMPLING_INTERVAL,
                    root       = generateNode("(root)"),
                    idle       = generateNode("(idle)"),
                    current    = generateNode(marks[0].name),
                    stack      = [current, root];

                current._startTime = marks[0].timestamp;

                function generateTimestamps(startTime, endTime) {
                    var diff  = endTime - startTime,
                        ticks = Math.round(diff / sampling), // every N miliseconds
                        time  = startTime,
                        ts    = [time];

                    for (var i = 1; i < ticks; i++) {
                        time += sampling;
                        ts.push(time);
                    }
                    return ts;
                }

                function generateSamples (root, size, idle) {
                    var samples = new Array(size).join(","+idle.id).split(idle.id);
                        samples[0] = idle.id;
                    var currentIndex = 0;
                    var idleHits = 0;


                    function calculateTimesForNode(node) {
                        if (node._idleHits) {
                            currentIndex += node._idleHits;
                            idleHits += node._idleHits;
                        }

                        for (var i = 0; i < node.hitCount; i++) {
                            samples[currentIndex + i] = node.id;
                        }
                        currentIndex += node.hitCount;

                        for (var j = 0; j < node.children.length; j++) {
                            calculateTimesForNode(node.children[j]);
                        }

                    }
                    calculateTimesForNode(root, root.id);
                    idle.hitCount = Math.max(0, size - currentIndex + idleHits); //update idle with remaining hits
                    return samples;
                }

                logTree(stack.length - 1, 'open: ' + marks[0].name);
                for (var i = 1; i < markLength; i++) {
                    tmp = marks[i];
                    if (stack[0].functionName === tmp.name && tmp.mark === endText) {
                        tmpNode = stack.shift();
                        tmpNode._endTime = tmp.timestamp;
                        tmpNode._totalTime = tmpNode._endTime - tmpNode._startTime;
                        tmpNode._childrenTime = tmpNode.children.reduce(function (p, c) {return p + c._totalTime;}, 0);
                        tmpNode._selfTime = tmpNode._totalTime - tmpNode._childrenTime;
                        tmpNode.hitCount = Math.floor(tmpNode._selfTime / sampling);
                        tmpNode._cmpId = tmp.id;
                        tmpNode._childComponentCount += tmpNode.children.length;

                        //push into the parent
                        stack[0].children.push(tmpNode);
                        stack[0]._childComponentCount += tmpNode._childComponentCount;
                        logTree(stack.length, 'close: ' + tmp.name + ' selfTime: ' + tmpNode._selfTime.toFixed(4) + '| totalTime: ' + tmpNode._totalTime.toFixed(4));
                    } else {

                        current = generateNode(tmp.name);
                        current._startTime = tmp.timestamp;
                        current._childComponentCount = 0;
                        if (stack.length === 1 && ((markLength - i) > 1)) {
                            current._idleHits = Math.floor((tmp.timestamp - marks[i - 1].timestamp) / sampling);
                        }

                        stack.unshift(current);
                        logTree(stack.length - 1, 'open: ' + tmp.name);
                    }
                }
                root.children.push(idle);
                var timestamp = generateTimestamps(startTime, endTime);
                var samples = generateSamples(root, timestamp.length, idle);

                return {
                    head: root,
                    startTime: startTime / 1000,
                    endTime : endTime / 1000,
                    timestamp: timestamp,
                    samples : samples,
                };
            }
        };
    };


})(this);
