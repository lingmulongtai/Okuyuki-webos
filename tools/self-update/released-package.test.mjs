import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createPublicKey} from 'node:crypto';
import {cp, mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {verifyBundle} from './bundle.mjs';

test('published 0.1.3 IPK applies the signed release without a PC', {timeout: 120000}, async () => {
    const installed = process.env.OKUYUKI_TV_COMPAT_APP;
    if (!installed) throw new Error('OKUYUKI_TV_COMPAT_APP must name the extracted 0.1.3 IPK');
    const bootstrap = await readFile(join(installed, 'bootstrap.js'), 'utf8');
    const config = /version:"([^"]+)",shell:"([0-9a-f]{64})",publicKey:"([^"]+)",updateUrl:"([^"]+)"/.exec(bootstrap);
    assert.ok(config, 'Cannot read the installed bootstrap configuration');
    assert.equal(config[1], '0.1.3');
    const publicKey = await readFile('tools/self-update/public-key.pem');
    assert.equal(createPublicKey(publicKey).export({type: 'spki', format: 'der'}).toString('base64'), config[3]);
    const envelope = await readFile('pages/runtime.json', 'utf8');
    const update = verifyBundle(envelope, publicKey);
    assert.equal(update.shell, config[2]);
    const packageInfo = JSON.parse(await readFile('apps/tv/webos-meta/appinfo.json', 'utf8'));
    assert.equal(update.version, packageInfo.version);
    assert.notEqual(update.version, config[1]);

    const root = await mkdtemp(join(tmpdir(), 'okuyuki-release-compat-'));
    const browser = await chromium.launch({headless: true, args: ['--allow-file-access-from-files']});
    try {
        await cp(installed, root, {recursive: true});
        const context = await browser.newContext({viewport: {width: 1920, height: 1080}});
        let online = true;
        await context.route(config[4], route => online ? route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, body: envelope}) : route.abort());
        await context.route('https://api.github.com/**', route => route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, json: []}));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(pathToFileURL(join(root, 'index.html')).href);
        await page.evaluate(() => localStorage.setItem('pairing-test', 'preserved'));
        await page.waitForFunction(version => window.okuyukiRuntimeUpdateReady === version, update.version);
        online = false;
        await page.reload();
        await page.waitForFunction(version => window.okuyukiRuntimeVersion === version, update.version);
        await page.waitForFunction(() => document.querySelector('[data-testid="runtime-status"]'));
        await page.waitForTimeout(2500);
        assert.equal(await page.evaluate(() => window.okuyukiRuntimeVersion), update.version);
        assert.equal(await page.evaluate(() => window.okuyukiUpdateConfig.version), '0.1.3');
        assert.equal(await page.evaluate(() => localStorage.getItem('pairing-test')), 'preserved');
        assert.deepEqual(errors, []);
        await context.close();
    } finally {
        await browser.close();
        const absolute = await realpath(root);
        if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.split(sep).at(-1).startsWith('okuyuki-release-compat-')) throw new Error('Unexpected temporary path');
        await rm(absolute, {recursive: true, force: true});
    }
});
