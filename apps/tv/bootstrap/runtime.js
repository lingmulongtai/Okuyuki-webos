/* The packaged shell retains its file origin and can always start without the network. */
(function () {
	'use strict';
	const config = window.okuyukiUpdateConfig;
	const maximumEnvelope = 8 * 1024 * 1024;
	const maximumSource = 4 * 1024 * 1024;
	const updateInterval = 6 * 60 * 60 * 1000;
	let database;
	let runningVersion = config.version;
	window.okuyukiRuntimeVersion = config.version;
	const recoveryKey = 'okuyuki-runtime-recovery';

	function version (value) {
		if (typeof value !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) return null;
		return value.split('.').map(Number);
	}
	function newer (candidate, current) {
		const a = version(candidate); const b = version(current);
		if (!a || !b) return false;
		for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
		return false;
	}
	function bytes (encoded, maximum) {
		if (typeof encoded !== 'string' || encoded.length > Math.ceil(maximum / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid data');
		const binary = atob(encoded);
		if (!binary.length || binary.length > maximum) throw new Error('Invalid size');
		const result = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
		return result;
	}
	async function verified (envelope) {
		if (!crypto.subtle || typeof envelope !== 'string' || envelope.length > maximumEnvelope) throw new Error('Verification unavailable');
		const outer = JSON.parse(envelope);
		const payload = bytes(outer.payload, maximumEnvelope);
		const signature = bytes(outer.signature, 64);
		if (signature.length !== 64) throw new Error('Invalid signature');
		const key = await crypto.subtle.importKey('spki', bytes(config.publicKey, 256), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
		if (!await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, signature, payload)) throw new Error('Invalid signature');
		const item = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(payload));
		if (item.schema !== 1 || item.shell !== config.shell || !newer(item.version, config.version)) throw new Error('Incompatible update');
		return {version: item.version, javascript: bytes(item.javascript, maximumSource), css: bytes(item.css, maximumSource)};
	}
	function openDatabase () {
		return new Promise((resolve, reject) => {
			const request = window.indexedDB.open('okuyuki-tv-runtime', 1);
			request.onupgradeneeded = () => request.result.createObjectStore('state');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	function read (key) {
		return new Promise((resolve, reject) => {
			const request = database.transaction('state', 'readonly').objectStore('state').get(key);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	function bounded (promise, milliseconds) {
		let timer;
		return Promise.race([promise, new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error('Storage or verification timed out')), milliseconds);
		})]).finally(() => clearTimeout(timer));
	}
	function save (candidate, candidateVersion) {
		return new Promise((resolve, reject) => {
			const transaction = database.transaction('state', 'readwrite');
			const store = transaction.objectStore('state');
			const request = store.get('highWater');
			let saved = false;
			request.onsuccess = () => {
				const highWater = request.result || config.version;
				if (newer(candidateVersion, runningVersion) && newer(candidateVersion, highWater)) {
					store.put(candidate, 'candidate'); store.put(candidateVersion, 'highWater'); saved = true;
				}
			};
			transaction.oncomplete = () => resolve(saved);
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
	function removeCandidate (expected) {
		return new Promise((resolve) => {
			const tx = database.transaction('state', 'readwrite');
			const store = tx.objectStore('state');
			const current = store.get('candidate');
			current.onsuccess = () => {
				if (current.result === expected) store.delete('candidate');
			};
			tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false);
		});
	}
	function recoveryFlag (value) {
		try {
			if (value === true) sessionStorage.setItem(recoveryKey, '1');
			if (value === false) sessionStorage.removeItem(recoveryKey);
			if (sessionStorage.getItem(recoveryKey) === '1') return true;
		} catch (_) {
			if (value === true) {
				try {
					window.location.hash = '#okuyuki-runtime-safe';
				} catch (ignored) {
					return false;
				}
			}
		}
		if (value === false && window.location.hash === '#okuyuki-runtime-safe') window.location.hash = '';
		return window.location.hash === '#okuyuki-runtime-safe';
	}
	function packaged () {
		const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'main.css'; document.head.appendChild(css);
		const script = document.createElement('script'); script.src = 'main.js'; document.body.appendChild(script);
	}
	function launch (item) {
		return new Promise((resolve, reject) => {
			const css = document.createElement('style');
			css.setAttribute('data-okuyuki-runtime', '');
			css.textContent = new TextDecoder('utf-8', {fatal: true}).decode(item.css);
			document.head.appendChild(css);
			if (!css.sheet) {
				reject(new Error('Update style blocked')); return;
			}
			const url = URL.createObjectURL(new Blob([item.javascript], {type: 'text/javascript'}));
			const script = document.createElement('script');
			script.setAttribute('data-okuyuki-runtime', '');
			script.src = url;
			let ready; let timer; let stableTimer; let failed;
			const cleanup = () => {
				window.removeEventListener('okuyuki-runtime-started', ready);
				window.removeEventListener('error', failed);
				window.removeEventListener('unhandledrejection', failed);
				clearTimeout(timer); clearTimeout(stableTimer); URL.revokeObjectURL(url);
			};
			failed = () => {
				cleanup(); reject(new Error('Update failed during startup'));
			};
			ready = () => {
				stableTimer = setTimeout(() => {
					if (!document.getElementById('root').hasChildNodes()) {
						failed(); return;
					}
					cleanup(); resolve();
				}, 2000);
			};
			timer = setTimeout(() => {
				cleanup(); reject(new Error('Update did not start'));
			}, 15000);
			window.addEventListener('okuyuki-runtime-started', ready, {once: true});
			window.addEventListener('error', failed);
			window.addEventListener('unhandledrejection', failed);
			script.onerror = () => {
				cleanup(); reject(new Error('Update blocked'));
			};
			document.body.appendChild(script);
		});
	}
	async function fetchBounded () {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 15000);
		try {
			const response = await fetch(config.updateUrl, {signal: controller.signal, cache: 'no-store'});
			if (!response.ok || !response.body || !response.body.getReader) throw new Error('Update unavailable');
			const length = Number(response.headers.get('content-length'));
			if (length > maximumEnvelope) throw new Error('Update too large');
			const reader = response.body.getReader(); const chunks = []; let size = 0;
			while (true) {
				const part = await reader.read(); if (part.done) break;
				size += part.value.length;
				if (size > maximumEnvelope) {
					await reader.cancel(); throw new Error('Update too large');
				}
				chunks.push(part.value);
			}
			const all = new Uint8Array(size); let offset = 0;
			chunks.forEach((chunk) => {
				all.set(chunk, offset); offset += chunk.length;
			});
			return new TextDecoder('utf-8', {fatal: true}).decode(all);
		} finally {
			clearTimeout(timer);
		}
	}
	async function check () {
		try {
			const envelope = await fetchBounded(); const item = await verified(envelope);
			if (await save(envelope, item.version)) {
				window.okuyukiRuntimeUpdateReady = item.version;
				window.dispatchEvent(new CustomEvent('okuyuki-runtime-ready', {detail: item.version}));
			}
		} catch (_) { /* Network, storage, signature or compatibility failure: keep the installed app. */ }
	}
	async function start () {
		try {
			database = await bounded(openDatabase(), 3000);
			if (recoveryFlag()) {
				packaged();
				return;
			}
			const envelope = await bounded(read('candidate'), 5000);
			if (envelope) {
				try {
					const item = await bounded(verified(envelope), 10000); const highWater = await bounded(read('highWater'), 5000);
					if (highWater !== item.version) throw new Error('Rollback refused');
					await launch(item); runningVersion = item.version; window.okuyukiRuntimeVersion = item.version;
				} catch (_) {
					const guarded = recoveryFlag(true);
					const removed = await Promise.race([removeCandidate(envelope).catch(() => false), new Promise(resolve => setTimeout(() => resolve(false), 3000))]);
					if (removed) recoveryFlag(false);
					if (removed || guarded) {
						window.location.reload(); return;
					}
					document.querySelectorAll('[data-okuyuki-runtime]').forEach(element => element.remove());
					document.getElementById('root').textContent = '';
					packaged(); return;
				}
			} else packaged();
			check(); setInterval(check, updateInterval);
		} catch (_) {
			packaged();
		}
	}
	start();
})();
