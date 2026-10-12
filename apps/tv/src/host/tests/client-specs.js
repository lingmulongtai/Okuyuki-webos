import {createClient, formatHost, HostError, parseAddress} from '../client';

import {fixture} from './fixtures';

function respond (status, body = null) {
	return Promise.resolve({
		ok: status >= 200 && status < 300,
		status,
		json: () => (body === null ? Promise.reject(new Error('no body')) : Promise.resolve(body))
	});
}

describe('parseAddress', () => {
	test('reads what the phone shows', () => {
		expect(parseAddress('192.168.1.23:38765')).toEqual({host: '192.168.1.23', port: 38765});
		expect(parseAddress('  phone.local : 8080 ')).toEqual({host: 'phone.local', port: 8080});
		expect(parseAddress('[fe80::1]:38765')).toEqual({host: 'fe80::1', port: 38765});
	});

	test('refuses anything else', () => {
		['', '192.168.1.23', '192.168.1.23:0', '192.168.1.23:70000', 'http://192.168.1.23:38765', 'a b:1'].forEach((text) => {
			expect(parseAddress(text)).toBeNull();
		});
	});
});

test('IPv6 hosts are bracketed in URLs', () => {
	expect(formatHost('fe80::1')).toBe('[fe80::1]');
	expect(formatHost('192.168.1.23')).toBe('192.168.1.23');
});

describe('client', () => {
	afterEach(() => {
		delete global.fetch;
	});

	test('media URLs carry the session key once there is one', async () => {
		global.fetch = jest.fn(() => respond(200, fixture('session')));
		const client = createClient({host: '192.168.1.23', port: 38765});
		expect(() => client.thumbUrl('1')).toThrow(HostError);
		await client.openSession('token-token-token-token');
		const [url, init] = global.fetch.mock.calls[0];
		expect(url).toBe('http://192.168.1.23:38765/v2/session');
		expect(init.headers.Authorization).toBe('Bearer token-token-token-token');
		expect(client.thumbUrl('1000123')).toBe('http://192.168.1.23:38765/v2/k/Vb3nQ8cX1zL5mK9pR2tW7y/items/1000123/thumb');
		expect(client.eventsUrl()).toBe('ws://192.168.1.23:38765/v2/k/Vb3nQ8cX1zL5mK9pR2tW7y/events');
		expect(client.resolve('/v2/k/x/items/1/still')).toBe('http://192.168.1.23:38765/v2/k/x/items/1/still');
	});

	test('JSON bodies go as text/plain so the TV skips the CORS preflight', async () => {
		global.fetch = jest.fn(() => respond(200, fixture('pair-pending')));
		const client = createClient({host: '10.0.0.2', port: 38765});
		await client.pair(fixture('pair-request'));
		const [, init] = global.fetch.mock.calls[0];
		expect(init.method).toBe('POST');
		expect(init.headers['Content-Type']).toBe('text/plain');
		expect(JSON.parse(init.body).clientKind).toBe('tv');
	});

	test('errors keep the status and the phone\'s message', async () => {
		global.fetch = jest.fn(() => respond(401, fixture('error')));
		const client = createClient({host: '10.0.0.2', port: 38765});
		await expect(client.openSession('token-token-token-token')).rejects.toMatchObject({status: 401, message: fixture('error').message});
	});

	test('an unreachable phone is status 0', async () => {
		global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
		const client = createClient({host: '10.0.0.2', port: 38765});
		await expect(client.hello()).rejects.toMatchObject({status: 0});
	});
});
