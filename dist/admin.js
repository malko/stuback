'use strict';

Object.defineProperty(exports, '__esModule', {
	value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _stpl2 = require('stpl');

var _stpl3 = _interopRequireDefault(_stpl2);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var stpl = _stpl3['default'].stpl;

//preload all stpl templates
var templateDir = _path2['default'].normalize(__dirname + '/../public');
_fs2['default'].readdirSync(templateDir).forEach(function (tplFile) {
	var matches = tplFile.match(/^([^\.]+)\.stpl$/);
	matches && stpl.registerString(matches[1], _fs2['default'].readFileSync(_path2['default'].normalize(templateDir + '/' + tplFile)).toString());
});

function use(app, CLIOPTS, config) {

	function decodeStubParam(req) {
		return _path2['default'].normalize(CLIOPTS.stubsPath + '/' + decodeURIComponent(req._parsedUrl.query.replace(/^(.+&)?path=([^&#]+)(&.*)?$/, '$2').replace(/\.+/, '.').replace(/\0/, '')));
	}

	function parseStubPath(stubPath) {
		var dirname = _path2['default'].dirname(stubPath.substring(CLIOPTS.stubsPath.length));
		var file = _path2['default'].basename(stubPath);
		var host = undefined,
		    basename = undefined,
		    method = undefined;
		dirname.replace(/^([^:%]+(:\d+))?/, function (m, _host) {
			return host = _host;
		});
		file.replace(/^([^-]+)-(.*?)/, function (m, _method, _basename) {
			method = _method;
			basename = _basename;
		});
		return {
			fullpath: stubPath,
			dirname: dirname,
			basename: file.replace(/^[^-]+-/, ''),
			host: host,
			urlpath: dirname.substr(host.length + 1),
			file: file,
			method: method
		};
	}

	//-- proxy auto config generation
	app.use('/stuback/proxy.pac', function (req, res /*, next*/) {
		console.log('serving PAC for %s', req.connection.remoteAddress);
		var localAddress = config.getLocalAddress();
		var pacConfig = config.getHosts().map(function (hostKey) {
			var direct = config.getHostConfig(hostKey).passthrough ? '; DIRECT' : '';
			return 'if (shExpMatch(host, \'' + hostKey + '\')) return \'PROXY ' + localAddress + direct + '\';';
		}).join('\n\t');
		res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
		res.end('function FindProxyForURL(url, host) {\n\t' + pacConfig + '\n\treturn "DIRECT";\n}');
	});

	app.use('/stuback/admin-stubs/view', function (req, res) {
		var stubPath = decodeStubParam(req);
		res.setHeader('Content-Type', 'text/plain');
		var tplData = parseStubPath(stubPath);
		_fs2['default'].readFile(stubPath, function (err, raw) {
			if (err) {
				res.statusCode = 404;
				res.end(err);
			}
			tplData.content = raw;
			res.setHeader('Content-Type', 'text/html');
			res.end(stpl('admin-stubs-form', tplData));
		});
	});

	app.use('/stuback/admin-stubs/delete', function (req, res) {
		var stub = decodeStubParam(req);
		_fs2['default'].unlink(stub, function (err) {
			if (err) {
				res.statusCode = 500;
				res.end(err);
			}
			res.writeHead(302, { Location: req.headers.referer });
			res.end('');
		});
	});

	//-- list all stub files
	app.use('/stuback/admin-stubs', function (req, res) {
		// prepare stubs list
		var tplData = { hosts: [] };
		_fs2['default'].readdir(CLIOPTS.stubsPath, function (err, hosts) {
			if (err) {
				res.statusCode = 404;
				res.end('404 - NOT FOUND');
			}
			hosts.forEach(function (hostname) {
				var host = { name: hostname, stubPaths: [] };
				tplData.hosts.push(host);
				var hostPath = _path2['default'].normalize(CLIOPTS.stubsPath + '/' + hostname);
				_fs2['default'].readdirSync(hostPath).forEach(function (stubPath) {
					stubPath = {
						path: stubPath,
						stubs: []
					};
					host.stubPaths.push(stubPath);
					_fs2['default'].readdirSync(hostPath + '/' + stubPath.path).forEach(function (stub) {
						var m = stub.match(/^([^-]+)-(.*)$/);
						stubPath.stubs.push({
							file: hostname + '/' + stubPath.path + '/' + stub,
							method: m[1],
							name: m[2]
						});
					});
				});
			});
			res.setHeader('Content-Type', 'text/html');
			res.setHeader('Pragma', 'no-cache');
			res.end(stpl('admin-stubs', tplData));
		});
	});

	app.use('/stuback/admin', function (req, res) {
		res.setHeader('Content-Type', 'text/html');
		res.end(stpl('index', { localAddress: config.getLocalAddress() }));
	});
	app.use('/stuback', function (req, res) {
		res.writeHead(302, { Location: '/stuback/admin' });
		res.end('');
	});
}

exports['default'] = { use: use };
module.exports = exports['default'];