#!/usr/bin/env node

'use strict';

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _connect = require('connect');

var _connect2 = _interopRequireDefault(_connect);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _http = require('http');

var _http2 = _interopRequireDefault(_http);

// import https from 'https';

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _mkdirp = require('mkdirp');

var _mkdirp2 = _interopRequireDefault(_mkdirp);

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

var _config = require('./config');

var _config2 = _interopRequireDefault(_config);

// add stuback admin middlewares to the party

var _admin = require('./admin');

var _admin2 = _interopRequireDefault(_admin);

var USERDIR = process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'];
var PORTEXP = /:\d+$/;
// a proxy should always remove thoose headers
var PROXYREMOVEDHEADERS = ['host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']; //@FIXME the headers names in th connection header should be removed too.
// some header we want to remove to control when we want to create a backup copy of the response
var PROXYBACKUPREMOVEDHEADERS = [
// avoid getting 304 response on browser refresh
'if-modified-since', 'if-none-match', 'accept-encoding' // we want human readable content
];

var HELP_MESSAGE = function HELP_MESSAGE(exitCode) {
	console.log('Stuback is a proxy server to ease api development.\n\nYou can use Automatic proxy configuration at http://localhost:port/proxy.pac\n\nUsage:\nstuback [options] --stubs stubRootDir\nwhere stubRootDir arguments is the root directory to store your stubs.\ne.g.\nstuback -p 3000 -c stuback.js ./stubs\n\nCheck the documentation at https://github.com/stuback for more info about the config file.\n\nOptions:\n-c, --config    config file to use default to USERDIR/.stuback.js\n                will create one if none exists\n-h, --help      display this help\n-p, --port      port to bind stuback on default to 3000\n-s, --stubs     root directory of your stubs files (required)\n-v, --verbose   turn on verbosity\n');
	process.exit(exitCode);
};

var DEFAULT_CONFIG = '{\n\t"localhost": {\n\t\t"passthrough": true,\n\t\t"stubs": {},\n\t\t"backed": {},\n\t\t"tampered": {},\n\t\t"targetHost": false,\n\t\t"targetPort": false\n\t}\n}';

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
	CLIOPTS.config = _path2['default'].normalize(USERDIR + '/.stuback.json');
	try {
		_fs2['default'].readFileSync(CLIOPTS.config);
	} catch (e) {
		console.log('create default config file at %s', CLIOPTS.config);
		_fs2['default'].writeFileSync(CLIOPTS.config, DEFAULT_CONFIG);
	}
}
var configPath;
try {
	configPath = require.resolve(_path2['default'].normalize(CLIOPTS.config[0] === '/' ? CLIOPTS.config : process.cwd() + '/' + CLIOPTS.config));
} catch (e) {
	console.error('Error loading configuration file %s', CLIOPTS.config);
	process.exit(1);
}
var config = new _config2['default'](configPath, CLIOPTS, function () {
	return httpServer;
});

/**
 * This is the real proxy logic middleware
 * It is not use as a direct middleware but rather called by the main stuback middleware
 * @param {httpRequest} req the request received by the main stuback middleware
 * @param {httpResponse} res the response used to by the main stuback middleware to reply to the connected client
 * @param {Function} next the next method to call next connect middleware in the main middleware
 * @param {*} options = {} contains the hostConfig options + some boolean values about the way the middleware should work (backedBy mainly)
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

	//- on proxy error we need to either try to return a stub or pass to the connect middleware
	function onError(err) {
		VERBOSE && console.error('ERROR', err);
		if (options.backedBy) {
			options.hostConfig.passthrough = false;
			stubMiddleware(req, res, next, options);
		} else {
			next(err);
		}
	}

	//- prepare request headers to proxyRequest and remove unwanted ones
	options.backedBy && removedHeaders.push.apply(removedHeaders, PROXYBACKUPREMOVEDHEADERS);
	removeHeadersExp = new RegExp('^(' + removedHeaders.join('|') + ')$', 'i');
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
		// check for backed status code
		if (options.backedBy) {
			var backedCodes = hostConfig.backed.onStatusCode;
			var pathCodes = hostConfig.backed[options.backedBy].onStatusCode;
			var statusCode = proxyRes.statusCode;
			if (backedCodes && ~backedCodes.indexOf(statusCode) || pathCodes && ~pathCodes.indexOf(statusCode)) {
				return onError('Status code rejection(' + statusCode + ')');
			}
		}

		//- copy proxyResponse headers to clientResponse, replacing and removing unwanted ones as set in hostConfig
		Object.keys(proxyRes.headers).forEach(function (hname) {
			return res.removeHeader(hname);
		});
		res.setHeader('via', 'stuback');
		if (hostConfig.responseHeaders) {
			_utils2['default'].applyIncomingMessageHeaders(proxyRes, hostConfig.responseHeaders);
		}
		res.writeHead(proxyRes.statusCode, proxyRes.headers);

		//- manage backup copy if necessary
		if (options.backedBy) {
			(function () {
				var stubFileName = _utils2['default'].getStubFileName(CLIOPTS.stubsPath, req);
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

	proxyReq.on('error', onError);

	//- finaly piping clientReqest body to proxyRequest
	req.pipe(proxyReq);
	req.resume();
}

/**
 * This middleware should return the stubbed content if any for the given request.
 * Regarding the hostConfig passthrough settings will call the remote server if a stub file is not présent.
 * @param {httpRequest} req the request received by the main stuback middleware
 * @param {httpResponse} res the response used to by the main stuback middleware to reply to the connected client
 * @param {Function} next the next method to call next connect middleware in the main middleware
 * @param {*} options = {} contains the hostConfig options + some boolean values about the way the middleware should work
 */
function stubMiddleware(req, res, next) {
	var options = arguments[3] === undefined ? {} : arguments[3];

	var stubFileName = _utils2['default'].getStubFileName(CLIOPTS.stubsPath, req),
	    hostConfig = options.hostConfig;

	VERBOSE && console.log('pattern searching for %s(%s)', req.method, req._parsedUrl.path);

	_fs2['default'].exists(stubFileName, function (exists) {
		if (!exists) {
			VERBOSE && console.log('patterns didn\'t found response for %s(%s) -> (%s)', req.method, req.url, _path2['default'].basename(stubFileName));
			if (hostConfig.passthrough) {
				hostConfig.backedBy = false; // ensure we won't loop
				return proxyMiddleware(req, res, next, options);
			}
			return next();
		}
		VERBOSE && console.log('Reply with get/%s', _path2['default'].basename(stubFileName));
		_utils2['default'].applyResponseHeaders(res, hostConfig.responseHeaders);
		if (options.stubbedBy) {
			_utils2['default'].applyResponseHeaders(res, hostConfig.stubs.responseHeaders);
			_utils2['default'].applyResponseHeaders(res, hostConfig.stubs[options.stubbedBy].responseHeaders);
			var statusCode = hostConfig.stubs[options.stubbedBy].statusCode;
			statusCode && (res.statusCode = statusCode);
		} else if (options.backedBy) {
			_utils2['default'].applyResponseHeaders(res, hostConfig.backed.responseHeaders);
			_utils2['default'].applyResponseHeaders(res, hostConfig.backed[options.backedBy].responseHeaders);
			var statusCode = hostConfig.backed[options.backedBy].statusCode;
			statusCode && (res.statusCode = statusCode);
		}
		var stub = _fs2['default'].createReadStream(stubFileName);
		stub.pipe(res);
	});
}

//----- STUBACK CONNECT APPLICATION -----//
var app = (0, _connect2['default'])();
_admin2['default'].use(app, CLIOPTS, config);

//-- do the real job
app.use(function (req, res, next) {
	var hostKey = req._parsedUrl.hostname || 'localhost';
	var hostConfig = config.getHostConfig(hostKey);
	VERBOSE && console.log('request received', hostKey, req.originalUrl);

	//- if no hostConfig be a basic proxy
	if (!hostConfig) {
		VERBOSE && console.log('proxying call to %s', hostKey);
		return proxyMiddleware(req, res, next);
	}

	//- augment hostConfig with some values
	var url = req._parsedUrl.path,
	    middleWareOptions = {
		stubbedBy: _utils2['default'].pathMatchingLookup(url, hostConfig.stubs),
		backedBy: _utils2['default'].pathMatchingLookup(url, hostConfig.backed),
		tamperedBy: _utils2['default'].pathMatchingLookup(url, hostConfig.tampered),
		hostConfig: hostConfig
	};

	//- adopt the strategy corresponding to hostConfig
	if (middleWareOptions.stubbedBy) {
		stubMiddleware(req, res, next, middleWareOptions);
	} else if (middleWareOptions.backedBy) {
		proxyMiddleware(req, res, next, middleWareOptions);
	} else if (middleWareOptions.passthrough) {
		proxyMiddleware(req, res, next);
	} else {
		next();
	}
});

//----- FINALLY START THE STUBACK SERVER -----//
var httpServer = _http2['default'].createServer(app).listen(CLIOPTS.port);
console.log('Stuback listening on port ' + CLIOPTS.port + '\nYou can use Automatic proxy configuration at http://localhost:' + CLIOPTS.port + '/stuback/proxy.pac\n');