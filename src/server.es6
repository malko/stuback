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

// cli parameters parsing
const cliOpts = {
	port: 3000,
	config: 'config.js',
	stubPaths: path.normalize(process.argv.pop() + '/'),
	verbose: false
};
process.argv.forEach((arg, id) => {
	var argValue = process.argv[id+1];
	switch(arg){
		case "-h":
		case "--help":
			console.log(
`Stuback is a proxy server to ease api development.

You can use Automatic proxy configuration at http://localhost:port/proxy.pac

Usage:
stuback [options] stubRootDir
where stubRootDir arguments is the root directory to store your stubs.
e.g.
stuback -p 3000 -c config.js ./stubs

Check the documentation at https://githube.com/stuback for more info about the config file.

Options:
-p,  --port		port to bind stuback on default to 3000
-c, --config	config file to use default to ./config.js
-v, --verbose	turn on verbosity
-h, --help		this help
`);
			process.exit(0);
			break;
		case "-p":
		case "--port":
			cliOpts.port = argValue;
			break;
		case "-c":
		case "--config":
			cliOpts.config = argValue.match(/^\.?\//) ? argValue : './' + argValue;
			break;
		case "-v":
		case "--verbose":
			cliOpts.verbose = true;
			break;
	}
});

const config = require(path.normalize(process.cwd() + '/' + cliOpts.config));

const portExp = /:\d+$/;
const verbose = !!cliOpts.verbose;
const proxyRemovedHeaders = [
	'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'
];
const proxyBackupRemovedHeaders = [
	'if-modified-since', // avoid getting 304 response on browser refresh
	'accept-encoding' // we want human readable content
];

// map config paths to regexps
Object.keys(config).forEach((hostKey) => {
	config[hostKey].stubs && (config[hostKey].stubs = config[hostKey].stubs.map(pathToRegexp));
	config[hostKey].backed && (config[hostKey].backed = config[hostKey].backed.map(pathToRegexp));
	config[hostKey].tampered && (config[hostKey].tampered = config[hostKey].tampered.map(pathToRegexp));
});

function hashParams(v) {
	if (!(v.length || Object.keys(v).length)) {
		return '';
	}
	return '-' + crypto.createHash('md5').update(JSON.stringify(v)).digest('hex');
}

function getStubFileName(req) {
	return cliOpts.stubPaths + (req._parsedUrl.hostname || req._parsedUrl.host) + '/' + req.method.toLowerCase() + '-' +
		(req._parsedUrl.path !== '/' ? encodeURIComponent(req._parsedUrl.path.replace(/^\//, '')) : '_' )+
		(req.params ? hashParams(req.params) : '')
	;
}

function proxyMiddleware(req, res, next, options = {}) {
	req.pause();
	var requestOptions = {
			hostname: req._parsedUrl.hostname || req._parsedUrl.host || req.headers.host,
			path: req._parsedUrl.path,
			method: req.method,
			headers: {'X-Forwarded-For': req.connection.remoteAddress}
		},
		removedHeaders = proxyRemovedHeaders.slice(),
		removeHeadersExp,
		port,
		proxyReq,
		cacheStream
	;
	options.isBacked && removedHeaders.push(...proxyBackupRemovedHeaders);
	removeHeadersExp = new RegExp(`^${removedHeaders.join('|')}$`);
	Object.keys(req.headers).forEach((header) => {
		header.match(removeHeadersExp) || (requestOptions.headers[header] = req.headers[header]);
	});

	if (req._parsedUrl.port) {
		port = req._parsedUrl.port;
	} else if (req.headers.origin) {
		req.headers.origin.replace(portExp, (m, p) => port = p);
	}

	port && (requestOptions.port = port);

	verbose && console.log('proxying to %s(http://%s:%s%s)', requestOptions.method, requestOptions.hostname, requestOptions.port || 80, requestOptions.path);

	proxyReq = http.request(requestOptions, (proxyRes) => {
		proxyRes.pause();
		Object.keys(proxyRes.headers).forEach((hname) => res.removeHeader(hname));
		res.setHeader('via', 'stuback');
		res.writeHead(proxyRes.statusCode, proxyRes.headers);
		if (options.isBacked) {
			let stubFileName = getStubFileName(req);
			let stubDirname = path.dirname(stubFileName);
			fs.existsSync(stubDirname) || mkdirp.sync(stubDirname);
			cacheStream = fs.createWriteStream(stubFileName);
			cacheStream.on('close', () => {
				verbose && console.log('backed in %s', stubFileName);
			});
			proxyRes.pipe(cacheStream);
		}
		proxyRes.pipe(res);
		proxyRes.resume();
	});

	proxyReq.on('error', (err) => {
		if (options.isBacked) {
			let _options = {
				isStubbed: true,
				isBacked: false,
				isTampered: false,
				passthrough: false
			};
			stubMiddleware(req, res, next, _options);
		} else {
			next(err);
		}
		console.log('errr', err);
	});

	res.on('finished', () => {
		// cacheStream.end();
		console.log("send response %s", res);
	});

	req.pipe(proxyReq);
	req.resume();
}

function stubMiddleware(req, res, next, options = {}) {
	let stubFileName = getStubFileName(req);

	verbose && console.log('pattern searching for %s(%s)', req.method, req.path);

	fs.exists(stubFileName, function (exists) {
		if (!exists) {
			verbose && console.log("patterns didn't found response for %s(%s) -> (%s)", req.method, req.url, path.basename(stubFileName));
			if (options.passthrough) {
				return proxyMiddleware(req, res, next, options);
			}
			return next();
		}
		console.log('Reply with get/%s', path.basename(stubFileName));
		let stub = fs.createReadStream(stubFileName);
		stub.pipe(res);
	});
}

var app = connect();
// var tlsOptions = {
// 	key:    fs.readFileSync(__dirname + '/../key.pem'),
// 	cert:   fs.readFileSync(__dirname + '/../cert.pem')
// };

// proxy auto config generation
app.use('/proxy.pac', function(req, res, next){
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

// do the real job
app.use((req, res, next) => {
	verbose && console.log('request received', req.originalUrl);
	if (!config[req._parsedUrl.hostname]) {
		verbose && console.log("proxying call to %s", req._parsedUrl.hostname);
		return proxyMiddleware(req, res, next);
	}

	let hostConfig = config[req._parsedUrl.hostname],
		url = req._parsedUrl.path,
		middleWareOptions = {
			isStubbed: hostConfig.stubs.some(function (exp) { return !!url.match(exp); }),
			isBacked: hostConfig.backed.some(function (exp) { return !!url.match(exp); }),
			isTampered: hostConfig.tampered.some(function (exp) { return !!url.match(exp); }),
			passthrough: !!hostConfig.passthrough
		}
	;

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

var httpServer = http.createServer(app).listen(cliOpts.port);
// https.createServer(tlsOptions, app).listen(3001);
console.log(`Stuback listening on port ${cliOpts.port}
You can use Automatic proxy configuration at http://localhost:${cliOpts.port}/proxy.pac
`);
