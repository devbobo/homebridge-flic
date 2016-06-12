'use strict';

var http = require('http');
var fliclib = require('./fliclib');
var FlicClient = fliclib.FlicClient;
var FlicConnectionChannel = fliclib.FlicConnectionChannel;

var Accessory, Characteristic, Service, UUIDGen;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform('homebridge-flic', 'Flic', FlicPlatform, true);
};

var Constants = {
    DEFAULT_HOST: 'localhost',
    DEFAULT_PORT: 5551,
    SINGLE_CLICK: 1,
    DOUBLE_CLICK: 2,
    HOLD: 3
}

Constants.CLICK_TYPE = {
    'ButtonSingleClick': Constants.SINGLE_CLICK,
    'ButtonDoubleClick': Constants.DOUBLE_CLICK,
    'ButtonHold':        Constants.HOLD
}

function FlicPlatform(log, config, api) {
    var self = this;

    this.config = config || {};
    this.api = api;
    this.accessories = {};
    this.controllers = config.controllers || [{host: Constants.DEFAULT_HOST, port: Constants.DEFAULT_PORT}];
    this.log = log;

    this.requestServer = http.createServer();

    this.requestServer.on('error', function(err) {

    });

    this.requestServer.listen(18094, function() {
        self.log("Server Listening...");
    });

    this.api.on('didFinishLaunching', function() {
        self.controllers.forEach(
            function(controller) {
                self.connectController(controller);
            }
        );
    });
}

FlicPlatform.prototype.addAccessory = function(bdAddr) {
    this.log("Found: %s", bdAddr);

    var accessory = new Accessory(bdAddr, UUIDGen.generate(bdAddr));

    accessory
        .addService(Service.StatelessProgrammableSwitch)
        .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
        .setProps({ maxValue: 3 });

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
            function(k){return this[k] instanceof PlatformAccessory ? this[k] : this[k].accessory},
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
            context.onScreen = request && request.response && request.response.selections[0] == 1 ? "Remove" : "Modify";
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
                    "items": ["Remove Accessory"]
                }

                context.onScreen = "Menu";
                callback(respDict);
            }
    }
}

FlicPlatform.prototype.connectButton = function(client, bdAddr) {
    var self = this;
    var uuid = UUIDGen.generate(bdAddr);
    var accessory = this.accessories[uuid];
    var timeout;

    if (accessory === undefined) {
        accessory = this.addAccessory(bdAddr);
    }

    accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, "Flic")
        .setCharacteristic(Characteristic.Model, "Wireless Smart Button")
        .setCharacteristic(Characteristic.SerialNumber, bdAddr);

    accessory.updateReachability(true);

    var cc = new FlicConnectionChannel(bdAddr);

    client.addConnectionChannel(cc);

    cc.on("buttonSingleOrDoubleClickOrHold", function(clickType, wasQueued, timeDiff) {
        if (wasQueued == true && timeDiff > 5) {
            return;
        }

        self.log("%s - %s", bdAddr, clickType);
        accessory.getService(Service.StatelessProgrammableSwitch).getCharacteristic(Characteristic.ProgrammableSwitchEvent).setValue(Constants.CLICK_TYPE[clickType] || Constants.SINGLE_CLICK);

        clearTimeout(timeout);
        timeout = setTimeout(function () {
            accessory.getService(Service.StatelessProgrammableSwitch).getCharacteristic(Characteristic.ProgrammableSwitchEvent).setValue(0);
        }, 1000);
    });

    cc.on("connectionStatusChanged", function(connectionStatus, disconnectReason) {
        self.log("%s - %s%s", bdAddr, connectionStatus, (connectionStatus == "Disconnected" ? " " + disconnectReason : ""));
    });

    cc.on("removed", function(reason) {
        self.log("%s - Connection Removed (%s)", bdAddr, reason);
        accessory.updateReachability(false);
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

        controller.buttons.forEach(
            function(bdAddr) {
                var uuid = UUIDGen.generate(bdAddr);
                var accessory = self.accessories[uuid];

                if (accessory !== undefined) {
                    accessory.updateReachability(false);
                }
            }
        );

        setTimeout(function() {self.connectController(controller);}, 60000);
    });
}

FlicPlatform.prototype.removeAccessory = function(accessory) {
    this.log("Remove: %s", accessory.displayName);

    if (this.accessories[accessory.UUID]) {
        delete this.accessories[accessory.UUID];
    }

    this.api.unregisterPlatformAccessories("homebridge-flic", "Flic", [accessory]);
}

