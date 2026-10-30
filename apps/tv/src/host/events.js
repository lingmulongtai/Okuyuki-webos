// Keeps the event WebSocket to the phone open. The phone sends a heartbeat every 15 seconds,
// so silence for longer than HEARTBEAT_TIMEOUT_MS means the connection is gone.
import {parseEvent} from './protocol';

export const HEARTBEAT_TIMEOUT_MS = 40000;
const POLICY_VIOLATION = 1008;

export function connectEvents ({url, onEvent, onLost}) {
	let socket = null;
	let closed = false;
	let watchdog = null;
	let retryTimer = null;
	let failures = 0;

	function resetWatchdog () {
		clearTimeout(watchdog);
		watchdog = setTimeout(() => socket && socket.close(), HEARTBEAT_TIMEOUT_MS);
	}

	function open () {
		if (closed) return;
		let opened = false;
		try {
			socket = new WebSocket(url());
		} catch (error) {
			onLost(error);
			return;
		}
		socket.onopen = () => {
			opened = true;
			failures = 0;
			resetWatchdog();
		};
		socket.onmessage = (message) => {
			resetWatchdog();
			let event;
			try {
				event = parseEvent(JSON.parse(message.data));
			} catch (error) {
				return;
			}
			onEvent(event);
		};
		socket.onclose = (event) => {
			clearTimeout(watchdog);
			socket = null;
			if (closed) return;
			failures = opened ? 0 : failures + 1;
			// The phone closes with 1008 when the media key is no longer valid. A socket that
			// keeps failing before it opens usually means the same, so let the owner renew it.
			if (event.code === POLICY_VIOLATION || failures >= 3) {
				onLost(event);
				return;
			}
			retryTimer = setTimeout(open, Math.min(30000, 1000 * Math.pow(2, failures)));
		};
	}

	open();
	return {
		send (event) {
			if (socket && socket.readyState === 1) socket.send(JSON.stringify(event));
		},
		close () {
			closed = true;
			clearTimeout(watchdog);
			clearTimeout(retryTimer);
			if (socket) socket.close();
			socket = null;
		}
	};
}
