'use strict';

Object.defineProperty(exports, '__esModule', {
	value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _pathToRegexp = require('path-to-regexp');

var _pathToRegexp2 = _interopRequireDefault(_pathToRegexp);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var IGNORED_PATH = ['responseHeaders'];

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
	return stubsPath + (req._parsedUrl.hostname || req._parsedUrl.host || 'localhost') + '/' + req.method.toLowerCase() + '-' + (req._parsedUrl.path !== '/' ? encodeURIComponent(req._parsedUrl.path.replace(/^\//, '')) : '_') + (req.params ? hashParams(req.params) : '');
}

function normalizeHostConfig(hostConfig) {
	normalizeHostConfigSection(hostConfig, 'stubs');
	normalizeHostConfigSection(hostConfig, 'backed');
	normalizeHostConfigSection(hostConfig, 'tampered');
}

function normalizeHostConfigSection(hostConfig, section) {
	section in hostConfig && Object.keys(hostConfig[section]).filter(function (path) {
		return ! ~IGNORED_PATH.indexOf(path);
	}) // jshint ignore:line
	.forEach(function (path) {
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
	headers && Object.keys(headers).filter(function (path) {
		return ! ~IGNORED_PATH.indexOf(path);
	}) // jshint ignore:line
	.forEach(function (header) {
		if (headers[header]) {
			res.setHeader(header, headers[header]);
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
	var path = undefined;
	return typeConfig && Object.keys(typeConfig).some(function (_path) {
		path = _path;
		return typeConfig[path].use && url.match(typeConfig[path].exp);
	}) ? path : false;
}

exports['default'] = { hashParams: hashParams, getStubFileName: getStubFileName, normalizeHostConfig: normalizeHostConfig, applyResponseHeaders: applyResponseHeaders, applyIncomingMessageHeaders: applyIncomingMessageHeaders, pathMatchingLookup: pathMatchingLookup };
module.exports = exports['default'];