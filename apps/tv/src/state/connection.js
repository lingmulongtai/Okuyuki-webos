// Connection to one phone: hello, pairing on the phone, the media session and the event socket.
// Views read `getState()` and call `request()`; nothing else talks to the phone.
import {createClient as defaultCreateClient, HostError} from '../host/client';
import {connectEvents as defaultConnectEvents} from '../host/events';
import {ProtocolError, supportsTv} from '../host/protocol';
import * as defaultStorage from '../host/storage';

const PAIR_POLL_MS = 1000;
const RENEW_BEFORE_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const MESSAGES = {
	unreachable: 'スマホにつながりませんでした。スマホの「接続を待つ」がオンで、テレビと同じネットワークにあるか確かめてください。',
	outdated: 'スマホの Okuyuki がテレビに対応していません。スマホのアプリを最新にしてください。',
	unreadable: 'スマホの応答を読み取れませんでした。テレビとスマホの Okuyuki を、どちらも最新にしてください。',
	rejected: 'スマホで拒否されました。つなぐときは、スマホで「許可する」を押してください。',
	expired: '時間内に許可されませんでした。もう一度つないで、スマホで「許可する」を押してください。',
	closed: 'スマホで接続がオフになりました。スマホの「接続を待つ」をオンにすると、またつなげます。'
};

/** The text as a sentence of the app's: ending in "。" unless it already ends in punctuation. */
export function sentence (text) {
	const trimmed = text.trim();
	return !trimmed || /[。．.！!？?…]$/.test(trimmed) ? trimmed : trimmed + '。';
}

export function describeError (error) {
	if (error instanceof ProtocolError) return MESSAGES.unreadable;
	if (error instanceof HostError) {
		if (error.status === 0) return MESSAGES.unreachable;
		// The phone explains its refusals in Japanese; anything else is the TV's own wording.
		if (/[\u3000-\u9fff]/.test(error.message)) return sentence(error.message);
		return 'スマホが応答できませんでした（' + error.status + '）。';
	}
	return MESSAGES.unreadable;
}

export class Connection {
	constructor ({
		clientName,
		capabilities,
		createClient = defaultCreateClient,
		connectEvents = defaultConnectEvents,
		storage = defaultStorage
	}) {
		this.clientName = clientName;
		this.capabilities = capabilities;
		this.createClient = createClient;
		this.connectEvents = connectEvents;
		this.storage = storage;
		this.attempt = 0;
		this.client = null;
		this.token = null;
		this.events = null;
		this.renewTimer = null;
		this.renewing = null;
		this.listeners = new Set();
		this.eventListeners = new Set();
		this.state = {status: 'idle', phone: null, code: null, message: null, sessionVersion: 0};
	}

	subscribe = (listener) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getState = () => this.state;

	onEvent (listener) {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	set (patch) {
		this.state = {...this.state, ...patch};
		this.listeners.forEach((listener) => listener());
	}

	fail (message) {
		this.set({status: 'error', code: null, message});
	}

	teardown () {
		clearTimeout(this.renewTimer);
		if (this.events) this.events.close();
		this.events = null;
		this.client = null;
		this.token = null;
		this.renewing = null;
	}

	/** Starts over with a phone given by launch parameters, the last phone, or a typed address. */
	async connect (target) {
		const attempt = ++this.attempt;
		this.teardown();
		const client = this.createClient(target);
		this.set({
			status: 'connecting',
			phone: {host: target.host, port: target.port, deviceId: target.deviceId || null, deviceName: target.deviceName || null},
			code: null,
			message: null
		});
		try {
			const hello = await client.hello();
			if (attempt !== this.attempt) return;
			if (!supportsTv(hello)) {
				this.fail(MESSAGES.outdated);
				return;
			}
			const phone = {host: target.host, port: target.port, deviceId: hello.deviceId, deviceName: hello.deviceName};
			this.set({phone});

			let token = this.storage.tokenFor(hello.deviceId);
			let session = null;
			if (token) {
				try {
					session = await client.openSession(token);
				} catch (error) {
					if (error.status !== 401) throw error;
					// The phone revoked this TV; ask for approval again.
					this.storage.saveToken(hello.deviceId, null);
					token = null;
				}
			}
			if (!token) {
				token = await this.pair(client, attempt);
				if (!token) return;
				this.storage.saveToken(hello.deviceId, token);
				session = await client.openSession(token);
			}
			if (attempt !== this.attempt) return;
			this.storage.rememberPhone(phone);
			this.client = client;
			this.token = token;
			this.scheduleRenewal(session);
			try {
				await client.sendCapabilities(await this.capabilities());
			} catch (error) {
				// The phone falls back to HEVC when it does not know what the TV can play.
			}
			if (attempt !== this.attempt) return;
			this.set({status: 'ready', code: null, message: null, sessionVersion: this.state.sessionVersion + 1});
			this.startEvents();
		} catch (error) {
			if (attempt === this.attempt) this.fail(describeError(error));
		}
	}

	async pair (client, attempt) {
		const body = {clientId: this.storage.clientId(), clientName: this.clientName, clientKind: 'tv'};
		let requestId = null;
		while (attempt === this.attempt) {
			const response = await client.pair(requestId ? {...body, requestId} : body);
			if (attempt !== this.attempt) return null;
			requestId = response.requestId;
			if (response.state === 'approved') return response.token;
			if (response.state === 'rejected' || response.state === 'expired') {
				this.fail(MESSAGES[response.state]);
				return null;
			}
			this.set({status: 'pairing', code: response.code});
			await sleep(PAIR_POLL_MS);
		}
		return null;
	}

	retry () {
		if (this.state.phone) this.connect(this.state.phone);
	}

	/** Stops talking to the phone, for example after it turned sharing off. */
	disconnect (message = null) {
		this.attempt++;
		this.teardown();
		this.set({status: message ? 'error' : 'idle', code: null, message});
	}

	scheduleRenewal (session) {
		clearTimeout(this.renewTimer);
		const wait = Math.max(60000, session.expiresAt - Date.now() - RENEW_BEFORE_MS);
		this.renewTimer = setTimeout(() => {
			this.renewSession().catch(() => {});
		}, Math.min(wait, 2147483647));
	}

	/** Opens a fresh media session with the saved token. Shared by everyone who sees a 401. */
	renewSession () {
		if (this.renewing) return this.renewing;
		const client = this.client;
		if (!client) return Promise.reject(new HostError('not connected', 0));
		this.renewing = client.openSession(this.token).then((session) => {
			this.scheduleRenewal(session);
			this.set({sessionVersion: this.state.sessionVersion + 1});
			this.restartEvents();
			return session;
		}, (error) => {
			if (error.status === 401 && this.state.phone) {
				this.storage.saveToken(this.state.phone.deviceId, null);
				this.connect(this.state.phone);
			}
			throw error;
		}).finally(() => {
			this.renewing = null;
		});
		return this.renewing;
	}

	/** Runs `call(client)`, renewing the media session once if the phone says it expired. */
	async request (call) {
		const client = this.client;
		if (!client || this.state.status !== 'ready') throw new HostError('not connected', 0);
		try {
			return await call(client);
		} catch (error) {
			if (error.status !== 401 || client !== this.client) throw error;
			await this.renewSession();
			return call(this.client);
		}
	}

	startEvents () {
		const client = this.client;
		this.events = this.connectEvents({
			url: () => client.eventsUrl(),
			onEvent: (event) => {
				if (event.type === 'session_closed') {
					this.disconnect(MESSAGES.closed);
					return;
				}
				this.eventListeners.forEach((listener) => listener(event));
			},
			onLost: () => {
				if (client !== this.client) return;
				// A new media key fixes a phone that restarted; a phone that is gone ends the connection.
				this.renewSession().catch((error) => {
					if (client === this.client && error.status !== 401) this.disconnect(describeError(error));
				});
			}
		});
	}

	restartEvents () {
		if (this.events) this.events.close();
		this.events = null;
		if (this.client) this.startEvents();
	}

	send (event) {
		if (this.events) this.events.send(event);
	}
}
