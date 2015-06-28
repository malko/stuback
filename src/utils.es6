import pathToRegexp from 'path-to-regexp';
import crypto from 'crypto';

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
function getStubFileName(stubsPath, req) {
	return stubsPath + (req._parsedUrl.hostname || req._parsedUrl.host || 'localhost') + '/' + req.method.toLowerCase() + '-' +
		(req._parsedUrl.path !== '/' ? encodeURIComponent(req._parsedUrl.path.replace(/^\//, '')) : '_') +
		(req.params ? hashParams(req.params) : '')
	;
}

function normalizeHostConfig(hostConfig) {
	normalizeHostConfigSection(hostConfig, 'stubs');
	normalizeHostConfigSection(hostConfig, 'backed');
	normalizeHostConfigSection(hostConfig, 'tampered');
}

function normalizeHostConfigSection(hostConfig, section) {
	(section in hostConfig) && Object.keys(hostConfig[section]).forEach((path) => {
		if (typeof hostConfig[section][path] !== 'object') {
			hostConfig[section][path] = {use: !!hostConfig[section][path]};
		}
		if (hostConfig[section][path].use === false) {
			return;
		}
		hostConfig[section][path].use = true;
		hostConfig[section][path].exp = pathToRegexp(path);
	});
}

function applyResponseHeaders(res, headers) {
	headers && Object.keys(headers).forEach((header) => {
		if (headers[header]) {
			res.setHeader(header, headers[header]);
		} else {
			res.removeHeader(header);
		}
	});
}

function applyIncomingMessageHeaders(incoming, headers) {
	headers && Object.keys(headers).forEach((headerName) => {
		delete incoming.headers[headerName.toLowerCase()];
		headers[headerName] && (incoming.headers[headerName] = headers[headerName]);
	});
}

function pathMatchingLookup(url, typeConfig) {
	let path;
	return (typeConfig && Object.keys(typeConfig).some((_path) => {
		path = _path;
		return typeConfig[path].use && url.match(typeConfig[path].exp);
	})) ? path : false;
}

export default {hashParams, getStubFileName, normalizeHostConfig, applyResponseHeaders, applyIncomingMessageHeaders, pathMatchingLookup};
