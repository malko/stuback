import utils from './utils';
import fs from 'fs';

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
		this.verbose && console.log('loading config at %s', this.configPath);
		delete require.cache[this.configPath];
		this._config = require(this.configPath);
		this.getHosts().forEach((host) => utils.normalizeHostConfig(this.getHostConfig(host)));
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
