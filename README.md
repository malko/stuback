# stuback
proxy server to ease api development

## installation:
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

### Sample configuration file explained:
Configuration files can be either a commonjs module like the one below, or a json file. The _.js_ or _.json_ extensions are required.
Stuback watch the configuration file for changes so it will be automatically read on save. If you didn't give him a configuration file it will create one for you in $USERDIR/.stuback.json

Here's a commented sample configuration file:
```javascrip
module.exports = {
	/**********************************************************************************
	* Each host has it's own "hostConfig" section.                                    *
	* The key must match the received reqest hostname.                                *
	* **/!\** when requesting your local machine the request will have a              *
	*         _null_ hostname, _stuback_ will then lookup for a _localhost_ config.   *
	**********************************************************************************/
	localhost: {

		// Optional server to redirect request to
		//(useful when stuback is used as a system or browser proxy)
		targetHost: 'mydevelopmentserver.net',

		// Optional port to redirect request to
		targetPort: '8080',

		// When true stuback will try to proxy any request which doesn't match defined
		// paths in stubbed or backed.
		// If false you will get an error on not stubbed or backed urls.
		// You probably want true for a system defined proxy and probably in most cases
		passthrough: true,

		/***************************************************************************
		* *stubs* contains a list of path which will be looked up for a stub file. *
		***************************************************************************/
		stubs: {
			// Keys are path patterns (as in connect/express) of urls to stubs,
			// they will be looked up in order they are defined.
			'/api/doc.html': true, // boolean value can be used as a shortcut for {use: true}

			'/api/*': {
				// True if ommited, tell stuback whether this path should be used
				// for url matching or not. This is a convenience to quickly disable
				// a path from the config without removing the it from the file.
				use: true,

				// You can defined specific response headers for a given path.
				// They will be applied after hostConfig.responseHeaders and hostConfig.stubs.responseHeaders settings
				// Any falsy value will result in header removal.
				responseHeaders: {
					// add a Content-Type header
					'Content-Type': 'application/vnd.myapimediatype+json',
					// remove any WWW-Authenticate header
					'WWW-Authenticate': false
				}
			},

			// You can defined specific response headers for all stubbed paths at once.
			// They will be applied after hostConfig.responseHeaders settings and
			// before hostConfig.stubs.path.responseHeaders.
			// Falsy values will result in header removal.
			responseHeaders: { 'Content-Type': 'application/json' }

			// don't include this, it's just here to tell you that it's a reserved name
			exp: undefined
		},

		/*************************************************************************************
		* **backed** contains a list of path patterns which will be looked up _after_        *
		* the one in stubs.                                                                  *
		* Each paths has it's own config as in stubs.                                        *
		* If a url matched then it will try to reach the remote server and will backup       *
		* the response in your stubs directory before returning it as a response.            *
		* If the remote server request doesn't work then the backup will be returned instead.*
		* All configs from stubs section may apply here.                                     *
		*************************************************************************************/
		backed: {
			// Keys are path patterns (as in connect/express) of urls to backup.
			// They will be looked up in order they are defined.
			'/*': {
				use: true,
				responseHeaders: {
					'Content-Type': 'Application/json'
				},

				// by default each request to the remote server are considered success
				// whenever the server gave one, whatever their status code is.
				// So stuback will probably save an empty stub on 404 or 500 server error.
				// It can actually be the right thing to reply but if not
				// *backedStatusCode* is a list of remote server statusCode you want to
				// consider erroneous. So the actual stub file will be returned instead
				// if the server respond with one of the given codes
				onStatusCode: [404],

				// don't include this, it's just here to tell you that it's a reserved name
				exp: undefined
			},

			// You can also define statusCodes to consider erroneous for all backed paths at once
			onStatusCode: [500],
		}

		// this is not used at this time but reserved for future use.
		tampered: {}

		// You can set response headers to add to any stuback response for this specific host.
		// They will be applied first in any cases, falsy values will result in header removal.
		responseHeaders: { // list of headers to add to proxyed response, will be removed if falsy
			'X-stuback-custom': 'stubacked'
		}
	}
}
```


### system or browser proxy:
You can use Proxy Automatic Configuration by setting your system or browser automatic proxy settings to ```http://127.0.0.1:3000/proxy.pac``` (change port accodingly to your settings).

This method require no modification to your application code and is quick to set in place.
The bad part is you will have to reset your proxy settings everytime you change your configuration file (changing stubs, backed or tampered may work without changing your settings).
This is the prefered method when working on a remote host with no access to the code or when the code use the endpoint to call at multiple place in your code.


### direct server call:
You can direct your application api calls to localhost or any other address your proxy will respond on and use targetHost and targetPort settings like in sample configuration above.
This has the advantage of not modifying your browser or system proxy settings and so you won't have to reset them on configuration change.
The bad part is you need to modify your code base to direct request to the proxy instead.
This method is prefered when your application can use different hosts depending on env or application settings for example.


### Where to put my stubs
stubs will be organised and looked-up in the following way:
```
/stubs
	|_ hostname
	 	|_ [lowercase_http_verb]-encodeURIComponent(pathUrl)-md5(parameters)
```
use the --verbose option to see which files stuback is trying to reach, so you can easily copy/paste names to create new stubs files.


## This is for the DEV
Stuback is in no way intended to be used for anything else than development.
I use stuback for my daily needs and i'll be happy if it can help you in your job. As always, feature request, contributions(code, documentation or logo) and bug reporting are more than welcome.
