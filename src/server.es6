#!/usr/bin/env node
'use strict';

import connect from 'connect';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
// import https from 'https';
import mkdirp from 'mkdirp';
import path from 'path';
import pathToRegexp from 'path-to-regexp';

const USERDIR = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
const PORTEXP = /:\d+$/;
// a proxy should always remove thoose headers
const PROXYREMOVEDHEADERS = [
	'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'
]; //@FIXME the headers names in th connection header should be removed too.
// some header we want to remove to control when we want to create a backup copy of the response
const PROXYBACKUPREMOVEDHEADERS = [
	'if-modified-since', // avoid getting 304 response on browser refresh
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

const DEFAULT_CONFIG = `module.exports = {
	'localhost': {
		passthrough: true, // if yes will proxy request that are not stubed, backed or tampered
		stubs: [], // list of path to use stubs for
		backed: [], // list of path to automaticly backup and send as stub if the remote server doesn't respond
		tampered: [], // not functionnal for now will handle path where you want to modify request and response on the fly
		targetHost: false, // optional value to redirect request to another host than the one passed in
		targetPort: false // optional value to redirect request to another port than the one requested
	}
};`;

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
	CLIOPTS.config = path.normalize(USERDIR + '/.stuback.js');
	try {
		fs.readFileSync(CLIOPTS.config);
	} catch (e) {
		console.log('create default config file at %s', CLIOPTS.config);
		fs.writeFileSync(CLIOPTS.config, DEFAULT_CONFIG);
	}
}
var configPath = require.resolve(path.normalize(CLIOPTS.config[0] === '/' ? CLIOPTS.config : (process.cwd() + '/' + CLIOPTS.config)));
var config;
function loadConfig() {
	delete require.cache[configPath];
	console.log('loading config');
	config = require(configPath);
	// map config paths to regexps
	let pathMapper = (path) => pathToRegexp(path);
	Object.keys(config).forEach((hostKey) => {
		config[hostKey].stubs && (config[hostKey].stubs = config[hostKey].stubs.map(pathMapper));
		config[hostKey].backed && (config[hostKey].backed = config[hostKey].backed.map(pathMapper));
		config[hostKey].tampered && (config[hostKey].tampered = config[hostKey].tampered.map(pathMapper));
	});
}
loadConfig();
fs.watch(configPath, loadConfig);

/**
 * return a basic hash of the object passed in
 * @param {Object} v object to get hash for
 * @return {string} a hash of the given object
 */
function hashParams(v) {
	if (!(v.length || Object.keys(v).length)) {
		return '';
	}
	return '-' + crypto.createHash('md5').update(JSON.stringify(v)).digest('hex');
}

/**
 * return the path of stub file based on a corresponding request object
 * @param {httpRequest} req the server incoming request to get stub filename for
 * @return {string} the stub path corresponding to this httpRequest
 */
function getStubFileName(req) {
	return CLIOPTS.stubsPath + (req._parsedUrl.hostname || req._parsedUrl.host || 'localhost') + '/' + req.method.toLowerCase() + '-' +
		(req._parsedUrl.path !== '/' ? encodeURIComponent(req._parsedUrl.path.replace(/^\//, '')) : '_') +
		(req.params ? hashParams(req.params) : '')
	;
}

/**
 * This is the real proxy logic middleware
 * It is not use as a direct middleware but rather called by the main stuback middleware
 * @param {httpRequest} req the request received by the main stuback middleware
 * @param {httpResponse} res the response used to by the main stuback middleware to reply to the connected client
 * @param {Function} next the next method to call next connect middleware in the main middleware
 * @param {*} options = {} contains the hostConfig options + some boolean values about the way the middleware should work (isBacked mainly)
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

	//- prepare request headers to proxyRequest and remove unwanted ones
	options.isBacked && removedHeaders.push(...PROXYBACKUPREMOVEDHEADERS);
	removeHeadersExp = new RegExp(`^(${removedHeaders.join('|')})$`);
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

		//- copy proxyResponse headers to clientResponse, replacing and removing unwanted ones as set in hostConfig
		Object.keys(proxyRes.headers).forEach((hname) => res.removeHeader(hname));
		res.setHeader('via', 'stuback');
		if (hostConfig.responseHeaders) {
			Object.keys(hostConfig.responseHeaders).forEach((header) => {
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
			let stubFileName = getStubFileName(req);
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

	//- on proxy error we need to either try to return a stub or pass to the connect middleware
	proxyReq.on('error', (err) => {
		if (options.isBacked) {
			let _options = {
				isStubbed: true,
				isBacked: false,
				isTampered: false,
				hostConfig: {passthrough: false}
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
function stubMiddleware(req, res, next, options = {}) {
	let stubFileName = getStubFileName(req), hostConfig = options.hostConfig;

	VERBOSE && console.log('pattern searching for %s(%s)', req.method, req._parsedUrl.path);

	fs.exists(stubFileName, function (exists) {
		if (!exists) {
			VERBOSE && console.log('patterns didn\'t found response for %s(%s) -> (%s)', req.method, req.url, path.basename(stubFileName));
			if (hostConfig.passthrough) {
				return proxyMiddleware(req, res, next, options);
			}
			return next();
		}
		VERBOSE && console.log('Reply with get/%s', path.basename(stubFileName));
		if (hostConfig.responseHeaders) {
			Object.keys(hostConfig.responseHeaders).forEach((header) => {
				if (hostConfig.responseHeaders[header]) {
					res.setHeader(header, hostConfig.responseHeaders[header]);
				} else {
					res.removeHeader(header);
				}
			});
		}
		let stub = fs.createReadStream(stubFileName);
		stub.pipe(res);
	});
}

//----- STUBACK CONNECT APPLICATION -----//
var app = connect();

//-- proxy auto config generation
app.use('/proxy.pac', function (req, res, next) {
	console.log('serving PAC for %s', req.connection.remoteAddress);
	let address = httpServer.address();
	let localAddress = (address.address.match(/^(|::)$/) ? '127.0.0.1' : address.address) + ':' + address.port;
	let pacConfig = Object.keys(config).map((hostKey) => {
		let direct = config[hostKey].passthrough ? '; DIRECT' : '';
		return `if (shExpMatch(host, '${hostKey}')) return 'PROXY ${localAddress}${direct}';`;
	}).join('\n\t');
	res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
	res.end(`function FindProxyForURL(url, host) {\n\t${pacConfig}\n\treturn "DIRECT";\n}`);
});

//-- do the real job
app.use((req, res, next) => {
	let hostKey = req._parsedUrl.hostname || 'localhost';
	VERBOSE && console.log('request received', hostKey, req.originalUrl);

	//- if no hostConfig be a basic proxy
	if (!config[hostKey]) {
		VERBOSE && console.log('proxying call to %s', hostKey);
		return proxyMiddleware(req, res, next);
	}

	//- augment hostConfig with some values
	let hostConfig = config[hostKey],
		url = req._parsedUrl.path,
		middleWareOptions = {
			isStubbed: hostConfig.stubs.some(function (exp) { return !!url.match(exp); }),
			isBacked: hostConfig.backed.some(function (exp) { return !!url.match(exp); }),
			isTampered: hostConfig.tampered.some(function (exp) { return !!url.match(exp); }),
			hostConfig: hostConfig
		}
	;

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
var httpServer = http.createServer(app).listen(CLIOPTS.port);
console.log(`Stuback listening on port ${CLIOPTS.port}
You can use Automatic proxy configuration at http://localhost:${CLIOPTS.port}/proxy.pac
`);
