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

	function authenticate(req, res) {
		var configCredentials = config.getAdminCredentials();
		if (!configCredentials) {
			return true;
		}
		res.setHeader('WWW-Authenticate', 'Basic realm="Stuback"');
		var authorization = req.headers.authorization;
		if (authorization) {
			var token = authorization.split(/\s+/).pop() || '';
			var auth = token && new Buffer(token, 'base64').toString().split(/:/);
			if (auth && auth[0] === configCredentials.login && auth[1] === configCredentials.pass) {
				return true;
			}
		}
		res.statusCode = 401;
		res.end('');
		return false;
	}

	function redirect(res, url) {
		res.writeHead(302, { Location: url });
		res.end('');
	}

	function replyTemplate(res, tplName, tplData) {
		res.setHeader('Content-Type', 'text/html');
		res.setHeader('Pragma', 'no-cache');
		try {
			res.end(stpl(tplName, tplData));
		} catch (e) {
			res.end('Template generation error\n' + e.toString());
		}
	}
	function decodeStubParam(req) {
		return _path2['default'].normalize(CLIOPTS.stubsPath + '/' + decodeURIComponent(req._parsedUrl.query.replace(/^(.+&)?path=([^&#]+)(&.*)?$/, '$2').replace(/\.+/, '.').replace(/\0/, '')));
	}

	function parseStubPath(stubPath) {
		var file = stubPath.slice(CLIOPTS.stubsPath.length);
		var host = undefined,
		    port = undefined,
		    basename = undefined,
		    method = undefined;
		var fullPath = file.replace(/^([^\/]+)-(\d+)[\/\\]/, function (m, h, p) {
			host = h, method;
			port = p;
			return '';
		});
		var dirname = _path2['default'].dirname(fullPath);
		var fileName = _path2['default'].basename(stubPath);
		fileName.replace(/^([^-]+)-(.*)/, function (m, _method, _basename) {
			method = _method;
			basename = _basename;
		});
		return {
			fileFullPath: file,
			file: fullPath,
			fileName: fileName,
			host: host,
			port: port,
			dirname: dirname,
			urlBasename: decodeURIComponent(basename),
			urlpath: decodeURIComponent(dirname),
			url: _path2['default'].normalize(decodeURIComponent(dirname) + '/' + decodeURIComponent(basename)),
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
		if (!authenticate(req, res)) {
			return false;
		}
		var stubPath = decodeStubParam(req);
		res.setHeader('Content-Type', 'text/plain');
		var tplData = parseStubPath(stubPath);
		_fs2['default'].readFile(stubPath, function (err, raw) {
			if (err) {
				res.statusCode = 404;
				return res.end(err.toString());
			}
			tplData.content = raw;
			replyTemplate(res, 'admin-stubs-form', tplData);
		});
	});

	app.use('/stuback/admin-stubs/delete', function (req, res) {
		if (!authenticate(req, res)) {
			return false;
		}
		var stub = decodeStubParam(req);
		_fs2['default'].unlink(stub, function (err) {
			if (err) {
				res.statusCode = 500;
				return res.end(err.toString());
			}
			redirect(res, '/stuback/admin-stubs');
		});
	});

	//-- list all stub files
	app.use('/stuback/admin-stubs', function (req, res) {
		if (!authenticate(req, res)) {
			return false;
		}
		// prepare stubs list
		var tplData = { hosts: [] };
		_fs2['default'].readdir(CLIOPTS.stubsPath, function (err, hosts) {
			if (err) {
				res.statusCode = 404;
				return res.end('404 - NOT FOUND');
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
							file: _path2['default'].normalize(hostname + '/' + stubPath.path + '/' + stub),
							method: m[1],
							name: m[2]
						});
					});
				});
			});
			replyTemplate(res, 'admin-stubs', tplData);
		});
	});

	app.use('/stuback/admin', function (req, res) {
		if (!authenticate(req, res)) {
			return false;
		}
		replyTemplate(res, 'index', { localAddress: config.getLocalAddress() });
	});

	app.use('/stuback/assets', function (req, res) {
		var file = req._parsedUrl.path.replace(/^\/stuback\/assets/, '').replace(/[\0\.]+/g, '.');
		try {
			var stream = _fs2['default'].createReadStream(_path2['default'].normalize(__dirname + '/../public/assets' + file));
			stream.pipe(res);
		} catch (e) {
			res.end(e.toString());
		}
	});

	app.use('/stuback', function (req, res) {
		if (!authenticate(req, res)) {
			return false;
		}
		redirect(res, '/stuback/admin');
	});
}

exports['default'] = { use: use };
module.exports = exports['default'];