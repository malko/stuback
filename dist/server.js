#!/usr/bin/env node

'use strict';

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _connect = require('connect');

var _connect2 = _interopRequireDefault(_connect);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _http = require('http');

var _http2 = _interopRequireDefault(_http);

// import https from 'https';

var _mkdirp = require('mkdirp');

var _mkdirp2 = _interopRequireDefault(_mkdirp);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _pathToRegexp = require('path-to-regexp');

var _pathToRegexp2 = _interopRequireDefault(_pathToRegexp);

var USERDIR = process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'];
var PORTEXP = /:\d+$/;
// a proxy should always remove thoose headers
var PROXYREMOVEDHEADERS = ['host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']; //@FIXME the headers names in th connection header should be removed too.
// some header we want to remove to control when we want to create a backup copy of the response
var PROXYBACKUPREMOVEDHEADERS = ['if-modified-since', // avoid getting 304 response on browser refresh
'accept-encoding' // we want human readable content
];

var HELP_MESSAGE = function HELP_MESSAGE(exitCode) {
	console.log('Stuback is a proxy server to ease api development.\n\nYou can use Automatic proxy configuration at http://localhost:port/proxy.pac\n\nUsage:\nstuback [options] stubRootDir\nwhere stubRootDir arguments is the root directory to store your stubs.\ne.g.\nstuback -p 3000 -c config.js ./stubs\n\nCheck the documentation at https://githube.com/stuback for more info about the config file.\n\nOptions:\n-p,  --port\t\tport to bind stuback on default to 3000\n-c, --config\tconfig file to use default to ./config.js\n-v, --verbose\tturn on verbosity\n-h, --help\t\tthis help\n');
	process.exit(exitCode);
};

var DEFAULT_CONFIG = 'module.exports = {\n\t\'localhost\': {\n\t\tpassthrough: true, // if yes will proxy request that are not stubed, backed or tampered\n\t\tstubs: [], // list of path to use stubs for\n\t\tbacked: [], // list of path to automaticly backup and send as stub if the remote server doesn\'t respond\n\t\ttampered: [], // not functionnal for now will handle path where you want to modify request and response on the fly\n\t\ttargetHost: false, // optional value to redirect request to another host than the one passed in\n\t\ttargetPort: false // optional value to redirect request to another port than the one requested\n\t}\n};';

//----- CLI PARAMETERS PARSING -----//
if (process.argv.length <= 2) {
	HELP_MESSAGE(1);
}
var CLIOPTS = {
	port: 3000,
	config: false,
	stubsPath: false,
	verbose: false
};
process.argv.forEach(function (arg, id) {
	var argValue = process.argv[id + 1];
	switch (arg) {
		case '-h':
		case '--help':
			HELP_MESSAGE(0);
			break;
		case '-p':
		case '--port':
			CLIOPTS.port = argValue;
			break;
		case '-c':
		case '--config':
			CLIOPTS.config = argValue.match(/^\.?\//) ? argValue : './' + argValue;
			break;
		case '-v':
		case '--verbose':
			CLIOPTS.verbose = true;
			break;
		case '-s':
		case '--stubs':
			CLIOPTS.stubsPath = _path2['default'].normalize(argValue + '/');
			break;
	}
});

var VERBOSE = !!CLIOPTS.verbose;

if (!CLIOPTS.stubsPath) {
	console.error('--stubs parameter is required');
	HELP_MESSAGE(1);
}

//----- LOAD CONFIGURATION FILE AND WATCH IT FOR CHANGE -----//
if (!CLIOPTS.config) {
	// use default configuration path and init config file if needed
	CLIOPTS.config = _path2['default'].normalize(USERDIR + '/.stuback.js');
	try {
		_fs2['default'].readFileSync(CLIOPTS.config);
	} catch (e) {
		console.log('create default config file at %s', CLIOPTS.config);
		_fs2['default'].writeFileSync(CLIOPTS.config, DEFAULT_CONFIG);
	}
}
var configPath = require.resolve(_path2['default'].normalize(CLIOPTS.config[0] === '/' ? CLIOPTS.config : process.cwd() + '/' + CLIOPTS.config));
var config;
function loadConfig() {
	delete require.cache[configPath];
	console.log('loading config');
	config = require(configPath);
	// map config paths to regexps
	var pathMapper = function pathMapper(path) {
		return (0, _pathToRegexp2['default'])(path);
	};
	Object.keys(config).forEach(function (hostKey) {
		config[hostKey].stubs && (config[hostKey].stubs = config[hostKey].stubs.map(pathMapper));
		config[hostKey].backed && (config[hostKey].backed = config[hostKey].backed.map(pathMapper));
		config[hostKey].tampered && (config[hostKey].tampered = config[hostKey].tampered.map(pathMapper));
	});
}
loadConfig();
_fs2['default'].watch(configPath, loadConfig);

/**
 * return a basic hash of the object passed in
 * @param {Object} v object to get hash for
 * @return {string} a hash of the given object
 */
function hashParams(v) {
	if (!(v.length || Object.keys(v).length)) {
		return '';
	}
	return '-' + _crypto2['default'].createHash('md5').update(JSON.stringify(v)).digest('hex');
}

/**
 * return the path of stub file based on a corresponding request object
 * @param {httpRequest} req the server incoming request to get stub filename for
 * @return {string} the stub path corresponding to this httpRequest
 */
function getStubFileName(req) {
	return CLIOPTS.stubsPath + (req._parsedUrl.hostname || req._parsedUrl.host || 'localhost') + '/' + req.method.toLowerCase() + '-' + (req._parsedUrl.path !== '/' ? encodeURIComponent(req._parsedUrl.path.replace(/^\//, '')) : '_') + (req.params ? hashParams(req.params) : '');
}

/**
 * This is the real proxy logic middleware
 * It is not use as a direct middleware but rather called by the main stuback middleware
 * @param {httpRequest} req the request received by the main stuback middleware
 * @param {httpResponse} res the response used to by the main stuback middleware to reply to the connected client
 * @param {Function} next the next method to call next connect middleware in the main middleware
 * @param {*} options = {} contains the hostConfig options + some boolean values about the way the middleware should work (isBacked mainly)
 */
function proxyMiddleware(req, res, next) {
	var options = arguments[3] === undefined ? {} : arguments[3];

	req.pause();
	var hostConfig = options.hostConfig || {},
	    requestOptions = {
		hostname: hostConfig.targetHost || req._parsedUrl.hostname || req._parsedUrl.host || req.headers.host.replace(/:\d+$/, ''),
		path: req._parsedUrl.path,
		method: req.method,
		headers: { 'X-Forwarded-For': req.connection.remoteAddress }
	},
	    removedHeaders = PROXYREMOVEDHEADERS.slice(),
	    removeHeadersExp = undefined,
	    port = undefined,
	    proxyReq = undefined,
	    cacheStream = undefined;

	//- prepare request headers to proxyRequest and remove unwanted ones
	options.isBacked && removedHeaders.push.apply(removedHeaders, PROXYBACKUPREMOVEDHEADERS);
	removeHeadersExp = new RegExp('^(' + removedHeaders.join('|') + ')$');
	Object.keys(req.headers).forEach(function (header) {
		header.match(removeHeadersExp) || (requestOptions.headers[header] = req.headers[header]);
	});

	//- check request port settings
	if (hostConfig.targetPort) {
		port = hostConfig.targetPort;
	} else if (req._parsedUrl.port) {
		port = req._parsedUrl.port;
	} else if (req.headers.origin) {
		req.headers.origin.replace(PORTEXP, function (m, p) {
			return port = p;
		});
	}
	port && (requestOptions.port = port);

	VERBOSE && console.log('proxying to %s(http://%s:%s%s)', requestOptions.method, requestOptions.hostname, requestOptions.port || 80, requestOptions.path);

	//- launch the proxyRequest
	proxyReq = _http2['default'].request(requestOptions, function (proxyRes) {
		proxyRes.pause();

		//- copy proxyResponse headers to clientResponse, replacing and removing unwanted ones as set in hostConfig
		Object.keys(proxyRes.headers).forEach(function (hname) {
			return res.removeHeader(hname);
		});
		res.setHeader('via', 'stuback');
		if (hostConfig.responseHeaders) {
			Object.keys(hostConfig.responseHeaders).forEach(function (header) {
				if (hostConfig.responseHeaders[header]) {
					proxyRes.headers[header.toLowerCase()] = hostConfig.responseHeaders[header];
				} else {
					delete proxyRes.headers[header.toLowerCase()];
				}
			});
		}
		res.writeHead(proxyRes.statusCode, proxyRes.headers);

		//- manage backup copy if necessary
		if (options.isBacked) {
			(function () {
				var stubFileName = getStubFileName(req);
				var stubDirname = _path2['default'].dirname(stubFileName);
				_fs2['default'].existsSync(stubDirname) || _mkdirp2['default'].sync(stubDirname);
				cacheStream = _fs2['default'].createWriteStream(stubFileName);
				cacheStream.on('close', function () {
					VERBOSE && console.log('backed in %s', stubFileName);
				});
				proxyRes.pipe(cacheStream);
			})();
		}

		//- pipe the proxyResponse content to the clientResponse;
		proxyRes.pipe(res);
		proxyRes.resume();
	});

	//- on proxy error we need to either try to return a stub or pass to the connect middleware
	proxyReq.on('error', function (err) {
		if (options.isBacked) {
			var _options = {
				isStubbed: true,
				isBacked: false,
				isTampered: false,
				hostConfig: { passthrough: false }
			};
			stubMiddleware(req, res, next, _options);
		} else {
			next(err);
		}
		VERBOSE && console.error('ERROR', err);
	});

	//- finaly piping clientReqest body to proxyRequest
	req.pipe(proxyReq);
	req.resume();
}

/**
 * This middleware should return the stubbed content if any for the given request.
 * Regarding the hostConfig passthrough settings will wall the remote server if a stub file is not présent.
 * @param {httpRequest} req the request received by the main stuback middleware
 * @param {httpResponse} res the response used to by the main stuback middleware to reply to the connected client
 * @param {Function} next the next method to call next connect middleware in the main middleware
 * @param {*} options = {} contains the hostConfig options + some boolean values about the way the middleware should work
 */
function stubMiddleware(req, res, next) {
	var options = arguments[3] === undefined ? {} : arguments[3];

	var stubFileName = getStubFileName(req);

	VERBOSE && console.log('pattern searching for %s(%s)', req.method, req._parsedUrl.path);

	_fs2['default'].exists(stubFileName, function (exists) {
		if (!exists) {
			VERBOSE && console.log('patterns didn\'t found response for %s(%s) -> (%s)', req.method, req.url, _path2['default'].basename(stubFileName));
			if (options.hostConfig.passthrough) {
				return proxyMiddleware(req, res, next, options);
			}
			return next();
		}
		VERBOSE && console.log('Reply with get/%s', _path2['default'].basename(stubFileName));
		var stub = _fs2['default'].createReadStream(stubFileName);
		stub.pipe(res);
	});
}

//----- STUBACK CONNECT APPLICATION -----//
var app = (0, _connect2['default'])();

//-- proxy auto config generation
app.use('/proxy.pac', function (req, res, next) {
	console.log('serving PAC for %s', req.connection.remoteAddress);
	var address = httpServer.address();
	var localAddress = (address.address.match(/^(|::)$/) ? '127.0.0.1' : address.address) + ':' + address.port;
	var pacConfig = Object.keys(config).map(function (hostKey) {
		var direct = config[hostKey].passthrough ? '; DIRECT' : '';
		return 'if (shExpMatch(host, \'' + hostKey + '\')) return \'PROXY ' + localAddress + '' + direct + '\';';
	}).join('\n\t');
	res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
	res.end('function FindProxyForURL(url, host) {\n\t' + pacConfig + '\n\treturn "DIRECT";\n}');
});

//-- do the real job
app.use(function (req, res, next) {
	var hostKey = req._parsedUrl.hostname || 'localhost';
	VERBOSE && console.log('request received', hostKey, req.originalUrl);

	//- if no hostConfig be a basic proxy
	if (!config[hostKey]) {
		VERBOSE && console.log('proxying call to %s', hostKey);
		return proxyMiddleware(req, res, next);
	}

	//- augment hostConfig with some values
	var hostConfig = config[hostKey],
	    url = req._parsedUrl.path,
	    middleWareOptions = {
		isStubbed: hostConfig.stubs.some(function (exp) {
			return !!url.match(exp);
		}),
		isBacked: hostConfig.backed.some(function (exp) {
			return !!url.match(exp);
		}),
		isTampered: hostConfig.tampered.some(function (exp) {
			return !!url.match(exp);
		}),
		hostConfig: hostConfig
	};

	//- adopt the strategy corresponding to hostConfig
	if (middleWareOptions.isStubbed) {
		stubMiddleware(req, res, next, middleWareOptions);
	} else if (middleWareOptions.isBacked) {
		proxyMiddleware(req, res, next, middleWareOptions);
	} else if (middleWareOptions.passthrough) {
		proxyMiddleware(req, res, next);
	} else {
		next();
	}
});

//----- FINALLY START THE STUBACK SERVER -----//
var httpServer = _http2['default'].createServer(app).listen(CLIOPTS.port);
console.log('Stuback listening on port ' + CLIOPTS.port + '\nYou can use Automatic proxy configuration at http://localhost:' + CLIOPTS.port + '/proxy.pac\n');
