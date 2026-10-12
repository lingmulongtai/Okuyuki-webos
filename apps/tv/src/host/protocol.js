// Shapes of the phone host's protocol v2 (protocol/README.md). Every response is checked here,
// so the views can trust the objects they receive.

export const PROTOCOL_VERSION = 2;
export const FILTERS = ['all', 'photo', 'video', 'stereo'];
export const HDR_KINDS = ['none', 'ultrahdr', 'hdr10', 'hlg', 'hdr10plus'];
export const PAIR_STATES = ['pending', 'approved', 'rejected', 'expired'];
export const PREPARE_STATES = ['ready', 'preparing', 'unsupported', 'failed'];

export class ProtocolError extends Error {
	constructor (what) {
		super('Unexpected ' + what + ' from the phone');
		this.name = 'ProtocolError';
	}
}

const isString = (value) => typeof value === 'string';
const isNumber = (value) => typeof value === 'number' && isFinite(value);
const optionalNumber = (value) => (isNumber(value) ? value : null);
const optionalString = (value) => (isString(value) && value ? value : null);

function check (condition, what) {
	if (!condition) throw new ProtocolError(what);
}

export function parseHello (json) {
	check(json && isString(json.deviceId) && isString(json.deviceName), 'hello');
	const versions = Array.isArray(json.protocolVersions) ?
		json.protocolVersions.filter(isNumber) :
		[isNumber(json.protocolVersion) ? json.protocolVersion : 1];
	return {
		deviceId: json.deviceId,
		deviceName: json.deviceName,
		appVersion: isString(json.appVersion) ? json.appVersion : '',
		photoCount: isNumber(json.photoCount) ? json.photoCount : 0,
		protocolVersions: versions
	};
}

export function supportsTv (hello) {
	return hello.protocolVersions.indexOf(PROTOCOL_VERSION) >= 0;
}

export function parsePair (json) {
	check(json && isString(json.requestId) && PAIR_STATES.indexOf(json.state) >= 0, 'pairing response');
	check(json.state !== 'approved' || (isString(json.token) && json.token.length >= 16), 'pairing token');
	return {
		requestId: json.requestId,
		code: isString(json.code) ? json.code : '',
		state: json.state,
		token: json.state === 'approved' ? json.token : null
	};
}

export function parseSession (json) {
	check(json && isString(json.key) && json.key.length >= 16 && isNumber(json.expiresAt), 'session');
	return {key: json.key, expiresAt: json.expiresAt};
}

export function parseItem (json) {
	check(json && isString(json.id) && json.id && (json.kind === 'photo' || json.kind === 'video'), 'item');
	return {
		id: json.id,
		kind: json.kind,
		name: isString(json.name) ? json.name : '',
		takenAt: isNumber(json.takenAt) ? json.takenAt : 0,
		width: isNumber(json.width) ? json.width : 0,
		height: isNumber(json.height) ? json.height : 0,
		sizeBytes: isNumber(json.sizeBytes) ? json.sizeBytes : 0,
		mime: isString(json.mime) ? json.mime : '',
		durationMs: json.kind === 'video' ? optionalNumber(json.durationMs) : null,
		stereo: json.stereo === true,
		hdr: HDR_KINDS.indexOf(json.hdr) >= 0 ? json.hdr : 'none'
	};
}

export function parseLibraryPage (json) {
	check(json && Array.isArray(json.items), 'library page');
	return {
		items: json.items.map(parseItem),
		next: optionalString(json.next),
		total: optionalNumber(json.total)
	};
}

export function parsePrepared (json) {
	check(json && PREPARE_STATES.indexOf(json.state) >= 0, 'prepare response');
	const ready = json.state === 'ready';
	check(!ready || (isString(json.url) && json.url), 'prepared url');
	return {
		state: json.state,
		url: ready ? json.url : null,
		width: optionalNumber(json.width),
		height: optionalNumber(json.height),
		hdr: HDR_KINDS.indexOf(json.hdr) >= 0 ? json.hdr : 'none',
		mime: optionalString(json.mime),
		codecs: optionalString(json.codecs),
		progress: optionalNumber(json.progress)
	};
}

export function parseEvent (json) {
	check(json && isString(json.type) && json.type, 'event');
	return {
		type: json.type,
		itemId: optionalString(json.itemId),
		target: optionalString(json.target),
		state: optionalString(json.state)
	};
}
