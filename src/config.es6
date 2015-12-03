import utils from './utils';
import fs from 'fs';

const RESERVED_KEYS = ['adminLogin', 'adminPass'];

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
		return Object.keys(this._config).filter((hostname) => !~RESERVED_KEYS.indexOf(hostname));
	}

	getHostConfig(hostname) {
		return this._config[hostname];
	}

	getLocalAddress() {
		let address = this.getHttpServer().address();
		return (address.address.match(/^(|::)$/) ? '127.0.0.1' : address.address) + ':' + address.port;
	}

	getAdminCredentials() {
		if (this._config.adminLogin && this._config.adminPass) {
			return {login: this._config.adminLogin, pass: this._config.adminPass};
		}
		return null;
	}

	getStubMaxSize() {
		return 'stubMaxSize' in this._config ? +this._config.stubMaxSize : '5mb';
	}
}

export default Config;
