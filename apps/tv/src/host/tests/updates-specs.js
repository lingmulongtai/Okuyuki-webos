import {checkUpdates, selectUpdate} from '../updates';

const release = (tag, extra = {}) => ({['tag_name']: tag, draft: false, assets: [{name: 'okuyuki.ipk', state: 'uploaded'}], ...extra});

test('finds the newest available IPK, including prereleases', () => {
	expect(selectUpdate([release('v0.1.10-alpha.1'), release('v0.1.9'), release('v0.2.0', {draft: true})], '0.1.8'))
		.toEqual({version: '0.1.10-alpha.1'});
	expect(selectUpdate([release('v0.1.0', {assets: []})], '0.1.0')).toBeNull();
});

test('reports network errors instead of saying the app is up to date', async () => {
	global.fetch = jest.fn(() => Promise.resolve({ok: false}));
	await expect(checkUpdates('0.1.0')).rejects.toThrow();
	delete global.fetch;
});
