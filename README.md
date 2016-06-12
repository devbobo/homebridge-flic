# homebridge-flic
[![NPM Version](https://img.shields.io/npm/v/homebridge-flic.svg)](https://www.npmjs.com/package/homebridge-flic)

[Flic](https://flic.io) plugin for [Homebridge](https://github.com/nfarina/homebridge).

# Requirements

This plugin requires the [Flic SDK for Linux](https://github.com/50ButtonsEach/fliclib-linux-hci) installed on a machine to run.

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-flic
3. Update your configuration file. See the sample below.

# Updating

- npm update -g homebridge-lifx-lan

# Configuration

Configuration sample:

 ```javascript
"platforms": [
    {
        "platform": "Flic",
        "name": "Flic",
        "controllers": [
            {"host": "locahost", "port": 5551}
        ]
    }
]

```
