import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, rmdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBundle, shellFingerprint, verifyBundle} from './bundle.mjs';

test('signs exact runtime bytes and refuses tampering or another signing identity', () => {
    const keys = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const other = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const input = {version: '0.1.3', shell: 'a'.repeat(64), javascript: 'window.example=1;', css: 'body{color:red}'};
    const bundle = createBundle(input, keys.privateKey);
    const result = verifyBundle(bundle, keys.publicKey);
    assert.equal(Buffer.from(result.javascript, 'base64').toString(), input.javascript);
    assert.throws(() => verifyBundle(bundle, other.publicKey));
    const parsed = JSON.parse(bundle);
    const modified = JSON.parse(Buffer.from(parsed.payload, 'base64').toString());
    modified.version = '99.0.0';
    parsed.payload = Buffer.from(JSON.stringify(modified)).toString('base64');
    assert.throws(() => verifyBundle(JSON.stringify(parsed), keys.publicKey));
    assert.throws(() => createBundle({...input, version: '../invalid'}, keys.privateKey));
});

test('asset fingerprint changes when a packaged dependency changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'okuyuki-shell-test-'));
    try {
        await mkdir(join(root, 'node_modules'));
        await mkdir(join(root, 'resources'));
        await writeFile(join(root, 'node_modules', 'font'), 'a');
        await writeFile(join(root, 'resources', 'locale'), 'b');
        const first = await shellFingerprint(root);
        assert.equal(first, await shellFingerprint(root));
        await writeFile(join(root, 'resources', 'locale'), 'c');
        assert.notEqual(first, await shellFingerprint(root));
        assert.equal((await readFile(join(root, 'node_modules', 'font'))).toString(), 'a');
    } finally {
        await rm(join(root, 'node_modules', 'font'), {force: true});
        await rm(join(root, 'resources', 'locale'), {force: true});
        await rmdir(join(root, 'node_modules'));
        await rmdir(join(root, 'resources'));
        await rmdir(root);
    }
});
