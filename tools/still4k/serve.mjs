#!/usr/bin/env node
// Serve converted photos to the 4K still test on the TV and collect its results.
// Usage: node tools/still4k/serve.mjs [directory] [port]
// The browser tests also use it to serve apps/still4k itself.
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'still4k-photos');
const port = Number(process.argv[3] ?? 8787);
const types = {
	'.avif': 'image/avif',
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.mp4': 'video/mp4',
	'.png': 'image/png',
	'.webm': 'video/webm',
	'.webp': 'image/webp'
};

function cors(res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
	res.setHeader('Access-Control-Allow-Private-Network', 'true');
	res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
}

function stream(res, path, options) {
	createReadStream(path, options)
		.on('error', () => res.destroy())
		.pipe(res);
}

async function sendFile(req, res, path) {
	let info = await stat(path);
	if (info.isDirectory()) {
		path = join(path, 'index.html');
		info = await stat(path);
	}
	const type = types[extname(path).toLowerCase()] ?? 'application/octet-stream';
	res.setHeader('Accept-Ranges', 'bytes');
	res.setHeader('Content-Type', type);
	res.setHeader('Cache-Control', 'no-store');
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
	if (!range || (range[1] === '' && range[2] === '')) {
		res.setHeader('Content-Length', info.size);
		res.writeHead(200);
		stream(res, path);
		return;
	}
	let start = range[1] === '' ? info.size - Number(range[2]) : Number(range[1]);
	const end = range[1] === '' || range[2] === '' ? info.size - 1 : Math.min(Number(range[2]), info.size - 1);
	start = Math.max(0, start);
	if (start > end || start >= info.size) {
		res.setHeader('Content-Range', `bytes */${info.size}`);
		res.writeHead(416);
		res.end();
		return;
	}
	res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
	res.setHeader('Content-Length', end - start + 1);
	res.writeHead(206);
	stream(res, path, { start, end });
}

async function saveResults(req, res) {
	let body = '';
	for await (const chunk of req) {
		body += chunk;
		if (body.length > 4 * 1024 * 1024) {
			res.writeHead(413);
			res.end();
			return;
		}
	}
	const file = join(root, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
	await writeFile(file, body);
	console.log(`saved ${file}`);
	res.writeHead(204);
	res.end();
}

const server = createServer(async (req, res) => {
	cors(res);
	try {
		if (req.method === 'OPTIONS') {
			res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST');
			res.writeHead(204);
			res.end();
			return;
		}
		const url = new URL(req.url, 'http://localhost');
		// Lets the browser tests wait for this server even before the TV app is built.
		if (url.pathname === '/__health') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('ok');
			return;
		}
		if (req.method === 'POST' && url.pathname === '/results') {
			await saveResults(req, res);
			return;
		}
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405);
			res.end();
			return;
		}
		const path = normalize(join(root, decodeURIComponent(url.pathname)));
		if (path !== root && !path.startsWith(root + sep)) {
			res.writeHead(403);
			res.end();
			return;
		}
		await sendFile(req, res, path);
	} catch (error) {
		if (!res.headersSent) res.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500);
		res.end();
	}
});

server.listen(port, '0.0.0.0', () => {
	console.log(`Serving ${root}`);
	for (const addresses of Object.values(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family === 'IPv4' && !address.internal) console.log(`  テレビに入力: http://${address.address}:${port}`);
		}
	}
});
