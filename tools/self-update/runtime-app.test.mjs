import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {generateKeyPairSync} from 'node:crypto';
import {cp, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {createBundle, shellFingerprint} from './bundle.mjs';

test('actual Enact app starts as a verified file-origin update with packaged assets', {timeout: 120000}, async () => {
    const source = resolve('apps/tv/dist');
    const root = await mkdtemp(join(tmpdir(), 'okuyuki-real-runtime-'));
    const keys = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const shell = await shellFingerprint(source);
    const script = await readFile(join(source, 'main.js'));
    const css = await readFile(join(source, 'main.css'));
    const runtime = await readFile('apps/tv/bootstrap/runtime.js', 'utf8');
    const config = {version: '0.1.1', shell, publicKey: keys.publicKey.export({format: 'der', type: 'spki'}).toString('base64'), updateUrl: 'https://updates.example/runtime.json'};
    const envelope = createBundle({version: '0.1.2', shell, javascript: script, css}, keys.privateKey);
    const browser = await chromium.launch({headless: true, args: ['--allow-file-access-from-files']});
    try {
        await cp(source, root, {recursive: true});
        await writeFile(join(root, 'bootstrap.js'), `window.okuyukiUpdateConfig=${JSON.stringify(config)};\n${runtime}`);
        const context = await browser.newContext({viewport: {width: 1920, height: 1080}});
        await context.route(config.updateUrl, route => route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, body: envelope}));
        await context.route('https://api.github.com/**', route => route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, body: '[]'}));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(pathToFileURL(join(root, 'index.html')).href);
        await page.waitForFunction(() => document.getElementById('root').hasChildNodes());
        await page.waitForFunction(() => new Promise(resolveCandidate => {
            const request = indexedDB.open('okuyuki-tv-runtime', 1);
            request.onsuccess = () => { const get = request.result.transaction('state').objectStore('state').get('candidate'); get.onsuccess = () => resolveCandidate(!!get.result); };
        }));
        await page.reload();
        await page.waitForFunction(() => window.okuyukiRuntimeVersion === '0.1.2');
        await page.waitForFunction(() => document.querySelector('[data-testid="runtime-status"]')?.textContent.includes('適用済み'));
        assert.equal(await page.evaluate(() => window.okuyukiUpdateConfig.version), '0.1.1');
        assert.match(await page.locator('#root').innerText(), /スマホ|接続/);
        assert.equal(await page.evaluate(() => location.protocol), 'file:');
        assert.deepEqual(errors, []);
        await context.close();
    } finally {
        await browser.close();
        const absolute = await realpath(root);
        if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.split(sep).at(-1).startsWith('okuyuki-real-runtime-')) throw new Error('Unexpected temporary path');
        await rm(absolute, {recursive: true, force: true});
    }
});
