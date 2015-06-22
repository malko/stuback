# stuback
proxy server to ease api development

installation:
```
npm install -g stuback
```

launch the server like this
```
stuback -p 3000 -c config.js ./stubs
```

see sample config file for now for more info about configuration.

## How to work with stuback?

### system or browser proxy:
You can use Proxy Automatic Configuration by setting your system or browser automatic proxy settings to ```http://127.0.0.1:3000/proxy.pac``` (change port accodingly to your settings).

This method require no modification to your application code and is quick to set in place.
The bad part is you will have to reset your proxy settings everytime you change your configuration file (changing stubs, backed or tampered may work without changing your settings).
This is the prefered method when working on a remote host with no access to the code or when the code use the endpoint to call at multiple place in your code.

### direct server call:
You can direct your application api calls to localhost or any other address your proxy will respond on and use settings like the followings:
```
module.exports = {
	localhost: {
		targetHost: 'mydevelopmentserver.net',
		targetPort: '8080',
		passthrough: true,
		stubs: ['/api/*'],
		backed: ['/api/*'],
		tampered: []
	}
}
```

This has the advantage of not modifying your browser or system proxy settings and so you won't have to reset them on configuration change.
The bad part is you need your code base to direct request to the proxy directly.
This method is prefered when your application can use different hosts depending on env settings for example.
