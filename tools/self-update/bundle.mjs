import {createHash, sign, verify} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';

const MAX_SOURCE = 4 * 1024 * 1024;

/** Hash the packaged runtime assets which an updated script is allowed to use. */
export async function shellFingerprint(dist) {
    const files = [];
    async function walk(path) {
        for (const entry of await readdir(path, {withFileTypes: true})) {
            const child = join(path, entry.name);
            if (entry.isDirectory()) await walk(child);
            else if (entry.isFile()) files.push(child);
            else throw new Error('Unsupported packaged asset');
        }
    }
    for (const name of ['node_modules', 'resources']) await walk(join(dist, name));
    files.sort((a, b) => relative(dist, a).split(sep).join('/') < relative(dist, b).split(sep).join('/') ? -1 : 1);
    const hash = createHash('sha256');
    for (const file of files) {
        const name = relative(dist, file).split(sep).join('/');
        const bytes = await readFile(file);
        hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`);
        hash.update(bytes);
    }
    return hash.digest('hex');
}

/** Sign exact bytes rather than relying on the network manifest's unsigned checksum. */
export function createBundle({version, shell, javascript, css}, privateKey) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{64}$/.test(shell)) throw new Error('Invalid update metadata');
    const js = Buffer.from(javascript);
    const style = Buffer.from(css);
    if (!js.length || !style.length || js.length > MAX_SOURCE || style.length > MAX_SOURCE) throw new Error('Invalid update size');
    const payload = Buffer.from(JSON.stringify({schema: 1, version, shell, javascript: js.toString('base64'), css: style.toString('base64')}));
    const signature = sign('sha256', payload, {key: privateKey, dsaEncoding: 'ieee-p1363'});
    return JSON.stringify({payload: payload.toString('base64'), signature: signature.toString('base64')});
}

export function verifyBundle(envelope, publicKey) {
    const {payload, signature} = JSON.parse(envelope);
    const bytes = Buffer.from(payload, 'base64');
    if (!verify('sha256', bytes, {key: publicKey, dsaEncoding: 'ieee-p1363'}, Buffer.from(signature, 'base64'))) throw new Error('Invalid signature');
    return JSON.parse(bytes.toString('utf8'));
}
