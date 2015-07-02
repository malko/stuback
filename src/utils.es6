import pathToRegexp from 'path-to-regexp';
import crypto from 'crypto';
import path from 'path';

const IGNORED_PATH = ['responseHeaders', 'onStatusCode'];

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
	return '-' + crypto.createHash('md5').update(JSON.stringify(v)).digest('hex');
}

/**
 * return the path of stub file based on a corresponding request object
 * @param {httpRequest} req the server incoming request to get stub filename for
 * @return {string} the stub path corresponding to this httpRequest
 */
function getStubFileName(stubsPath, req) {
	let parsedUrl = req._parsedUrl;
	let hostname = parsedUrl.hostname || parsedUrl.host || 'localhost';
	let port = parsedUrl.port || 80;
	let pathname = path.dirname(parsedUrl.pathname);
	let filename = parsedUrl.path.substring(pathname.length).replace(/^\//, '');
	return path.normalize(stubsPath + '/' + hostname + ':' + port + '/' + cleanPath(pathname, true) + '/') +
		req.method.toLowerCase() + '-' + cleanPath(filename, true) +
		(req.params ? hashParams(req.params) : '')
	;
}

function normalizeHostConfig(hostConfig) {
	normalizeHostConfigSection(hostConfig, 'stubs');
	normalizeHostConfigSection(hostConfig, 'backed');
	normalizeHostConfigSection(hostConfig, 'tampered');
}

function normalizeHostConfigSection(hostConfig, section) {
	(section in hostConfig) && Object.keys(hostConfig[section])
		.filter((path) => !~IGNORED_PATH.indexOf(path))
		.forEach((path) => {
			if (typeof hostConfig[section][path] !== 'object') {
				hostConfig[section][path] = {use: !!hostConfig[section][path]};
			}
			if (hostConfig[section][path].use === false) {
				return;
			}
			hostConfig[section][path].use = true;
			hostConfig[section][path].exp = pathToRegexp(path);
		})
	;
}

function applyResponseHeaders(res, headers) {
	headers && Object.keys(headers)
		.forEach((header) => {
			if (headers[header]) {
				res.setHeader(header, headers[header]);
			} else {
				res.removeHeader(header);
			}
		})
	;
}

function applyIncomingMessageHeaders(incoming, headers) {
	headers && Object.keys(headers).forEach((headerName) => {
		delete incoming.headers[headerName.toLowerCase()];
		headers[headerName] && (incoming.headers[headerName] = headers[headerName]);
	});
}

function pathMatchingLookup(url, typeConfig) {
	let matchedPath;
	return (typeConfig && Object.keys(typeConfig)
		.filter((path) => !~IGNORED_PATH.indexOf(path))
		.some((path) => {
			matchedPath = path;
			return typeConfig[matchedPath].use && url.match(typeConfig[matchedPath].exp);
		})) ? matchedPath : false
	;
}

export default {hashParams, getStubFileName, normalizeHostConfig, applyResponseHeaders, applyIncomingMessageHeaders, pathMatchingLookup};
