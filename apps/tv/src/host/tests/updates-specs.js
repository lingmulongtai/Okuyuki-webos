import {checkUpdates, isReleaseNewer, rateLimitUntil, selectUpdate} from '../updates';

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

test('does not ask for an IPK when its runtime version is already active', () => {
	expect(isReleaseNewer('0.1.4-alpha.1-preview', '0.1.4')).toBe(false);
	expect(isReleaseNewer('0.1.5-alpha.1-preview', '0.1.4')).toBe(true);
	expect(isReleaseNewer('invalid', '0.1.4')).toBe(false);
});


test('honors both rate limit headers and falls back conservatively', () => {
	const now = 1700000000000;
	const headers = (values) => ({get: (name) => values[name] || null});
	expect(rateLimitUntil({headers: headers({'retry-after': '90'})}, now)).toBe(now + 90000);
	expect(rateLimitUntil({headers: headers({'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000300'})}, now)).toBe(now + 300000);
	expect(rateLimitUntil({headers: headers({'retry-after': '90', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000300'})}, now)).toBe(now + 300000);
	expect(rateLimitUntil({headers: headers({})}, now)).toBe(now + 3600000);
});
