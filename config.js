module.exports = {
	verbose: true,
	'myhost.com': {
		passthrough: true, // if yes will proxy request that are not stubed, backed or tampered
		stubs: [], // list of path to use stubs for
		backed: [], // list of path to automaticly backup and send as stub if the remote server doesn't respond
		tampered: [] // not functionnal for now will handle path where you want to modify request and response on the fly
	}
};
