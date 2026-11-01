import {readFile} from 'node:fs/promises';
import {requireForwardUpdate, requirePublishedUpdate} from './deployment.mjs';

const url = 'https://lingmulongtai.github.io/Okuyuki-webos/runtime.json';
const maximum = 8 * 1024 * 1024;
const mode = process.argv[2];
if (mode !== 'before' && mode !== 'after') throw new Error('Expected before or after');
const expected = await readFile(process.argv[3] || 'pages/runtime.json', 'utf8');
const key = await readFile('tools/self-update/public-key.pem');

async function download() {
    const response = await fetch(url, {headers: {Origin: 'null'}, cache: 'no-store', signal: AbortSignal.timeout(5000)});
    if (!response.ok || response.headers.get('access-control-allow-origin') !== '*' || !response.body) throw new Error(`Runtime delivery unavailable: HTTP ${response.status}`);
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
        length += chunk.length;
        if (length > maximum) throw new Error('Published runtime is too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

let lastError;
for (let attempt = 0; attempt < 12; attempt++) {
    let current;
    try {
        current = await download();
    } catch (error) {
        lastError = error;
        if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
    }
    if (mode === 'before') {
        requireForwardUpdate(current, expected, key);
        console.log('Published runtime can advance to this release');
        process.exit(0);
    }
    try {
        requirePublishedUpdate(current, expected, key);
        console.log('Published runtime matches the signed release');
        process.exit(0);
    } catch (error) {
        lastError = error;
        if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 3000));
    }
}
throw lastError || new Error('Runtime delivery unavailable');
