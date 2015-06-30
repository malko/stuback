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

	function decodeStubParam(req) {
		return path.normalize(CLIOPTS.stubsPath + '/' + decodeURIComponent(req._parsedUrl.query
			.replace(/^(.+&)?path=([^&#]+)(&.*)?$/, '$2')
			.replace(/\.+/, '.')
			.replace(/\0/, '')
		));
	}

	function parseStubPath(stubPath) {
		let dirname = path.dirname(stubPath.substring(CLIOPTS.stubsPath.length));
		let file = path.basename(stubPath);
		let host, basename, method;
		dirname.replace(/^([^:%]+(:\d+))?/, (m, _host) => host = _host);
		file.replace(/^([^-]+)-(.*?)/, (m, _method, _basename) => {
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
		let localAddress = config.getLocalAddress();
		let pacConfig = config.getHosts().map((hostKey) => {
			let direct = config.getHostConfig(hostKey).passthrough ? '; DIRECT' : '';
			return `if (shExpMatch(host, '${hostKey}')) return 'PROXY ${localAddress}${direct}';`;
		}).join('\n\t');
		res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
		res.end(`function FindProxyForURL(url, host) {\n\t${pacConfig}\n\treturn "DIRECT";\n}`);
	});

	app.use('/stuback/admin-stubs/view', (req, res) => {
		var stubPath = decodeStubParam(req);
		res.setHeader('Content-Type', 'text/plain');
		let tplData = parseStubPath(stubPath);
		fs.readFile(stubPath, function (err, raw) {
			if (err) {
				res.statusCode = 404;
				res.end(err);
			}
			tplData.content = raw;
			res.setHeader('Content-Type', 'text/html');
			res.end(stpl('admin-stubs-form', tplData));
		});
	});

	app.use('/stuback/admin-stubs/delete', (req, res) => {
		var stub = decodeStubParam(req);
		fs.unlink(stub, (err) => {
			if (err) {
				res.statusCode = 500;
				res.end(err);
			}
			res.writeHead(302, {Location: req.headers.referer});
			res.end('');
		});
	});

	//-- list all stub files
	app.use('/stuback/admin-stubs', (req, res) => {
		// prepare stubs list
		let tplData = {hosts:[]};
		fs.readdir(CLIOPTS.stubsPath, (err, hosts) => {
			if (err) {
				res.statusCode = 404;
				res.end('404 - NOT FOUND');
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
		res.end(stpl('index', {localAddress: config.getLocalAddress()}));
	});
	app.use('/stuback', function (req, res) {
		res.writeHead(302, {Location: '/stuback/admin'});
		res.end('');
	});
}

export default {use};
