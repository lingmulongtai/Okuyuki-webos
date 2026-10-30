import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {installedVersion, selectRelease, updateOnce} from './updater.mjs';

const bytes = Buffer.from('test IPK');
const hash = createHash('sha256').update(bytes).digest('hex');
const release = (v = '0.1.1', overrides = {}) => {
    const tag = `v${v}-alpha.1-preview`;
    const name = `com.okuyuki.tv_${v}_all.ipk`;
    return {tag_name: tag, draft: false, assets: [{name, state: 'uploaded', size: bytes.length,
        digest: `sha256:${hash}`, browser_download_url: `https://github.com/lingmulongtai/Okuyuki-webos/releases/download/${tag}/${name}`, ...overrides}]};
};

test('reads the exact app version and refuses missing or malformed installations', () => {
    assert.equal(installedVersion('id : another\nversion : 9.0.0\nid : com.okuyuki.tv\nversion : 0.1.0\n'), '0.1.0');
    assert.throws(() => installedVersion('id : com.okuyuki.tv\ntitle : TV\n'));
    assert.throws(() => installedVersion('id : com.okuyuki.tv.other\nversion : 0.1.0\n'));
});

test('selects a newer release with a pinned asset, without downgrading', () => {
    assert.equal(selectRelease([release('0.1.1'), release('0.1.3'), release('0.1.2')], '0.1.0').tag, 'v0.1.3-alpha.1-preview');
    assert.equal(selectRelease([release('0.1.1')], '0.1.2'), null);
    assert.equal(selectRelease([release('0.1.1', {digest: null})], '0.1.0'), null);
    assert.equal(selectRelease([release('0.1.1', {browser_download_url: 'https://example.com/x.ipk'})], '0.1.0'), null);
    assert.equal(selectRelease([{...release(), draft: true}], '0.1.0'), null);
});

test('downloads and verifies the exact IPK before calling the installer', async () => {
    let installs = 0;
    const execute = async (_binary, args) => {
        if (args.includes('--listfull')) return {stdout: 'id : com.okuyuki.tv\nversion : 0.1.0\n'};
        assert.deepEqual(await readFile(args.at(-1)), bytes);
        installs++;
        return {stdout: 'success'};
    };
    const fetcher = async url => url.includes('api.github.com')
        ? new Response(JSON.stringify([release()]), {status: 200})
        : new Response(bytes, {status: 200, headers: {'content-length': `${bytes.length}`}});
    assert.equal(await updateOnce('myTV', {fetcher, execute}), 'v0.1.1-alpha.1-preview');
    assert.equal(installs, 1);
    const badFetcher = async url => url.includes('api.github.com')
        ? new Response(JSON.stringify([release()]), {status: 200}) : new Response(Buffer.from('bad data'));
    await assert.rejects(updateOnce('myTV', {fetcher: badFetcher, execute}));
    assert.equal(installs, 1);
    await assert.rejects(updateOnce('../other', {fetcher, execute}));
});
