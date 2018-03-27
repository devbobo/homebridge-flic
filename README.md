# homebridge-flic

[![npm package](https://nodei.co/npm/homebridge-flic.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/homebridge-flic/)

[![Slack Channel](https://img.shields.io/badge/slack-homebridge--flic-e01563.svg)](https://homebridgeteam.slack.com/messages/C560YBZ8E/)

[Flic](https://flic.io) plugin for [Homebridge](https://github.com/nfarina/homebridge).

# Requirements

This plugin requires the Flic Daemon to be installed on a machine to run.

There are platform specific versions to choose from...
- [fliclib-linux-hci](https://github.com/50ButtonsEach/fliclib-linux-hci)
- [flic-service-osx](https://github.com/50ButtonsEach/flic-service-osx)
- [fliclib-windows](https://github.com/50ButtonsEach/fliclib-windows)

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-flic
3. Update your configuration file. See the sample below.

# Updating

- npm update -g homebridge-flic

# Configuration

Configuration sample:

 ```javascript
"platforms": [
    {
        "platform": "Flic",
        "name": "Flic",
        "controllers": [
            {"host": "localhost", "port": 5551}
        ]
    }
]

```
