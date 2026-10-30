import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createPublicKey} from 'node:crypto';
import {shellFingerprint} from '../../../tools/self-update/bundle.mjs';

const dist = process.argv[2] || 'dist';
const info = JSON.parse(await readFile(join(dist, 'appinfo.json'), 'utf8'));
const pem = await readFile('../../tools/self-update/public-key.pem', 'utf8');
const publicKey = createPublicKey(pem).export({format: 'der', type: 'spki'}).toString('base64');
const config = {
	version: info.version,
	shell: await shellFingerprint(dist),
	publicKey,
	updateUrl: 'https://lingmulongtai.github.io/Okuyuki-webos/runtime.json'
};
const runtime = await readFile('bootstrap/runtime.js', 'utf8');
await writeFile(join(dist, 'bootstrap.js'), `window.okuyukiUpdateConfig=${JSON.stringify(config)};\n${runtime}`);
const path = join(dist, 'index.html');
let html = await readFile(path, 'utf8');
const style = '<link href="main.css" rel="stylesheet"/>';
const script = '<script defer="defer" src="main.js"></script>';
if (!html.includes(style) || !html.includes(script)) throw new Error('Unexpected Enact entry point');
html = html.replace(style, '').replace(script, '<script defer="defer" src="bootstrap.js"></script>');
await writeFile(path, html);
