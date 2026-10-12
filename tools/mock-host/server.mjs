#!/usr/bin/env node
// A stand-in for the phone's host (protocol v2), for developing and testing the TV app without
// the phone. It serves a synthetic library, or the photos and videos in a folder (--photos), makes
// 4K stills with ffmpeg in the best format the TV reports, and has /__mock/* endpoints so tests
// can approve pairing or send events the way the phone would.
//
// Usage: node tools/mock-host/server.mjs [--port 38765] [--photos DIR] [--items 150]
//        [--auto-approve] [--prepare-delay MS] [--session-ttl MS] [--heartbeat MS] [--cache DIR]
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { hostname, networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { folderLibrary, page, publicItem, sortItems, syntheticItem, syntheticLibrary, TEST_VIDEO_SECONDS } from './library.mjs';
import { exists, makeJpeg, makeStill, makeTestVideo, pickFormat, stillSize } from './media.mjs';
import { drawItem } from './png.mjs';
import { accept } from './ws.mjs';

const options = {
	port: 38765,
	host: '0.0.0.0',
	photos: null,
	items: 150,
	autoApprove: false,
	prepareDelay: 0,
	sessionTtl: 12 * 3600 * 1000,
	heartbeat: 15000,
	cache: join(tmpdir(), 'okuyuki-mock-host')
};

for (let i = 2; i < process.argv.length; i++) {
	const arg = process.argv[i];
	const value = () => process.argv[++i];
	if (arg === '--port') options.port = Number(value());
	else if (arg === '--host') options.host = value();
	else if (arg === '--photos') options.photos = resolve(value());
	else if (arg === '--items') options.items = Number(value());
	else if (arg === '--auto-approve') options.autoApprove = true;
	else if (arg === '--prepare-delay') options.prepareDelay = Number(value());
	else if (arg === '--session-ttl') options.sessionTtl = Number(value());
	else if (arg === '--heartbeat') options.heartbeat = Number(value());
	else if (arg === '--cache') options.cache = resolve(value());
	else {
		console.error(`知らないオプション: ${arg}`);
		process.exit(2);
	}
}

const PAIR_TTL_MS = 120 * 1000;
const MAX_PENDING = 8;
const BODY_LIMIT = 4096;

const device = {
	deviceId: createHash('sha1').update(`okuyuki-mock-${hostname()}`).digest('hex').slice(0, 32),
	deviceName: `モック（${hostname()}）`
};

const state = {
	items: [],
	byId: new Map(),
	nextNumber: 0,
	pairs: new Map(),
	tokens: new Map(),
	keys: new Map(),
	capabilities: null,
	viewing: null,
	viewingLog: [],
	sockets: new Set(),
	jobs: new Map(),
	pictures: new Map()
};

async function loadLibrary() {
	const items = options.photos ? await folderLibrary(options.photos) : syntheticLibrary(options.items);
	state.items = sortItems(items);
	state.byId = new Map(items.map((item) => [item.id, item]));
	state.nextNumber = items.reduce((max, item) => Math.max(max, item.number), 0) + 1;
	state.jobs.clear();
	state.pictures.clear();
}

// ---- HTTP helpers ----

function cors(res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Private-Network', 'true');
	res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
	res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(body));
}

function fail(res, status, message) {
	json(res, status, { message });
}

function readBody(req) {
	return new Promise((resolveBody, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > BODY_LIMIT) {
				reject(Object.assign(new Error('too large'), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			const text = Buffer.concat(chunks).toString('utf8');
			if (!text) return resolveBody({});
			try {
				resolveBody(JSON.parse(text));
			} catch {
				reject(Object.assign(new Error('bad json'), { status: 400 }));
			}
		});
		req.on('error', reject);
	});
}

function sendBuffer(res, type, buffer) {
	res.writeHead(200, { 'Content-Type': type, 'Content-Length': buffer.length });
	res.end(buffer);
}

async function sendFile(req, res, path, type) {
	const info = await stat(path);
	res.setHeader('Accept-Ranges', 'bytes');
	res.setHeader('Content-Type', type);
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
	let start = 0;
	let end = info.size - 1;
	if (range && (range[1] !== '' || range[2] !== '')) {
		if (range[1] === '') {
			start = Math.max(0, info.size - Number(range[2]));
		} else {
			start = Number(range[1]);
			if (range[2] !== '') end = Math.min(Number(range[2]), info.size - 1);
		}
		if (start > end || start >= info.size) {
			res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
			res.end();
			return;
		}
		res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
	} else {
		res.writeHead(200, { 'Content-Length': info.size });
	}
	if (req.method === 'HEAD') {
		res.end();
		return;
	}
	createReadStream(path, { start, end }).on('error', () => res.destroy()).pipe(res);
}

// ---- Pairing and sessions ----

const newSecret = (bytes) => randomBytes(bytes).toString('base64url');

function pairResponse(pair) {
	const body = { requestId: pair.requestId, code: pair.code, state: pair.state, token: null };
	if (pair.state === 'approved') {
		body.token = pair.token;
		// The token goes out once; the TV keeps it from here on.
		state.pairs.delete(pair.requestId);
	}
	return body;
}

function expirePairs() {
	const now = Date.now();
	for (const pair of state.pairs.values()) {
		if (pair.state === 'pending' && pair.expiresAt < now) pair.state = 'expired';
	}
}

function approve(pair) {
	pair.state = 'approved';
	pair.token = newSecret(32);
	state.tokens.set(pair.token, { clientId: pair.clientId, clientName: pair.clientName, clientKind: pair.clientKind });
	console.log(`許可しました: ${pair.clientName}`);
}

function announcePair(pair) {
	console.log(`\n「${pair.clientName}」から接続の要求です。テレビに表示されたコード: ${pair.code}`);
	if (process.stdin.isTTY && !options.autoApprove) console.log('許可するなら y、拒否するなら n を入力して Enter。');
}

function pendingPairs() {
	expirePairs();
	return [...state.pairs.values()].filter((pair) => pair.state === 'pending');
}

function handlePair(body) {
	expirePairs();
	if (typeof body.requestId === 'string') {
		const pair = state.pairs.get(body.requestId);
		if (!pair || pair.clientId !== body.clientId) return { status: 404, body: { message: '接続の要求が見つかりません。もう一度試してください。' } };
		return { status: 200, body: pairResponse(pair) };
	}
	if (typeof body.clientId !== 'string' || typeof body.clientName !== 'string') {
		return { status: 400, body: { message: '接続の要求が読み取れません。' } };
	}
	if (pendingPairs().length >= MAX_PENDING) return { status: 429, body: { message: '接続の要求が多すぎます。しばらくしてから試してください。' } };
	const pair = {
		requestId: newSecret(12),
		code: String(randomInt(0, 10000)).padStart(4, '0'),
		clientId: body.clientId,
		clientName: body.clientName.slice(0, 80),
		clientKind: body.clientKind === 'tv' ? 'tv' : 'headset',
		state: 'pending',
		token: null,
		expiresAt: Date.now() + PAIR_TTL_MS
	};
	state.pairs.set(pair.requestId, pair);
	if (options.autoApprove) approve(pair);
	else announcePair(pair);
	return { status: 200, body: pairResponse(pair) };
}

function openSession(req) {
	const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
	if (!match || !state.tokens.has(match[1])) return null;
	const session = { key: newSecret(16), expiresAt: Date.now() + options.sessionTtl, token: match[1] };
	state.keys.set(session.key, session);
	return { key: session.key, expiresAt: session.expiresAt };
}

function validKey(key) {
	const session = state.keys.get(key);
	if (!session) return false;
	if (session.expiresAt < Date.now() || !state.tokens.has(session.token)) {
		state.keys.delete(key);
		return false;
	}
	return true;
}

// ---- Events ----

function broadcast(event) {
	const text = JSON.stringify(event);
	for (const socket of state.sockets) socket.peer.send(text);
}

function closeSockets(code, reason) {
	for (const socket of state.sockets) socket.peer.close(code, reason);
	state.sockets.clear();
}

setInterval(() => broadcast({ type: 'heartbeat' }), options.heartbeat).unref();

// ---- Pictures, stills and videos ----

function cacheDir() {
	const source = options.photos ?? `synthetic-${options.items}`;
	return join(options.cache, createHash('sha1').update(source).digest('hex').slice(0, 12));
}

async function picture(item, kind) {
	const key = `${kind}:${item.id}`;
	if (!state.pictures.has(key)) {
		state.pictures.set(key, (async () => {
			const [width, height] = kind === 'thumb' ? [480, 270] : [1920, 1080];
			if (!item.path) return { type: 'image/png', data: drawItem(width, height, item.number, { video: item.kind === 'video' }) };
			const out = join(cacheDir(), `${item.id}-${kind}.jpg`);
			if (!(await exists(out))) await makeJpeg(item.path, out, width, height);
			return { type: 'image/jpeg', path: out };
		})());
	}
	try {
		return await state.pictures.get(key);
	} catch (error) {
		state.pictures.delete(key);
		throw error;
	}
}

/** The prepared file for a target, given what the TV reported it can play. */
function plan(item, target) {
	const format = pickFormat(state.capabilities);
	if (target === 'still') {
		if (item.kind !== 'photo' || !format) return null;
		const size = stillSize(state.capabilities);
		return { format, size, out: join(cacheDir(), `${item.id}-still-${size.width}x${size.height}-${format.name}.${format.ext}`) };
	}
	if (item.kind !== 'video') return null;
	if (item.path) {
		// Real videos are sent as they are; the TV checks whether it can play them.
		const codecs = item.codec === 'hevc' ? (/10/.test(item.profile ?? '') ? 'hvc1.2.4.L153.B0' : 'hvc1.1.6.L153.B0') :
			item.codec === 'h264' ? 'avc1.640033' : item.codec === 'vp9' ? 'vp09.00.51.08' : item.codec === 'av1' ? 'av01.0.13M.10' : null;
		return { original: true, out: item.path, format: { mime: item.mime === 'video/quicktime' ? 'video/mp4' : item.mime, codecs }, size: item };
	}
	if (!format) return null;
	return { format, size: { width: 1280, height: 720 }, out: join(cacheDir(), `${item.id}-video-${format.name}.${format.ext}`) };
}

function startJob(item, target, job) {
	job.state = 'preparing';
	job.startedAt = Date.now();
	job.promise = (async () => {
		if (options.prepareDelay) await new Promise((done) => setTimeout(done, options.prepareDelay));
		if (!(await exists(job.out))) {
			await mkdir(cacheDir(), { recursive: true });
			if (target === 'video') {
				await makeTestVideo(job.out, job.format, TEST_VIDEO_SECONDS);
			} else {
				let image = item.path;
				if (!image) {
					image = join(cacheDir(), `${item.id}-master-${job.size.width}x${job.size.height}.png`);
					await writeFile(image, drawItem(job.size.width, job.size.height, item.number, { fine: true }));
				}
				await makeStill(image, job.out, job.format, job.size);
			}
		}
		job.state = 'ready';
		broadcast({ type: 'prepared', itemId: item.id, target, state: 'ready' });
	})().catch((error) => {
		console.error(`準備に失敗しました（${item.name}）: ${error.message}`);
		job.state = 'failed';
		broadcast({ type: 'prepared', itemId: item.id, target, state: 'failed' });
	});
}

function prepare(item, target, key) {
	const planned = plan(item, target);
	if (!planned) return { state: 'unsupported' };
	const url = `/v2/k/${key}/items/${encodeURIComponent(item.id)}/${target === 'still' ? 'still' : 'video'}`;
	const ready = {
		state: 'ready',
		url,
		width: planned.size.width,
		height: planned.size.height,
		hdr: planned.original ? item.hdr : 'none',
		mime: planned.format.mime,
		codecs: planned.format.codecs,
		progress: 1
	};
	if (planned.original) return ready;
	let job = state.jobs.get(planned.out);
	if (!job) {
		job = { ...planned };
		state.jobs.set(planned.out, job);
		startJob(item, target, job);
	}
	if (job.state === 'ready') return ready;
	if (job.state === 'failed') {
		state.jobs.delete(planned.out);
		return { state: 'failed' };
	}
	const expected = target === 'still' ? 3000 : 6000;
	return { state: 'preparing', progress: Math.min(0.95, (Date.now() - job.startedAt) / (expected + options.prepareDelay)) };
}

// ---- Routes ----

async function keyed(req, res, key, rest, url) {
	if (!validKey(key)) return fail(res, 401, 'このテレビの接続が切れました。もう一度つないでください。');
	if (rest === '/capabilities' && req.method === 'POST') {
		state.capabilities = await readBody(req);
		res.writeHead(204);
		res.end();
		return;
	}
	if (rest === '/library' && req.method === 'GET') {
		const filter = url.searchParams.get('filter') ?? 'all';
		return json(res, 200, page(state.items, filter, url.searchParams.get('cursor')));
	}
	const match = /^\/items\/([^/]+)(\/[a-z]+)?$/.exec(rest);
	const item = match && state.byId.get(decodeURIComponent(match[1]));
	if (!match) return fail(res, 404, '見つかりません。');
	if (!item) return fail(res, 404, 'この写真や動画はスマホから削除されました。');
	const action = match[2] ?? '';
	if (action === '' && req.method === 'GET') return json(res, 200, publicItem(item));
	if ((action === '/thumb' || action === '/display') && (req.method === 'GET' || req.method === 'HEAD')) {
		const result = await picture(item, action.slice(1));
		if (result.data) return sendBuffer(res, result.type, result.data);
		return sendFile(req, res, result.path, result.type);
	}
	if (action === '/prepare' && req.method === 'POST') {
		const target = url.searchParams.get('target');
		if (target !== 'still' && target !== 'video') return fail(res, 400, 'target は still か video です。');
		return json(res, 200, prepare(item, target, key));
	}
	if ((action === '/still' || action === '/video') && (req.method === 'GET' || req.method === 'HEAD')) {
		const planned = plan(item, action.slice(1));
		const job = planned && (planned.original ? { state: 'ready' } : state.jobs.get(planned.out));
		if (!job || job.state !== 'ready') return fail(res, 404, 'まだ準備ができていません。');
		return sendFile(req, res, planned.out, planned.format.mime);
	}
	return fail(res, 404, '見つかりません。');
}

async function control(req, res, action, url) {
	switch (action) {
		case 'state':
			return json(res, 200, {
				pending: pendingPairs().map(({ requestId, code, clientName, clientKind }) => ({ requestId, code, clientName, clientKind })),
				tokens: state.tokens.size,
				sessions: state.keys.size,
				sockets: state.sockets.size,
				viewing: state.viewing,
				viewingLog: state.viewingLog,
				capabilities: state.capabilities,
				items: state.items.length
			});
		case 'approve':
		case 'reject': {
			const code = url.searchParams.get('code');
			const pairs = pendingPairs().filter((pair) => !code || pair.code === code);
			for (const pair of pairs) {
				if (action === 'approve') approve(pair);
				else pair.state = 'rejected';
			}
			return json(res, 200, { count: pairs.length });
		}
		case 'show': {
			const id = url.searchParams.get('id') ?? (state.items[Number(url.searchParams.get('index') ?? 0)] || {}).id;
			if (!state.byId.has(id)) return fail(res, 404, 'その項目はありません。');
			broadcast({ type: 'show', itemId: id });
			return json(res, 200, { itemId: id });
		}
		case 'library_changed': {
			const add = Number(url.searchParams.get('add') ?? 0);
			for (let i = 0; i < add; i++) {
				const item = syntheticItem(state.nextNumber++);
				item.takenAt = Date.now() - i;
				state.items.unshift(item);
				state.byId.set(item.id, item);
			}
			sortItems(state.items);
			broadcast({ type: 'library_changed' });
			return json(res, 200, { items: state.items.length });
		}
		case 'revoke':
			state.tokens.clear();
			state.keys.clear();
			closeSockets(1008, 'revoked');
			return json(res, 200, {});
		case 'close':
			broadcast({ type: 'session_closed' });
			state.keys.clear();
			closeSockets(1000, 'closed');
			return json(res, 200, {});
		case 'reset':
			state.pairs.clear();
			state.tokens.clear();
			state.keys.clear();
			state.capabilities = null;
			state.viewing = null;
			state.viewingLog = [];
			closeSockets(1001, 'reset');
			await loadLibrary();
			return json(res, 200, {});
		default:
			return fail(res, 404, '見つかりません。');
	}
}

async function route(req, res) {
	cors(res);
	if (req.method === 'OPTIONS') {
		res.writeHead(204, {
			'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
			'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
			'Access-Control-Max-Age': '600'
		});
		res.end();
		return;
	}
	const url = new URL(req.url, 'http://mock');
	const path = url.pathname;
	if (path === '/v1/hello' && req.method === 'GET') {
		return json(res, 200, {
			...device,
			appVersion: 'mock',
			photoCount: state.items.length,
			protocolVersion: 1,
			protocolVersions: [1, 2]
		});
	}
	if (path === '/v1/pair' && req.method === 'POST') {
		const result = handlePair(await readBody(req));
		return json(res, result.status, result.body);
	}
	if (path === '/v2/session' && req.method === 'POST') {
		const session = openSession(req);
		if (!session) return fail(res, 401, 'このテレビは許可されていません。スマホでもう一度許可してください。');
		return json(res, 200, session);
	}
	const keyMatch = /^\/v2\/k\/([^/]+)(\/.*)$/.exec(path);
	if (keyMatch) return keyed(req, res, keyMatch[1], keyMatch[2], url);
	const controlMatch = /^\/__mock\/([a-z_]+)$/.exec(path);
	if (controlMatch && (req.method === 'POST' || controlMatch[1] === 'state')) return control(req, res, controlMatch[1], url);
	return fail(res, 404, '見つかりません。');
}

const server = createServer((req, res) => {
	route(req, res).catch((error) => {
		if (res.headersSent) {
			res.destroy();
			return;
		}
		fail(res, error.status ?? 500, error.status ? '要求を読み取れませんでした。' : 'スマホ側でエラーが起きました。');
		if (!error.status) console.error(error);
	});
});

server.on('upgrade', (req, socket, head) => {
	const match = /^\/v2\/k\/([^/]+)\/events$/.exec(new URL(req.url, 'http://mock').pathname);
	if (!match) {
		socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
		return;
	}
	const peer = accept(req, socket, head);
	if (!peer) return;
	// Browsers cannot see the status of a refused handshake, so a bad key is a 1008 close.
	if (!validKey(match[1])) {
		peer.close(1008, 'invalid key');
		return;
	}
	const entry = { peer, key: match[1] };
	state.sockets.add(entry);
	peer.on('message', (text) => {
		let event;
		try {
			event = JSON.parse(text);
		} catch {
			return;
		}
		if (event && event.type === 'viewing') {
			state.viewing = event.itemId ?? null;
			state.viewingLog.push(state.viewing);
			if (state.viewingLog.length > 50) state.viewingLog.shift();
		}
	});
	peer.on('close', () => state.sockets.delete(entry));
});

function addresses() {
	return Object.values(networkInterfaces()).flat().filter((net) => net && net.family === 'IPv4' && !net.internal).map((net) => net.address);
}

await loadLibrary();
server.listen(options.port, options.host, () => {
	console.log(`Okuyuki モックホスト: ${state.items.length} 件（${options.photos ?? '合成した写真と動画'}）`);
	for (const address of addresses()) console.log(`  テレビで入力するアドレス: ${address}:${options.port}`);
	if (options.autoApprove) console.log('  接続の要求は自動で許可します。');
});

if (process.stdin.isTTY && !options.autoApprove) {
	createInterface({ input: process.stdin }).on('line', (line) => {
		const answer = line.trim().toLowerCase();
		const pending = pendingPairs();
		if (!pending.length || (answer !== 'y' && answer !== 'n')) return;
		const pair = pending[pending.length - 1];
		if (answer === 'y') approve(pair);
		else {
			pair.state = 'rejected';
			console.log(`拒否しました: ${pair.clientName}`);
		}
	});
}
