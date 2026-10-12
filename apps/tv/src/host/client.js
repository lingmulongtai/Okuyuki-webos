// HTTP client for one phone host. Photos and videos never pass through here: views load them
// straight into <img> and <video> from the URLs this client builds.
import {
	DEFAULT_PORT,
	parseHello,
	parseItem,
	parseLibraryPage,
	parsePair,
	parsePrepared,
	parseSession
} from './protocol';

const TIMEOUT_MS = 8000;

export class HostError extends Error {
	constructor (message, status) {
		super(message);
		this.name = 'HostError';
		this.status = status;
	}
}

export function formatHost (host) {
	return host.indexOf(':') >= 0 && host[0] !== '[' ? '[' + host + ']' : host;
}

/**
 * Reads an address the way the phone shows it ("192.168.1.23:38765") into `{host, port}`, or null.
 * The port may be left out when the phone uses its usual one, "http://" and a final "/" are
 * ignored, and full-width digits and "。" from a Japanese keyboard are accepted.
 */
export function parseAddress (text) {
	const plain = String(text || '').normalize('NFKC').replace(/。/g, '.').trim()
		.replace(/^http:\/\//i, '').replace(/\/$/, '');
	const match = /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?:\s*:\s*(\d{1,5}))?$/.exec(plain);
	if (!match) return null;
	const host = match[1].replace(/^\[|\]$/g, '');
	// Digits and dots can only be an IPv4 address, and then a complete one.
	if (/^[\d.]+$/.test(host)) {
		const octets = host.split('.');
		if (octets.length !== 4 || octets.some((octet) => octet === '' || Number(octet) > 255)) return null;
	}
	const port = match[2] ? Number(match[2]) : DEFAULT_PORT;
	if (port < 1 || port > 65535) return null;
	return {host, port};
}

async function request (url, {method = 'GET', headers, body, timeout = TIMEOUT_MS} = {}) {
	const controller = typeof AbortController === 'function' ? new AbortController() : null;
	const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
	let response;
	try {
		response = await fetch(url, {method, headers, body, cache: 'no-store', signal: controller && controller.signal});
	} catch (error) {
		throw new HostError(error && error.name === 'AbortError' ? 'timeout' : 'network', 0);
	} finally {
		if (timer) clearTimeout(timer);
	}
	if (!response.ok) {
		let message = '';
		try {
			message = (await response.json()).message || '';
		} catch (error) {
			// Not every error has a JSON body.
		}
		throw new HostError(message || 'HTTP ' + response.status, response.status);
	}
	if (response.status === 204) return null;
	return response.json();
}

// Plain text bodies keep these requests "simple", so the browser skips the CORS preflight.
const json = (value) => ({method: 'POST', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify(value)});

export function createClient ({host, port}) {
	const base = 'http://' + formatHost(host) + ':' + port;
	let key = null;

	const keyed = (path) => {
		if (!key) throw new HostError('no session', 401);
		return base + '/v2/k/' + encodeURIComponent(key) + path;
	};
	const item = (id, path) => keyed('/items/' + encodeURIComponent(id) + path);

	return {
		host,
		port,
		base,
		hello: () => request(base + '/v1/hello', {timeout: 4000}).then(parseHello),
		pair: (body) => request(base + '/v1/pair', json(body)).then(parsePair),
		openSession: async (token) => {
			const session = parseSession(await request(base + '/v2/session', {
				method: 'POST',
				headers: {Authorization: 'Bearer ' + token}
			}));
			key = session.key;
			return session;
		},
		hasSession: () => key !== null,
		dropSession: () => {
			key = null;
		},
		sendCapabilities: (capabilities) => request(keyed('/capabilities'), json(capabilities)),
		library: ({filter, cursor}) => request(keyed('/library?filter=' + encodeURIComponent(filter) +
			(cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))).then(parseLibraryPage),
		item: (id) => request(item(id, '')).then(parseItem),
		prepare: (id, target) => request(item(id, '/prepare?target=' + target), {method: 'POST'}).then(parsePrepared),
		thumbUrl: (id) => item(id, '/thumb'),
		displayUrl: (id) => item(id, '/display'),
		resolve: (url) => (/^https?:\/\//.test(url) ? url : base + url),
		eventsUrl: () => keyed('/events').replace(/^http/, 'ws')
	};
}
