#!/usr/bin/env node
'use strict';

import connect from 'connect';
import fs from 'fs';
import http from 'http';
// import https from 'https';
import path from 'path';
import mkdirp from 'mkdirp';
import utils from './utils';
import Config from './config';

const USERDIR = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
const PORTEXP = /:\d+$/;
// a proxy should always remove thoose headers
const PROXYREMOVEDHEADERS = [
	'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'
]; //@FIXME the headers names in th connection header should be removed too.
// some header we want to remove to control when we want to create a backup copy of the response
const PROXYBACKUPREMOVEDHEADERS = [
	// avoid getting 304 response on browser refresh
	'if-modified-since',
	'if-none-match',
	'accept-encoding' // we want human readable content
];

const HELP_MESSAGE = (exitCode) => {
	console.log(
`Stuback is a proxy server to ease api development.

You can use Automatic proxy configuration at http://localhost:port/proxy.pac

Usage:
stuback [options] --stubs stubRootDir
where stubRootDir arguments is the root directory to store your stubs.
e.g.
stuback -p 3000 -c stuback.js ./stubs

Check the documentation at https://github.com/stuback for more info about the config file.

Options:
-c, --config    config file to use default to USERDIR/.stuback.js
                will create one if none exists
-h, --help      display this help
-p, --port      port to bind stuback on default to 3000
-s, --stubs     root directory of your stubs files (required)
-v, --verbose   turn on verbosity
`
	);
	process.exit(exitCode);
};

const DEFAULT_CONFIG = `{
	"localhost": {
		"passthrough": true,
		"stubs": {},
		"backed": {},
		"tampered": {},
		"targetHost": false,
		"targetPort": false
	}
}`;

//----- CLI PARAMETERS PARSING -----//
if (process.argv.length <= 2) {
	HELP_MESSAGE(1);
}
const CLIOPTS = {
	port: 3000,
	config: false,
	stubsPath: false,
	verbose: false
};
process.argv.forEach((arg, id) => {
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
			CLIOPTS.stubsPath = path.normalize(argValue + '/');
			break;
	}
});

const VERBOSE = !!CLIOPTS.verbose;

if (!CLIOPTS.stubsPath) {
	console.error('--stubs parameter is required');
	HELP_MESSAGE(1);
}

//----- LOAD CONFIGURATION FILE AND WATCH IT FOR CHANGE -----//
if (!CLIOPTS.config) { // use default configuration path and init config file if needed
	CLIOPTS.config = path.normalize(USERDIR + '/.stuback.json');
	try {
		fs.readFileSync(CLIOPTS.config);
	} catch (e) {
		console.log('create default config file at %s', CLIOPTS.config);
		fs.writeFileSync(CLIOPTS.config, DEFAULT_CONFIG);
	}
}
var configPath;
try {
	configPath = require.resolve(path.normalize(CLIOPTS.config[0] === '/' ? CLIOPTS.config : (process.cwd() + '/' + CLIOPTS.config)));
} catch (e) {
	console.error('Error loading configuration file %s', CLIOPTS.config);
	process.exit(1);
}
var config = new Config(configPath, CLIOPTS, () => httpServer);

/**
 * This is the real proxy logic middleware
 * It is not use as a direct middleware but rather called by the main stuback middleware
 * @param {httpRequest} req the request received by the main stuback middleware
 * @param {httpResponse} res the response used to by the main stuback middleware to reply to the connected client
 * @param {Function} next the next method to call next connect middleware in the main middleware
 * @param {*} options = {} contains the hostConfig options + some boolean values about the way the middleware should work (backedBy mainly)
 */
function proxyMiddleware(req, res, next, options = {}) {
	req.pause();
	let hostConfig = options.hostConfig || {},
		requestOptions = {
			hostname: hostConfig.targetHost || req._parsedUrl.hostname || req._parsedUrl.host || req.headers.host.replace(/:\d+$/, ''),
			path: req._parsedUrl.path,
			method: req.method,
			headers: {'X-Forwarded-For': req.connection.remoteAddress}
		},
		removedHeaders = PROXYREMOVEDHEADERS.slice(),
		removeHeadersExp,
		port,
		proxyReq,
		cacheStream
	;

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
	options.backedBy && removedHeaders.push(...PROXYBACKUPREMOVEDHEADERS);
	removeHeadersExp = new RegExp(`^(${removedHeaders.join('|')})$`, 'i');
	Object.keys(req.headers).forEach((header) => {
		header.match(removeHeadersExp) || (requestOptions.headers[header] = req.headers[header]);
	});

	//- check request port settings
	if (hostConfig.targetPort) {
		port = hostConfig.targetPort;
	} else if (req._parsedUrl.port) {
		port = req._parsedUrl.port;
	} else if (req.headers.origin) {
		req.headers.origin.replace(PORTEXP, (m, p) => port = p);
	}
	port && (requestOptions.port = port);

	VERBOSE && console.log('proxying to %s(http://%s:%s%s)', requestOptions.method, requestOptions.hostname, requestOptions.port || 80, requestOptions.path);

	//- launch the proxyRequest
	proxyReq = http.request(requestOptions, (proxyRes) => {
		proxyRes.pause();
		// check for backed status code
		if (options.backedBy) {
			let backedCodes = hostConfig.backed.onStatusCode;
			let pathCodes = hostConfig.backed[options.backedBy].onStatusCode;
			let statusCode = proxyRes.statusCode;
			if ((backedCodes && ~backedCodes.indexOf(statusCode)) || (pathCodes && ~pathCodes.indexOf(statusCode))) {
				return onError('Status code rejection(' + statusCode + ')');
			}
		}

		//- copy proxyResponse headers to clientResponse, replacing and removing unwanted ones as set in hostConfig
		Object.keys(proxyRes.headers).forEach((hname) => res.removeHeader(hname));
		res.setHeader('via', 'stuback');
		if (hostConfig.responseHeaders) {
			utils.applyIncomingMessageHeaders(proxyRes, hostConfig.responseHeaders);
		}
		res.writeHead(proxyRes.statusCode, proxyRes.headers);

		//- manage backup copy if necessary
		if (options.backedBy) {
			let stubFileName = utils.getStubFileName(CLIOPTS.stubsPath, req);
			let stubDirname = path.dirname(stubFileName);
			fs.existsSync(stubDirname) || mkdirp.sync(stubDirname);
			cacheStream = fs.createWriteStream(stubFileName);
			cacheStream.on('close', () => {
				VERBOSE && console.log('backed in %s', stubFileName);
			});
			proxyRes.pipe(cacheStream);
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
function stubMiddleware(req, res, next, options = {}) {
	let stubFileName = utils.getStubFileName(CLIOPTS.stubsPath, req), hostConfig = options.hostConfig;

	VERBOSE && console.log('pattern searching for %s(%s)', req.method, req._parsedUrl.path);

	fs.exists(stubFileName, function (exists) {
		if (!exists) {
			VERBOSE && console.log('patterns didn\'t found response for %s(%s) -> (%s)', req.method, req.url, path.basename(stubFileName));
			if (hostConfig.passthrough) {
				hostConfig.backedBy = false; // ensure we won't loop
				return proxyMiddleware(req, res, next, options);
			}
			return next();
		}
		VERBOSE && console.log('Reply with get/%s', path.basename(stubFileName));
		utils.applyResponseHeaders(res, hostConfig.responseHeaders);
		if (options.stubbedBy) {
			utils.applyResponseHeaders(res, hostConfig.stubs.responseHeaders);
			utils.applyResponseHeaders(res, hostConfig.stubs[options.stubbedBy].responseHeaders);
			let statusCode = hostConfig.stubs[options.stubbedBy].statusCode;
			statusCode && (res.statusCode = statusCode);
		} else if (options.backedBy) {
			utils.applyResponseHeaders(res, hostConfig.backed.responseHeaders);
			utils.applyResponseHeaders(res, hostConfig.backed[options.backedBy].responseHeaders);
			let statusCode = hostConfig.backed[options.backedBy].statusCode;
			statusCode && (res.statusCode = statusCode);
		}
		let stub = fs.createReadStream(stubFileName);
		stub.pipe(res);
	});
}

//----- STUBACK CONNECT APPLICATION -----//
var app = connect();

// add stuback admin middlewares to the party
import admin from './admin';
admin.use(app, CLIOPTS, config);

//-- do the real job
app.use((req, res, next) => {
	let hostKey = req._parsedUrl.hostname || 'localhost';
	let hostConfig = config.getHostConfig(hostKey);
	VERBOSE && console.log('request received', hostKey, req.originalUrl);

	//- if no hostConfig be a basic proxy
	if (!hostConfig) {
		VERBOSE && console.log('proxying call to %s', hostKey);
		return proxyMiddleware(req, res, next);
	}

	//- augment hostConfig with some values
	let url = req._parsedUrl.path,
		middleWareOptions = {
			stubbedBy: utils.pathMatchingLookup(url, hostConfig.stubs),
			backedBy: utils.pathMatchingLookup(url, hostConfig.backed),
			tamperedBy: utils.pathMatchingLookup(url, hostConfig.tampered),
			hostConfig: hostConfig
		}
	;

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
var httpServer = http.createServer(app).listen(CLIOPTS.port);
console.log(`Stuback listening on port ${CLIOPTS.port}
You can use Automatic proxy configuration at http://localhost:${CLIOPTS.port}/stuback/proxy.pac
Admin at http://localhost:${CLIOPTS.port}/stuback/admin
`);
