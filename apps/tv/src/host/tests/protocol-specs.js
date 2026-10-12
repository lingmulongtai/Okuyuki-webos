import {
	parseEvent,
	parseHello,
	parseItem,
	parseLibraryPage,
	parsePair,
	parsePrepared,
	parseSession,
	ProtocolError,
	supportsTv
} from '../protocol';

import {fixture, fixtureNames} from './fixtures';

describe('protocol v2 fixtures', () => {
	test('every fixture is covered by a test below', () => {
		expect(fixtureNames().sort()).toEqual([
			'capabilities', 'error', 'event-heartbeat', 'event-library-changed', 'event-prepared',
			'event-session-closed', 'event-show', 'event-viewing', 'hello', 'item', 'library-page',
			'pair-approved', 'pair-pending', 'pair-request', 'prepare-preparing', 'prepare-ready',
			'prepare-unsupported', 'session'
		]);
	});

	test('hello from a phone that speaks v2', () => {
		const hello = parseHello(fixture('hello'));
		expect(hello.deviceName).toBe('SM-S938Q');
		expect(hello.protocolVersions).toEqual([1, 2]);
		expect(supportsTv(hello)).toBe(true);
	});

	test('hello from a phone that only knows the Quest protocol', () => {
		const {protocolVersions, ...v1} = fixture('hello');
		expect(protocolVersions).toBeDefined();
		const hello = parseHello(v1);
		expect(hello.protocolVersions).toEqual([1]);
		expect(supportsTv(hello)).toBe(false);
	});

	test('pairing: pending, then approved with a token', () => {
		const request = fixture('pair-request');
		expect(request.clientKind).toBe('tv');
		const pending = parsePair(fixture('pair-pending'));
		expect(pending).toEqual({requestId: pending.requestId, code: '4821', state: 'pending', token: null});
		const approved = parsePair(fixture('pair-approved'));
		expect(approved.state).toBe('approved');
		expect(approved.token.length).toBeGreaterThanOrEqual(16);
	});

	test('an approval without a token is rejected', () => {
		expect(() => parsePair({...fixture('pair-approved'), token: null})).toThrow(ProtocolError);
	});

	test('session', () => {
		expect(parseSession(fixture('session'))).toEqual({key: 'Vb3nQ8cX1zL5mK9pR2tW7y', expiresAt: 1791817200000});
		expect(() => parseSession({key: 'short', expiresAt: 1})).toThrow(ProtocolError);
	});

	test('capabilities name only known formats', () => {
		const capabilities = fixture('capabilities');
		expect(capabilities.screen).toEqual({graphicsWidth: 1920, graphicsHeight: 1080, videoWidth: 3840, videoHeight: 2160});
		expect(capabilities.video[0]).toBe('hevc-main10');
	});

	test('library page and item', () => {
		const page = parseLibraryPage(fixture('library-page'));
		expect(page.items.map((entry) => entry.kind)).toEqual(['photo', 'video', 'photo']);
		expect(page.items[1].durationMs).toBe(61233);
		expect(page.items[0].durationMs).toBeNull();
		expect(page.items[2].stereo).toBe(true);
		expect(page.next).toBe('MTc5MTYwNTEwMTAwMDoxMDAwMTE4');
		expect(page.total).toBe(1532);
		const item = parseItem(fixture('item'));
		expect(item).toMatchObject({id: '1000123', kind: 'photo', hdr: 'ultrahdr', stereo: false});
	});

	test('unknown HDR kinds read as none', () => {
		expect(parseItem({...fixture('item'), hdr: 'something-new'}).hdr).toBe('none');
	});

	test('prepare: preparing, ready, unsupported', () => {
		const preparing = parsePrepared(fixture('prepare-preparing'));
		expect(preparing).toMatchObject({state: 'preparing', url: null, progress: 0.35});
		const ready = parsePrepared(fixture('prepare-ready'));
		expect(ready).toMatchObject({state: 'ready', width: 3840, height: 2160, hdr: 'hdr10', mime: 'video/mp4', codecs: 'hvc1.2.4.L153.B0'});
		expect(ready.url).toMatch(/^\/v2\/k\/[^/]+\/items\/1000123\/still$/);
		expect(parsePrepared(fixture('prepare-unsupported')).state).toBe('unsupported');
		expect(() => parsePrepared({state: 'ready'})).toThrow(ProtocolError);
	});

	test('events', () => {
		expect(parseEvent(fixture('event-prepared'))).toEqual({type: 'prepared', itemId: '1000123', target: 'still', state: 'ready'});
		expect(parseEvent(fixture('event-show')).itemId).toBe('1000118');
		expect(parseEvent(fixture('event-viewing')).type).toBe('viewing');
		expect(parseEvent(fixture('event-library-changed')).type).toBe('library_changed');
		expect(parseEvent(fixture('event-session-closed')).type).toBe('session_closed');
		expect(parseEvent(fixture('event-heartbeat')).type).toBe('heartbeat');
		expect(() => parseEvent({})).toThrow(ProtocolError);
	});

	test('errors carry a message the TV can show', () => {
		expect(fixture('error').message).toMatch(/許可/);
	});
});
