// Asks the phone for a 4K still or a playable video and waits while it converts.

const POLL_MS = 2000;

function waitForPrepared (connection, id, target, timeout) {
	return new Promise((resolve) => {
		let off = null;
		const timer = setTimeout(() => {
			off();
			resolve();
		}, timeout);
		off = connection.onEvent((event) => {
			if (event.type === 'prepared' && event.itemId === id && (!event.target || event.target === target)) {
				clearTimeout(timer);
				off();
				resolve();
			}
		});
	});
}

/**
 * Resolves with the final Prepared (`ready`, `unsupported` or `failed`), or null when
 * `isCancelled()` turns true. `onProgress` gets the phone's progress while it converts.
 */
export async function prepareWithWait (connection, id, target, isCancelled, onProgress) {
	let prepared = await connection.request((client) => client.prepare(id, target));
	while (prepared.state === 'preparing') {
		if (isCancelled()) return null;
		if (onProgress) onProgress(prepared.progress);
		await waitForPrepared(connection, id, target, POLL_MS);
		if (isCancelled()) return null;
		prepared = await connection.request((client) => client.prepare(id, target));
	}
	return isCancelled() ? null : prepared;
}
