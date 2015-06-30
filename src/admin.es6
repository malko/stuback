import _stpl from 'stpl';
import path from 'path';
import fs from 'fs';

var stpl = _stpl.stpl;
// register stpl filters
stpl.registerFilter('decode', decodeURIComponent);

//preload all stpl templates
var templateDir = path.normalize(__dirname + '/../public');
fs.readdirSync(templateDir).forEach((tplFile) => {
	let matches = tplFile.match(/^([^\.]+)\.stpl$/);
	matches && stpl.registerString(matches[1], fs.readFileSync(path.normalize(templateDir + '/' + tplFile)).toString());
});

function decodeStubParam(req, CLIOPTS) {
	return path.normalize(CLIOPTS.stubsPath + '/' + decodeURIComponent(req._parsedUrl.query
		.replace(/^(.+&)?path=([^&#]+)(&.*)?$/, '$2')
		.replace(/\.+/, '.')
		.replace(/\0/, '')))
	;
}

function use(app, CLIOPTS, config) {

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
		var stub = decodeStubParam(req, CLIOPTS);
		res.setHeader('Content-Type', 'text/plain');
		var readStream = fs.createReadStream(stub);
		readStream.pipe(res);
		readStream.on('error', (err) => {
			res.end(err);
		});
	});

	app.use('/stuback/admin-stubs/delete', (req, res) => {
		var stub = decodeStubParam(req, CLIOPTS);
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
				let host = {name: hostname, stubs: []};
				tplData.hosts.push(host);
				let hostPath = path.normalize(CLIOPTS.stubsPath + '/' + hostname);
				fs.readdirSync(hostPath).forEach((stub) => {
					let m = stub.match(/^([^-]+)-(.*)$/);
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
		res.end(stpl('index', {localAddress: config.getLocalAddress()}));
	});
}

export default {use};
