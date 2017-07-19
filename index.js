'use strict';

var fliclib = require('fliclib-daemon-client');
var FlicClient = fliclib.FlicClient;
var FlicConnectionChannel = fliclib.FlicConnectionChannel;
var FlicScanner = fliclib.FlicScanner;

var Accessory, Characteristic, Constants, Service, UUIDGen;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    Constants = {
        DEFAULT_HOST: 'localhost',
        DEFAULT_PORT: 5551,
        CLICK_TYPE: {
            'ButtonSingleClick': Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
            'ButtonDoubleClick': Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
            'ButtonHold':        Characteristic.ProgrammableSwitchEvent.LONG_PRESS
        }
    }

    homebridge.registerPlatform('homebridge-flic', 'Flic', FlicPlatform, true);
};

function FlicPlatform(log, config, api) {
    if (!config) {
        log.warn("Ignoring Flic Platform setup because it is not configured");
        this.disabled = true;
        return;
    }

    var self = this;

    this.config = config;
    this.api = api;
    this.accessories = {};
    this.controllers = this.config.controllers || [{host: Constants.DEFAULT_HOST, port: Constants.DEFAULT_PORT}];
    this.log = log;

    this.api.on('didFinishLaunching', function() {
        self.controllers.forEach(
            function(controller) {
                self.connectController(controller);
            }
        );
    });
}

FlicPlatform.prototype.addAccessory = function(bdAddr) {
    var serial = bdAddr.replace(/:/g, '');
    var name = 'Flic ' + serial.replace(/80e4da/, '');

    this.log("Found: %s (%s)", name, serial);

    var accessory = new Accessory(name, UUIDGen.generate(bdAddr));

    accessory.addService(Service.StatelessProgrammableSwitch, name);

    this.accessories[accessory.UUID] = accessory;
    this.api.registerPlatformAccessories("homebridge-flic", "Flic", [accessory]);

    return accessory;
}

FlicPlatform.prototype.configureAccessory = function(accessory) {
    this.accessories[accessory.UUID] = accessory;
}

FlicPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
    var self = this;
    var respDict = {};

    if (request && request.type === "Terminate") {
        context.onScreen = null;
    }

    var sortAccessories = function() {
        context.sortedAccessories = Object.keys(self.accessories).map(
            function(k){return this[k]},
            self.accessories
        ).sort(function(a,b) {if (a.displayName < b.displayName) return -1; if (a.displayName > b.displayName) return 1; return 0});

        return Object.keys(context.sortedAccessories).map(function(k) {return this[k].displayName}, context.sortedAccessories);
    }

    switch(context.onScreen) {
        case "DoRemove":
            if (request.response.selections) {
                for (var i in request.response.selections.sort()) {
                    this.removeAccessory(context.sortedAccessories[request.response.selections[i]]);
                }

                respDict = {
                    "type": "Interface",
                    "interface": "instruction",
                    "title": "Finished",
                    "detail": "Accessory removal was successful."
                }

                context.onScreen = null;
                callback(respDict);
            }
            else {
                context.onScreen = null;
                callback(respDict, "platform", true, this.config);
            }
            break;
        case "Menu":
            context.onScreen = request && request.response && request.response.selections[0] == 1 ? "Remove" : "Add";

            switch(context.onScreen) {
                case "Add":
                    self.controllers.forEach(
                        function(controller) {
                            if (controller.client === undefined) {
                                return;
                            }

                            self.log("Controller [%s:%s] - Scanner added", controller.host, controller.port);
                            controller.scanner = new FlicScanner();

                            controller.scanner.on("advertisementPacket", function(bdAddr, name, rssi, isPrivate, alreadyVerified) {
                                clearTimeout(context.scanTimeout);

                                if (alreadyVerified) {
                                    return;
                                }
                                else if (isPrivate && context.onScreen != "isPrivate") {
                                    context.onScreen = "isPrivate";
                                    callback({
                                        "type": "Interface",
                                        "interface": "instruction",
                                        "title": "Private button found",
                                        "detail": "Hold down for 7 seconds to make it public.",
                                        "showActivityIndicator": true
                                    });
                                    return;
                                }
                                else if (isPrivate) {
                                    return;
                                }

                                self.controllers.forEach(
                                    function(controller) {
                                        if (controller.scanner === undefined) {
                                            return;
                                        }

                                        try {
                                            self.log("Controller [%s:%s] - Scanner removed", controller.host, controller.port);
                                            controller.client.removeScanner(controller.scanner);
                                        }
                                        catch(e) {

                                        }

                                        delete controller.scanner;
                                    }
                                );

                                var cc = new FlicConnectionChannel(bdAddr);

                                cc.on("createResponse", function(error, connectionStatus) {
                                    if (connectionStatus == "Ready") {
                                        // Got verified by someone else between scan result and this event
                                        controller.client.removeConnectionChannel(cc);
                                        self.connectButton(controller.client, bdAddr, name);

                                        callback({
                                            "type": "Interface",
                                            "interface": "instruction",
                                            "title": "Sweet",
                                            "detail": "Done."
                                        });
                                    } else if (error != "NoError") {
                                        self.log("Controller [%s:%s] - Scanner failed: Too many pending connections", controller.host, controller.port);

                                        callback({
                                            "type": "Interface",
                                            "interface": "instruction",
                                            "title": "Scan failed",
                                            "detail": "Too many pending connections"
                                        });
                                    } else {
                                        self.log("Found a public button. Now connecting...");
                                        context.buttonTimeout = setTimeout(function() {
                                            controller.client.removeConnectionChannel(cc);
                                        }, 45 * 1000);
                                        callback({
                                            "type": "Interface",
                                            "interface": "instruction",
                                            "title": "Public button found.",
                                            "detail": "Connecting...",
                                            "showActivityIndicator": true
                                        });
                                    }
                                });
                                cc.on("connectionStatusChanged", function(connectionStatus, disconnectReason) {
                                    if (connectionStatus == "Ready") {
                                        clearTimeout(context.buttonTimeout);
                                        controller.client.removeConnectionChannel(cc);
                                        self.connectButton(controller.client, bdAddr, name);

                                        callback({
                                            "type": "Interface",
                                            "interface": "instruction",
                                            "title": "Sweet",
                                            "detail": "Done."
                                        });
                                    }
                                });
                                cc.on("removed", function(removedReason) {
                                    if (removedReason == "RemovedByThisClient") {
                                        removedReason = "Timed out";
                                    }

                                    self.log("Controller [%s:%s] - Scanner failed: %s", controller.host, controller.port, removedReason);

                                    callback({
                                        "type": "Interface",
                                        "interface": "instruction",
                                        "title": "Scan failed",
                                        "detail": removedReason
                                    });
                                });

                                controller.client.addConnectionChannel(cc);
                            });

                            controller.client.addScanner(controller.scanner);
                        }
                    );

                    respDict = {
                        "type": "Interface",
                        "interface": "instruction",
                        "title": "Scanning...",
                        "detail": "Press your Flic button to add it.",
                        "showActivityIndicator": true
                    }

                    context.scanTimeout = setTimeout(function () {
                        self.controllers.forEach(
                            function(controller) {
                                if (controller.scanner === undefined) {
                                    return;
                                }

                                try {
                                    self.log("Controller [%s:%s] - Scanner removed", controller.host, controller.port);
                                    controller.client.removeScanner(controller.scanner);
                                }
                                catch(e) {

                                }

                                delete controller.scanner;
                            }
                        );

                        callback({
                            "type": "Interface",
                            "interface": "instruction",
                            "title": "Finished",
                            "detail": "Scanning timeout"
                        });
                    }, 60000);

                    context.onScreen = null;
                    break;
                case "Modify":
                case "Remove":
                    respDict = {
                        "type": "Interface",
                        "interface": "list",
                        "title": "Select accessory to " + context.onScreen.toLowerCase(),
                        "allowMultipleSelection": context.onScreen == "Remove",
                        "items": sortAccessories()
                    }

                    context.onScreen = "Do" + context.onScreen;
                    break;
            }

            callback(respDict);
            break;
        default:
            if (request && (request.response || request.type === "Terminate")) {
                context.onScreen = null;
                callback(respDict, "platform", true, this.config);
            }
            else {
                respDict = {
                    "type": "Interface",
                    "interface": "list",
                    "title": "Select option",
                    "allowMultipleSelection": false,
                    "items": ["Add Accessory", "Remove Accessory"]
                }

                context.onScreen = "Menu";
                callback(respDict);
            }
    }
}

FlicPlatform.prototype.connectButton = function(client, bdAddr) {
    var self = this;
    var uuid = UUIDGen.generate(bdAddr);
    var serial = bdAddr.replace(/:/g, '');
    var accessory = this.accessories[uuid];
    var timeout;

    if (accessory === undefined) {
        accessory = this.addAccessory(bdAddr);
    }

    accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, "Shortcut Labs")
        .setCharacteristic(Characteristic.Model, "Flic")
        .setCharacteristic(Characteristic.SerialNumber, serial);

    accessory
        .getService(Service.StatelessProgrammableSwitch)
        .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
        .setProps({maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS});

    var cc = new FlicConnectionChannel(bdAddr);

    client.addConnectionChannel(cc);

    cc.on("buttonSingleOrDoubleClickOrHold", function(clickType, wasQueued, timeDiff) {
        if (wasQueued == true && timeDiff > 5) {
            return;
        }

        self.log("%s - %s", serial, clickType);
        accessory
            .getService(Service.StatelessProgrammableSwitch)
            .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .setValue(Constants.CLICK_TYPE[clickType] || Constants.CLICK_TYPE['ButtonSingleClick']);
    });

    cc.on("connectionStatusChanged", function(connectionStatus, disconnectReason) {
        self.log("%s - %s%s", serial, connectionStatus, (connectionStatus == "Disconnected" ? " " + disconnectReason : ""));
    });

    cc.on("removed", function(reason) {
        self.log("%s - Connection Removed (%s)", serial, reason);
    });
}

FlicPlatform.prototype.connectController = function(controller) {
    var self = this;

    if (typeof controller !== 'object') {
        controller = {host: Constants.DEFAULT_HOST, port: Constants.DEFAULT_PORT};
    }

    if (controller.host === undefined) {
        controller.host = Constants.DEFAULT_HOST;
    }

    if (controller.port === undefined) {
        controller.port = Constants.DEFAULT_PORT;
    }

    controller.buttons = [];
    controller.client = new FlicClient(controller.host, controller.port);

    controller.client.once('ready', function() {
        self.log("Controller [%s:%s] - Connected", controller.host, controller.port);

        controller.client.getInfo(function(info) {
            info.bdAddrOfVerifiedButtons.forEach(function(bdAddr) {
                controller.buttons.push(bdAddr);
                self.connectButton(controller.client, bdAddr);
            });
        });
    });

    controller.client.on("bluetoothControllerStateChange", function(state) {
        self.log("Controller [%s:%s] - %s", controller.host, controller.port, state);
    });

    controller.client.on("newVerifiedButton", function(bdAddr) {
        controller.buttons.push(bdAddr);
        self.connectButton(controller.client, bdAddr);
    });

    controller.client.on("error", function(error) {
        self.log("Controller [%s:%s] - Error: %s", controller.host, controller.port, error);
    });

    controller.client.on("close", function(hadError) {
        self.log("Controller [%s:%s] - Disconnected", controller.host, controller.port);
    });
}

FlicPlatform.prototype.removeAccessory = function(accessory) {
    this.log("Remove: %s", accessory.displayName);

    if (this.accessories[accessory.UUID]) {
        delete this.accessories[accessory.UUID];
    }

    this.api.unregisterPlatformAccessories("homebridge-flic", "Flic", [accessory]);
}
