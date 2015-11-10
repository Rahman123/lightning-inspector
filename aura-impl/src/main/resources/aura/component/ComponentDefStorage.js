/*
 * Copyright (C) 2013 salesforce.com, inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*jslint sub: true */
/**
 * @description Storage for component definitions. If persistent storage
 * is not available then most operations are noops.
 * @constructor
 * @protected
 */
function ComponentDefStorage(){}

/**
 * Target size, as a percent of max size, for component def storage during eviction.
 */
ComponentDefStorage.EVICTION_TARGET_LOAD = 0.75;

/**
 * Minimum head room, as a percent of max size, to allocate after eviction and adding new definitions.
 */
ComponentDefStorage.EVICTION_HEADROOM = 0.1;


/**
 * Whether to use storage for component definitions.
 * @returns {Boolean} whether to use storage for component definitions.
 */
ComponentDefStorage.prototype.useDefinitionStorage = function() {
    if (this.useDefStore === undefined) {
        this.setupDefinitionStorage();
    }
    return this.useDefStore;
};

/**
 * Creates storage to determine whether available storage mechanism is persistent
 * to store component definitions. Uses storage if persistent. Otherwise, don't use
 * storage to backup definitions.
 */
ComponentDefStorage.prototype.setupDefinitionStorage = function() {
    if (this.useDefStore === undefined) {
        this.useDefStore = false;
        if ($A.getContext().getApp()) {
            var storage = $A.storageService.initStorage(
                "ComponentDefStorage",  // name
                true,           // persistent
                false,          // secure
                4096000,        // maxSize 4MB
                10886400,       // defaultExpiration (1/2 year because we handle eviction ourselves)
                0,              // defaultAutoRefreshInterval
                true,           // debugLoggingEnabled
                false           // clearStorageOnInit
            );
            if (storage.isPersistent()) {
                // we only want a persistent storage
                this.definitionStorage = storage;
                // explicitly disable sweeping b/c we handle eviction ourselves
                this.definitionStorage.suspendSweeping();

                this.useDefStore = true;
            } else {
                $A.storageService.deleteStorage("ComponentDefStorage");
            }
        }
    }
};

/**
 * Gets the storage for component definitions.
 * @return {AuraStorage|null} the component def storage or null if it's disabled.
 */
ComponentDefStorage.prototype.getStorage = function () {
    if (this.useDefinitionStorage()) {
        return this.definitionStorage;
    }
};

/**
 * Stores component definition into storage.
 * @param {Object[]} configs the definitions to store
 * @return {Promise} promise that resolves when storing is complete.
 */
ComponentDefStorage.prototype.storeDefs = function(configs) {
    if (this.useDefinitionStorage() && configs.length) {
        var promises = [];
        var descriptor, encodedConfig;
        for (var i = 0; i < configs.length; i++) {
            descriptor = configs[i]["descriptor"];
            encodedConfig = $A.util.json.encode(configs[i]);
            promises.push(this.definitionStorage.put(descriptor, encodedConfig));
        }
        return Promise["all"](promises).then(
            function () {
                $A.log("ComponentDefStorage: Successfully stored " + promises.length + " descriptors");
            },
            function (e) {
                $A.log("ComponentDefStorage: Error storing  " + promises.length + " descriptors", e);
                throw e;
            }
        );
    }
    return Promise["resolve"]();
};

/**
 * Removes definitions from storage.
 * @param {String[]} descriptors the descriptors identifying the definitions to remove.
 * @return {Promise} a promise that resolves when the definitions are removed.
 */
ComponentDefStorage.prototype.removeDefs = function(descriptors) {
    if (this.useDefinitionStorage() && descriptors.length) {
        var promises = [];
        for (var i = 0; i < descriptors.length; i++) {
            promises.push(this.definitionStorage.remove(descriptors[i], true));
        }

        return Promise["all"](promises).then(
            function () {
                $A.log("ComponentDefStorage: Successfully removed " + promises.length + " descriptors");
            },
            function (e) {
                $A.log("ComponentDefStorage: Error removing  " + promises.length + " descriptors", e);
                throw e;
            }
        );
    }

    return Promise["resolve"]();
};


/**
 * Gets all definitions from storage.
 * @return {Promise} a promise that resolves with an array of the configs from storage. If storage
 *  fails or is disabled the promise resolves to an empty array.
 */
ComponentDefStorage.prototype.getAll = function () {
    if (!this.useDefinitionStorage()) {
        return Promise["resolve"]([]);
    }

    return this.definitionStorage.getAll().then(
        function(items) {
            var i, len, result = [];
            for (i = 0, len = items.length; i < len; i++) {
                var item = items[i];
                var config = $A.util.json.decode(item["value"]);
                result.push({ "key": item["key"], "value" : config });
            }

            return result;
        },
        function() {
            return [];
        }
    );
};

/**
 * Asynchronously retrieves all definitions from storage and adds to component service.
 */
ComponentDefStorage.prototype.restoreAll = function() {
    if (this.restoreInProgress) {
        return;
    }
    this.restoreInProgress = true;

    var defRegistry = this;
    this.getAll().then(
        function(items) {
            var i, len;
            for (i = 0, len = items.length; i < len; i++) {
                var item = items[i];
                var value = item["value"];
                var descriptor = value["descriptor"];
                if (!$A.componentService.hasDefinition(descriptor)) {
                    $A.componentService.saveComponentConfig(value);
                }
            }
            $A.log("ComponentDefStorage: restored " + len + " definitions from storage into registry");
            defRegistry.restoreInProgress = false;
        },
        function(e) {
            $A.log("ComponentDefStorage: error during restore from storage", e);
            defRegistry.restoreInProgress = false;
        }
    );
};

/**
 * Clears all definitions from storage.
 * @return {Promise} a promise that resolves when storage is cleared.
 */
ComponentDefStorage.prototype.clear = function() {
    if (this.useDefinitionStorage()) {
        return this.definitionStorage.clear();
    }
    return Promise["resolve"]();
};

Aura.Component.ComponentDefStorage = ComponentDefStorage;
