import _stpl from 'stpl';
import path from 'path';
import fs from 'fs';

var stpl = _stpl.stpl;

//preload all stpl templates
var templateDir = path.normalize(__dirname + '/../public');
fs.readdirSync(templateDir).forEach((tplFile) => {
	let matches = tplFile.match(/^([^\.]+)\.stpl$/);
	matches && stpl.registerString(matches[1], fs.readFileSync(path.normalize(templateDir + '/' + tplFile)).toString());
});

function use(app, CLIOPTS, config) {

	function authenticate(req, res) {
		let configCredentials = config.getAdminCredentials();
		if (!configCredentials) {
			return true;
		}
		res.setHeader('WWW-Authenticate', 'Basic realm="Stuback"');
		let authorization = req.headers.authorization;
		if (authorization) {
			let token = authorization.split(/\s+/).pop() || '';
			let auth = token && new Buffer(token, 'base64').toString().split(/:/);
			if (auth && auth[0] === configCredentials.login && auth[1] === configCredentials.pass) {
				return true;
			}
		}
		res.statusCode = 401;
		res.end('');
		return false;
	}

	function redirect(res, url) {
		res.writeHead(302, {Location: url});
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
		return path.normalize(CLIOPTS.stubsPath + '/' + decodeURIComponent(req._parsedUrl.query
			.replace(/^(.+&)?path=([^&#]+)(&.*)?$/, '$2')
			.replace(/\.+/, '.')
			.replace(/\0/, '')
		));
	}

	function parseStubPath(stubPath) {
		let file = stubPath.slice(CLIOPTS.stubsPath.length);
		let host, port, basename, method;
		let fullPath = file.replace(/^([^\/]+)-(\d+)[\/\\]/, (m, h, p) => {
			host = h, method;
			port = p;
			return '';
		});
		let dirname = path.dirname(fullPath);
		let fileName = path.basename(stubPath);
		fileName.replace(/^([^-]+)-(.*)/, (m, _method, _basename) => {
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
			url: path.normalize(decodeURIComponent(dirname) + '/' + decodeURIComponent(basename)),
			method: method
		};
	}

	//-- proxy auto config generation
	app.use('/stuback/proxy.pac', function (req, res /*, next*/) {
		console.log('serving PAC for %s', req.connection.remoteAddress);
		let localAddress = config.getLocalAddress();
		let pacConfig = config.getHosts().map((hostKey) => {
			let direct = config.getHostConfig(hostKey).passthrough ? '; DIRECT' : '';
			return `if (shExpMatch(host, '${hostKey}')) return 'PROXY ${localAddress}${direct}';`;
		}).join('\n\t');
		res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
		res.end(`function FindProxyForURL(url, host) {\n\t${pacConfig}\n\treturn "DIRECT";\n}`);
	});

	app.use('/stuback/admin-stubs/view', (req, res) => {
		if (!authenticate(req, res)) {
			return false;
		}
		var stubPath = decodeStubParam(req);
		res.setHeader('Content-Type', 'text/plain');
		let tplData = parseStubPath(stubPath);
		fs.readFile(stubPath, function (err, raw) {
			if (err) {
				res.statusCode = 404;
				return res.end(err.toString());
			}
			tplData.content = raw;
			replyTemplate(res, 'admin-stubs-form', tplData);
		});
	});

	app.use('/stuback/admin-stubs/delete', (req, res) => {
		if (!authenticate(req, res)) {
			return false;
		}
		var stub = decodeStubParam(req);
		fs.unlink(stub, (err) => {
			if (err) {
				res.statusCode = 500;
				return res.end(err.toString());
			}
			redirect(res, '/stuback/admin-stubs');
		});
	});

	//-- list all stub files
	app.use('/stuback/admin-stubs', (req, res) => {
		if (!authenticate(req, res)) {
			return false;
		}
		// prepare stubs list
		let tplData = {hosts:[]};
		fs.readdir(CLIOPTS.stubsPath, (err, hosts) => {
			if (err) {
				res.statusCode = 404;
				return res.end('404 - NOT FOUND');
			}
			hosts.forEach((hostname) => {
				let host = {name: hostname, stubPaths: []};
				tplData.hosts.push(host);
				let hostPath = path.normalize(CLIOPTS.stubsPath + '/' + hostname);
				fs.readdirSync(hostPath).forEach((stubPath) => {
					stubPath = {
						path: stubPath,
						stubs: []
					};
					host.stubPaths.push(stubPath);
					fs.readdirSync(hostPath + '/' + stubPath.path).forEach((stub) => {
						let m = stub.match(/^([^-]+)-(.*)$/);
						stubPath.stubs.push({
							file: path.normalize(hostname + '/' + stubPath.path + '/' + stub),
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
		replyTemplate(res, 'index', {localAddress: config.getLocalAddress()});
	});

	app.use('/stuback/assets', (req, res) => {
		let file = req._parsedUrl.path.replace(/^\/stuback\/assets/, '').replace(/[\0\.]+/g, '.');
		try {
			let stream = fs.createReadStream(path.normalize(__dirname + '/../public/assets' + file));
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

export default {use};
