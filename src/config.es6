import utils from './utils';
import fs from 'fs';

var _lastWatched = 0;
class Config{
	constructor(configPath, CLIOPTS, getHttpServerMethod) {
		this._config = {};
		this.configPath = configPath;
		this.verbose = CLIOPTS.verbose;

		this.getHttpServer = getHttpServerMethod;
		this.load();
		fs.watch(configPath, () => this.load());
	}

	load() {
		// dedupe fs.watch events within 100ms
		let now = Date.now();
		if (_lastWatched + 100 >= now) {
			return;
		}
		_lastWatched = Date.now();

		this.verbose && console.log('loading config at %s', this.configPath);
		delete require.cache[this.configPath];
		try {
			let config = require(this.configPath);
			this._config = config;
			this.getHosts().forEach((host) => utils.normalizeHostConfig(this.getHostConfig(host)));
		} catch (e) {
			console.error('Error loading configuration file, waiting for file change\n', e);
		}
	}

	getHosts() {
		return Object.keys(this._config);
	}

	getHostConfig(hostname) {
		return this._config[hostname];
	}

	getLocalAddress() {
		let address = this.getHttpServer().address();
		return (address.address.match(/^(|::)$/) ? '127.0.0.1' : address.address) + ':' + address.port;
	}
}

export default Config;
