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
// register stpl filters
stpl.registerFilter('decode', decodeURIComponent);

//preload all stpl templates
var templateDir = _path2['default'].normalize(__dirname + '/../public');
_fs2['default'].readdirSync(templateDir).forEach(function (tplFile) {
	var matches = tplFile.match(/^([^\.]+)\.stpl$/);
	matches && stpl.registerString(matches[1], _fs2['default'].readFileSync(_path2['default'].normalize(templateDir + '/' + tplFile)).toString());
});

function decodeStubParam(req, CLIOPTS) {
	return _path2['default'].normalize(CLIOPTS.stubsPath + '/' + decodeURIComponent(req._parsedUrl.query.replace(/^(.+&)?path=([^&#]+)(&.*)?$/, '$2').replace(/\.+/, '.').replace(/\0/, '')));
}

function use(app, CLIOPTS, config) {

	//-- proxy auto config generation
	app.use('/stuback/proxy.pac', function (req, res /*, next*/) {
		console.log('serving PAC for %s', req.connection.remoteAddress);
		var localAddress = config.getLocalAddress();
		var pacConfig = config.getHosts().map(function (hostKey) {
			var direct = config.getHostConfig(hostKey).passthrough ? '; DIRECT' : '';
			return 'if (shExpMatch(host, \'' + hostKey + '\')) return \'PROXY ' + localAddress + '' + direct + '\';';
		}).join('\n\t');
		res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
		res.end('function FindProxyForURL(url, host) {\n\t' + pacConfig + '\n\treturn "DIRECT";\n}');
	});

	app.use('/stuback/admin-stubs/view', function (req, res) {
		var stub = decodeStubParam(req, CLIOPTS);
		res.setHeader('Content-Type', 'text/plain');
		var readStream = _fs2['default'].createReadStream(stub);
		readStream.pipe(res);
		readStream.on('error', function (err) {
			res.end(err);
		});
	});

	app.use('/stuback/admin-stubs/delete', function (req, res) {
		var stub = decodeStubParam(req, CLIOPTS);
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
				var host = { name: hostname, stubs: [] };
				tplData.hosts.push(host);
				var hostPath = _path2['default'].normalize(CLIOPTS.stubsPath + '/' + hostname);
				_fs2['default'].readdirSync(hostPath).forEach(function (stub) {
					var m = stub.match(/^([^-]+)-(.*)$/);
					host.stubs.push({
						file: hostname + '/' + stub,
						method: m[1],
						name: m[2]
					});
				});
			});
			res.setHeader('Content-Type', 'text/html');
			res.setHeader('Pragma', 'no-cache');
			res.end(stpl('admin-stubs', tplData));
		});
	});

	app.use('/stuback', function (req, res) {
		res.setHeader('Content-Type', 'text/html');
		res.end(stpl('index', { localAddress: config.getLocalAddress() }));
	});
}

exports['default'] = { use: use };
module.exports = exports['default'];