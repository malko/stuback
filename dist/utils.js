'use strict';

Object.defineProperty(exports, '__esModule', {
	value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _pathToRegexp = require('path-to-regexp');

var _pathToRegexp2 = _interopRequireDefault(_pathToRegexp);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var IGNORED_PATH = ['responseHeaders', 'onStatusCode'];

function cleanPath(path, encode) {
	if (!path) {
		return '';
	}
	path = path.replace(/\.\.+/g, '.').replace(/[\0;&<>\|\\]/g, '_');
	return encode ? encodeURIComponent(path) : path;
}

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
function getStubFileName(stubsPath, req) {
	var parsedUrl = req._parsedUrl;
	var hostname = parsedUrl.hostname || parsedUrl.host || 'localhost';
	var port = parsedUrl.port || 80;
	var pathname = _path2['default'].dirname(parsedUrl.pathname);
	var filename = parsedUrl.path.substring(pathname.length).replace(/^\//, '');
	return _path2['default'].normalize(stubsPath + '/' + hostname + '-' + port + '/' + cleanPath(pathname, true) + '/') + req.method.toLowerCase() + '-' + cleanPath(filename, true) + (req.params ? hashParams(req.params) : '');
}

function normalizeHostConfig(hostConfig) {
	normalizeHostConfigSection(hostConfig, 'stubs');
	normalizeHostConfigSection(hostConfig, 'backed');
	normalizeHostConfigSection(hostConfig, 'tampered');
}

function normalizeHostConfigSection(hostConfig, section) {
	section in hostConfig && Object.keys(hostConfig[section]).filter(function (path) {
		return ! ~IGNORED_PATH.indexOf(path);
	}).forEach(function (path) {
		if (typeof hostConfig[section][path] !== 'object') {
			hostConfig[section][path] = { use: !!hostConfig[section][path] };
		}
		if (hostConfig[section][path].use === false) {
			return;
		}
		hostConfig[section][path].use = true;
		hostConfig[section][path].exp = (0, _pathToRegexp2['default'])(path);
	});
}

function applyResponseHeaders(res, headers) {
	!res.headersSent && headers && Object.keys(headers).forEach(function (header) {
		if (headers[header]) {
			var headerLC = header.toLowerCase();
			if (headerLC === 'set-cookie') {
				res.setHeader(header, headers[header].replace(/;\s*domain=[^;]+/i, '')); // we need to remove domain
			} else {
				res.setHeader(header, headers[header]);
			}
		} else {
			res.removeHeader(header);
		}
	});
}

function applyIncomingMessageHeaders(incoming, headers) {
	headers && Object.keys(headers).forEach(function (headerName) {
		delete incoming.headers[headerName.toLowerCase()];
		headers[headerName] && (incoming.headers[headerName] = headers[headerName]);
	});
}

function pathMatchingLookup(url, typeConfig) {
	var matchedPath = undefined;
	return typeConfig && Object.keys(typeConfig).filter(function (path) {
		return ! ~IGNORED_PATH.indexOf(path);
	}).some(function (path) {
		matchedPath = path;
		return typeConfig[matchedPath].use && url.match(typeConfig[matchedPath].exp);
	}) ? matchedPath : false;
}

exports['default'] = { hashParams: hashParams, getStubFileName: getStubFileName, normalizeHostConfig: normalizeHostConfig, applyResponseHeaders: applyResponseHeaders, applyIncomingMessageHeaders: applyIncomingMessageHeaders, pathMatchingLookup: pathMatchingLookup };
module.exports = exports['default'];