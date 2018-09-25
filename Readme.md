# Apacheconf parser for Node.js

[![Dependency Status](https://gemnasium.com/tellnes/node-apacheconf.png)](https://gemnasium.com/tellnes/node-apacheconf)

Apacheconf is an apache config file parser for Node.js.


## Example

```js

    var apacheconf = require('apacheconf')

    const parser = apacheconf('/etc/apache2/httpd.conf', function(err, config, parser) {
      if (err) throw err

      console.log(config)
    })
```

You can also listen for events when config values are found (with keys).

```js
// Any value
parser.on('emit', function (key, value) {})

// Desired value
parser.on('VirtualHost', function (value) {})
```


## Install

    npm install apacheconf


## Server root

- Server root will be automatically detected based on file location (uses dirname): `/etc/apache2/httpd.conf` > `/etc/apache2/`.
- If config contains `ServerRoot` settings, the path from config will be used.

## Licence

MIT
