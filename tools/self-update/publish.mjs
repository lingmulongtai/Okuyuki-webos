import {createPublicKey} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createBundle, shellFingerprint} from './bundle.mjs';
import {requireCompatibleShell} from './compatibility.mjs';

const dist = process.argv[2] || 'apps/tv/dist';
const output = process.argv[3] || 'pages';
const privateKey = process.env.OKUYUKI_TV_UPDATE_PRIVATE_KEY;
if (!privateKey) throw new Error('TV runtime signing key is not configured');
const expected = createPublicKey(await readFile('tools/self-update/public-key.pem', 'utf8')).export({type: 'spki', format: 'der'});
const actual = createPublicKey(privateKey).export({type: 'spki', format: 'der'});
if (!expected.equals(actual)) throw new Error('TV runtime signing key does not match the packaged public key');
const info = JSON.parse(await readFile(join(dist, 'appinfo.json'), 'utf8'));
if (info.id !== 'com.okuyuki.tv') throw new Error('Incorrect application');
const shell = await shellFingerprint(dist);
requireCompatibleShell(shell, process.env.OKUYUKI_TV_REQUIRED_SHELL);
const envelope = createBundle({version: info.version, shell,
    javascript: await readFile(join(dist, 'main.js')), css: await readFile(join(dist, 'main.css'))}, privateKey);
await mkdir(output, {recursive: true});
await writeFile(join(output, 'runtime.json'), envelope);
await writeFile(join(output, 'main.js.LICENSE.txt'), await readFile(join(dist, 'main.js.LICENSE.txt')));
console.log(`Signed TV runtime ${info.version}`);
