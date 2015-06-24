# stuback
proxy server to ease api development

installation:
```
npm install -g stuback
```

launch the server like this
```
stuback -p 3000 -c config.js -s ./stubs
```

See sample config file for now for more info about configuration.
The config file will be watched for changes so you can edit without reloading the server.

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
		targetHost: 'mydevelopmentserver.net', // optional server to redirect request to
		targetPort: '8080', // optional port to redirect request to
		passthrough: true, // true is certainly what you want, if false you will get an error on not stubbed or backed urls
		stubs: ['/api/*'], // a list of patterns (as in connect / express) of urls to stubs
		backed: ['/api/*'], // a list of patterns to keep backup in case of remote server not responding
		tampered: [], // this is not used at this time
		responseHeaders: { // list of headers to add to proxyed response, will be removed if falsy
			'Access-Control-Allow-Origin': '*',
			'WWW-Authenticate': false
		}
	}
}
```

This has the advantage of not modifying your browser or system proxy settings and so you won't have to reset them on configuration change.
The bad part is you need your code base to direct request to the proxy directly.
This method is prefered when your application can use different hosts depending on env settings for example.

### Where to put my stubs
stubs will be organised and looked-up in the following way:
```
/stubs
	|_ hostname
	 	|_ [lowercase_http_verb]-encodeURIComponent(pathUrl)-md5(parameters)
```
use the --verbose option to see which files stuback is trying to reach, so you can easily copy/paste names to create new stubs files.

### This is for the DEV
Stuback is in no way intended to be used for anything else than development.
I use stuback for my daily needs and i'll be happy if it can help you in your job. As always, feature request, contributions(code, documentation or logo) and bug reporting are more than welcome.
