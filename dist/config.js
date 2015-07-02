'use strict';

Object.defineProperty(exports, '__esModule', {
	value: true
});

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _lastWatched = 0;

var Config = (function () {
	function Config(configPath, CLIOPTS, getHttpServerMethod) {
		var _this = this;

		_classCallCheck(this, Config);

		this._config = {};
		this.configPath = configPath;
		this.verbose = CLIOPTS.verbose;

		this.getHttpServer = getHttpServerMethod;
		this.load();
		_fs2['default'].watch(configPath, function () {
			return _this.load();
		});
	}

	_createClass(Config, [{
		key: 'load',
		value: function load() {
			var _this2 = this;

			// dedupe fs.watch events within 100ms
			var now = Date.now();
			if (_lastWatched + 100 >= now) {
				return;
			}
			_lastWatched = Date.now();

			this.verbose && console.log('loading config at %s', this.configPath);
			delete require.cache[this.configPath];
			try {
				var config = require(this.configPath);
				this._config = config;
				this.getHosts().forEach(function (host) {
					return _utils2['default'].normalizeHostConfig(_this2.getHostConfig(host));
				});
			} catch (e) {
				console.error('Error loading configuration file, waiting for file change\n', e);
			}
		}
	}, {
		key: 'getHosts',
		value: function getHosts() {
			return Object.keys(this._config);
		}
	}, {
		key: 'getHostConfig',
		value: function getHostConfig(hostname) {
			return this._config[hostname];
		}
	}, {
		key: 'getLocalAddress',
		value: function getLocalAddress() {
			var address = this.getHttpServer().address();
			return (address.address.match(/^(|::)$/) ? '127.0.0.1' : address.address) + ':' + address.port;
		}
	}]);

	return Config;
})();

exports['default'] = Config;
module.exports = exports['default'];