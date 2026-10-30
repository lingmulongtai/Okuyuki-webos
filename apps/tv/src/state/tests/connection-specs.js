import {HostError} from '../../host/client';
import {parseHello, parsePair, parseSession} from '../../host/protocol';
import {fixture} from '../../host/tests/fixtures';
import {Connection, MESSAGES} from '../connection';

const PHONE = {host: '192.168.1.23', port: 38765};
const DEVICE = fixture('hello').deviceId;
const TOKEN = fixture('pair-approved').token;

function fakeClient (overrides = {}) {
	return {
		hello: jest.fn(() => Promise.resolve(parseHello(fixture('hello')))),
		pair: jest.fn(() => Promise.resolve(parsePair(fixture('pair-approved')))),
		openSession: jest.fn(() => Promise.resolve(parseSession(fixture('session')))),
		sendCapabilities: jest.fn(() => Promise.resolve(null)),
		library: jest.fn(() => Promise.resolve({items: [], next: null, total: 0})),
		eventsUrl: () => 'ws://192.168.1.23:38765/v2/k/key/events',
		...overrides
	};
}

function setup ({client = fakeClient(), tokens = {}} = {}) {
	const storage = {
		clientId: () => 'tv-test',
		tokenFor: jest.fn((id) => tokens[id] || null),
		saveToken: jest.fn((id, token) => {
			tokens[id] = token;
		}),
		rememberPhone: jest.fn()
	};
	const sockets = [];
	const connectEvents = jest.fn((options) => {
		const socket = {options, send: jest.fn(), close: jest.fn()};
		sockets.push(socket);
		return socket;
	});
	const connection = new Connection({
		clientName: 'LG OLED65C5PJA',
		capabilities: () => Promise.resolve(fixture('capabilities')),
		createClient: () => client,
		connectEvents,
		storage
	});
	return {client, connection, sockets, storage};
}

let current = null;
afterEach(() => {
	if (current) current.disconnect();
	current = null;
	jest.useRealTimers();
});

test('pairs a new TV, then opens a session and the event socket', async () => {
	jest.useFakeTimers();
	const client = fakeClient({
		pair: jest.fn()
			.mockResolvedValueOnce(parsePair(fixture('pair-pending')))
			.mockResolvedValueOnce(parsePair(fixture('pair-approved')))
	});
	const {connection, sockets, storage} = setup({client});
	current = connection;
	const done = connection.connect(PHONE);
	await jest.advanceTimersByTimeAsync(0);
	expect(connection.getState()).toMatchObject({status: 'pairing', code: '4821'});
	expect(client.pair.mock.calls[0][0]).toEqual({clientId: 'tv-test', clientName: 'LG OLED65C5PJA', clientKind: 'tv'});

	await jest.advanceTimersByTimeAsync(1000);
	await done;
	expect(client.pair.mock.calls[1][0].requestId).toBe(fixture('pair-pending').requestId);
	expect(storage.saveToken).toHaveBeenCalledWith(DEVICE, TOKEN);
	expect(client.openSession).toHaveBeenCalledWith(TOKEN);
	expect(client.sendCapabilities).toHaveBeenCalledWith(fixture('capabilities'));
	expect(storage.rememberPhone).toHaveBeenCalledWith(expect.objectContaining({host: PHONE.host, deviceId: DEVICE}));
	expect(connection.getState()).toMatchObject({status: 'ready', sessionVersion: 1, phone: {deviceName: 'SM-S938Q'}});
	expect(sockets).toHaveLength(1);
});

test('reuses a saved token without asking again', async () => {
	const {client, connection} = setup({tokens: {[DEVICE]: TOKEN}});
	current = connection;
	await connection.connect(PHONE);
	expect(client.pair).not.toHaveBeenCalled();
	expect(connection.getState().status).toBe('ready');
});

test('asks again when the phone no longer accepts the saved token', async () => {
	const client = fakeClient({
		openSession: jest.fn()
			.mockRejectedValueOnce(new HostError('revoked', 401))
			.mockResolvedValueOnce(parseSession(fixture('session')))
	});
	const {connection, storage} = setup({client, tokens: {[DEVICE]: 'old-token-old-token'}});
	current = connection;
	await connection.connect(PHONE);
	expect(storage.saveToken.mock.calls).toEqual([[DEVICE, null], [DEVICE, TOKEN]]);
	expect(connection.getState().status).toBe('ready');
});

test('stops at a phone without the TV protocol', async () => {
	const {protocolVersions, ...v1} = fixture('hello');
	const client = fakeClient({hello: jest.fn(() => Promise.resolve(parseHello(v1)))});
	const {connection} = setup({client});
	current = connection;
	expect(protocolVersions).toEqual([1, 2]);
	await connection.connect(PHONE);
	expect(connection.getState()).toMatchObject({status: 'error', message: MESSAGES.outdated});
	expect(client.pair).not.toHaveBeenCalled();
});

test('shows a rejection from the phone', async () => {
	const client = fakeClient({pair: jest.fn(() => Promise.resolve(parsePair({...fixture('pair-pending'), state: 'rejected'})))});
	const {connection} = setup({client});
	current = connection;
	await connection.connect(PHONE);
	expect(connection.getState()).toMatchObject({status: 'error', message: MESSAGES.rejected});
});

test('explains an unreachable phone', async () => {
	const client = fakeClient({hello: jest.fn(() => Promise.reject(new HostError('network', 0)))});
	const {connection} = setup({client});
	current = connection;
	await connection.connect(PHONE);
	expect(connection.getState()).toMatchObject({status: 'error', message: MESSAGES.unreachable});
});

test('hands events to listeners and ends on session_closed', async () => {
	const {connection, sockets} = setup({tokens: {[DEVICE]: TOKEN}});
	current = connection;
	await connection.connect(PHONE);
	const seen = [];
	connection.onEvent((event) => seen.push(event));
	sockets[0].options.onEvent({type: 'show', itemId: '1000118'});
	expect(seen).toEqual([{type: 'show', itemId: '1000118'}]);

	sockets[0].options.onEvent({type: 'session_closed'});
	expect(connection.getState()).toMatchObject({status: 'error', message: MESSAGES.closed});
	expect(sockets[0].close).toHaveBeenCalled();
});

test('renews an expired media key once and retries the request', async () => {
	const client = fakeClient({
		library: jest.fn()
			.mockRejectedValueOnce(new HostError('expired', 401))
			.mockResolvedValueOnce({items: [], next: null, total: 0})
	});
	const {connection, sockets} = setup({client, tokens: {[DEVICE]: TOKEN}});
	current = connection;
	await connection.connect(PHONE);
	await expect(connection.request((c) => c.library({filter: 'all'}))).resolves.toEqual({items: [], next: null, total: 0});
	expect(client.openSession).toHaveBeenCalledTimes(2);
	expect(connection.getState().sessionVersion).toBe(2);
	expect(sockets).toHaveLength(2);
	expect(sockets[0].close).toHaveBeenCalled();
});

test('a lost event socket to a phone that is gone ends the connection', async () => {
	const client = fakeClient({
		openSession: jest.fn()
			.mockResolvedValueOnce(parseSession(fixture('session')))
			.mockRejectedValueOnce(new HostError('network', 0))
	});
	const {connection, sockets} = setup({client, tokens: {[DEVICE]: TOKEN}});
	current = connection;
	await connection.connect(PHONE);
	sockets[0].options.onLost();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(connection.getState()).toMatchObject({status: 'error', message: MESSAGES.unreachable});
});
