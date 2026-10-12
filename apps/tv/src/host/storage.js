// The only things the TV keeps between launches: who it is, the last phone and its token,
// and settings. Photos are never stored (spec section 9).
const STORAGE_KEY = 'okuyuki.tv';

function read () {
	try {
		const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
		return value && typeof value === 'object' ? value : {};
	} catch (error) {
		return {};
	}
}

function write (value) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch (error) {
		// Storage can be unavailable; pairing then simply lasts until the app closes.
	}
	return value;
}

function randomId () {
	const bytes = new Uint8Array(12);
	window.crypto.getRandomValues(bytes);
	return Array.prototype.map.call(bytes, (byte) => ('0' + byte.toString(16)).slice(-2)).join('');
}

export function clientId () {
	const state = read();
	if (state.clientId) return state.clientId;
	const id = 'tv-' + randomId();
	write({...state, clientId: id});
	return id;
}

/** The phone used last: `{host, port, deviceId, deviceName}` or null. */
export function lastPhone () {
	return read().lastPhone || null;
}

export function rememberPhone (phone) {
	write({...read(), lastPhone: phone});
}

export function tokenFor (deviceId) {
	const tokens = read().tokens || {};
	return tokens[deviceId] || null;
}

export function saveToken (deviceId, token) {
	const state = read();
	const tokens = {...(state.tokens || {})};
	if (token) tokens[deviceId] = token;
	else delete tokens[deviceId];
	write({...state, tokens});
}

export const DEFAULT_SETTINGS = {bestQuality: true};

export function loadSettings () {
	return {...DEFAULT_SETTINGS, ...(read().settings || {})};
}

export function saveSettings (settings) {
	write({...read(), settings});
}
