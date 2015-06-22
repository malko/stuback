module.exports = {
	'myhost.com': {
		passthrough: true, // if yes will proxy request that are not stubed, backed or tampered
		stubs: [], // list of path to use stubs for
		backed: [], // list of path to automaticly backup and send as stub if the remote server doesn't respond
		tampered: [] // not functionnal for now will handle path where you want to modify request and response on the fly
	},
	localhost: {
		targetHost: 'mydevhost.com', // optional value to redirect request to another host than the one passed in
		targetPort: '8080', // optional value to redirect request to another port than the one requested
		passthrough: true,
		stubs: [],
		backed: ['/api/*'],
		tampered: []
	}
};
