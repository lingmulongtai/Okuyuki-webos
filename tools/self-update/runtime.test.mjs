import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp, readFile, rm, rmdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {createBundle} from './bundle.mjs';

test('file-origin runtime verifies, stages, restarts offline and rejects tampering', {timeout: 90000}, async () => {
    const root = await mkdtemp(join(tmpdir(), 'okuyuki-runtime-test-'));
    const files = ['index.html', 'bootstrap.js', 'main.js', 'main.css'];
    const keys = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const shell = 'a'.repeat(64);
    const config = {version: '0.1.2', shell, publicKey: keys.publicKey.export({format: 'der', type: 'spki'}).toString('base64'), updateUrl: 'https://updates.example/runtime.json'};
    const runtime = await readFile('apps/tv/bootstrap/runtime.js', 'utf8');
    await writeFile(join(root, 'index.html'), '<html><head></head><body><div id="root"></div><script src="bootstrap.js"></script></body></html>');
    await writeFile(join(root, 'bootstrap.js'), `window.okuyukiUpdateConfig=${JSON.stringify(config)};\n${runtime}`);
    await writeFile(join(root, 'main.js'), 'document.getElementById("root").textContent="PACKAGED";');
    await writeFile(join(root, 'main.css'), 'body{color:blue}');
    let response = createBundle({version: '0.1.3', shell, javascript: 'document.getElementById("root").textContent="UPDATED";window.dispatchEvent(new Event("okuyuki-runtime-started"));', css: 'body{color:red}'}, keys.privateKey);
    const browser = await chromium.launch({headless: true});
    try {
        const context = await browser.newContext();
        await context.route(config.updateUrl, async route => response === null ? route.abort() : route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, body: response}));
        const page = await context.newPage();
        await page.goto(pathToFileURL(join(root, 'index.html')).href);
        await page.waitForFunction(() => document.getElementById('root').textContent === 'PACKAGED');
        await page.evaluate(() => localStorage.setItem('pairing-test', 'preserved'));
        await page.waitForFunction(() => new Promise(resolve => {
            const request = indexedDB.open('okuyuki-tv-runtime', 1);
            request.onsuccess = () => { const get = request.result.transaction('state').objectStore('state').get('candidate'); get.onsuccess = () => resolve(!!get.result); };
        }));
        assert.deepEqual(await page.evaluate(() => window.okuyukiCheckRuntimeUpdate()), {status: 'ready', version: '0.1.3'});
        response = null;
        await page.reload();
        await page.waitForFunction(() => document.getElementById('root').textContent === 'UPDATED');
        assert.equal(await page.evaluate(() => location.protocol), 'file:');
        assert.equal(await page.evaluate(() => localStorage.getItem('pairing-test')), 'preserved');
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).color), 'rgb(255, 0, 0)');
        assert.deepEqual(await page.evaluate(() => window.okuyukiCheckRuntimeUpdate()), {status: 'error'});

        response = createBundle({version: '0.1.4', shell: 'b'.repeat(64), javascript: 'void 0;', css: 'body{}'}, keys.privateKey);
        assert.deepEqual(await page.evaluate(() => window.okuyukiCheckRuntimeUpdate()), {status: 'incompatible'});

        const attacker = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
        response = createBundle({version: '0.1.4', shell, javascript: 'document.getElementById("root").textContent="ATTACK";', css: 'body{color:green}'}, attacker.privateKey);
        await page.reload();
        await page.waitForFunction(() => document.getElementById('root').textContent === 'UPDATED');
        await page.waitForTimeout(500);
        response = null;
        await page.reload();
        await page.waitForFunction(() => document.getElementById('root').textContent === 'UPDATED');
        await context.close();

        // A validly signed update which fails to mount is discarded and the packaged app starts.
        response = createBundle({version: '0.1.4', shell, javascript: 'document.getElementById("root").textContent="PARTIAL";window.dispatchEvent(new Event("okuyuki-runtime-started"));throw new Error("broken update");', css: 'body{color:red}'}, keys.privateKey);
        const recovery = await browser.newContext();
        await recovery.route(config.updateUrl, route => route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, body: response}));
        const failing = await recovery.newPage();
        await failing.goto(pathToFileURL(join(root, 'index.html')).href);
        await failing.waitForFunction(() => document.getElementById('root').textContent === 'PACKAGED');
        await failing.waitForFunction(() => new Promise(resolve => {
            const request = indexedDB.open('okuyuki-tv-runtime', 1);
            request.onsuccess = () => { const get = request.result.transaction('state').objectStore('state').get('candidate'); get.onsuccess = () => resolve(!!get.result); };
        }));
        await failing.reload();
        await failing.waitForFunction(() => document.getElementById('root').textContent === 'PACKAGED', null, {timeout: 25000});
        const remaining = await failing.evaluate(() => new Promise(resolve => {
            const request = indexedDB.open('okuyuki-tv-runtime', 1);
            request.onsuccess = () => { const get = request.result.transaction('state').objectStore('state').get('candidate'); get.onsuccess = () => resolve(get.result || null); };
        }));
        assert.equal(remaining, null);
        await recovery.close();

        // A blocked IndexedDB deletion cannot send the TV into a reload loop.
        const blocked = await browser.newContext();
        await blocked.route(config.updateUrl, route => route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, body: response}));
        const protectedPage = await blocked.newPage();
        await protectedPage.goto(pathToFileURL(join(root, 'index.html')).href);
        await protectedPage.waitForFunction(() => new Promise(resolve => {
            const request = indexedDB.open('okuyuki-tv-runtime', 1);
            request.onsuccess = () => { const get = request.result.transaction('state').objectStore('state').get('candidate'); get.onsuccess = () => resolve(!!get.result); };
        }));
        await protectedPage.addInitScript(() => { IDBObjectStore.prototype.delete = () => { throw new Error('blocked deletion'); }; });
        await protectedPage.reload();
        await protectedPage.waitForFunction(() => document.getElementById('root').textContent === 'PACKAGED', null, {timeout: 25000});
        assert.equal(await protectedPage.evaluate(() => sessionStorage.getItem('okuyuki-runtime-recovery')), '1');
        await protectedPage.reload();
        await protectedPage.waitForFunction(() => document.getElementById('root').textContent === 'PACKAGED');
        assert.deepEqual(await protectedPage.evaluate(() => window.okuyukiCheckRuntimeUpdate()), {status: 'error'});
        response = createBundle({version: '0.1.5', shell, javascript: 'document.getElementById("root").textContent="RECOVERED";window.dispatchEvent(new Event("okuyuki-runtime-started"));', css: 'body{color:green}'}, keys.privateKey);
        assert.deepEqual(await protectedPage.evaluate(() => window.okuyukiCheckRuntimeUpdate()), {status: 'ready', version: '0.1.5'});
        assert.equal(await protectedPage.evaluate(() => sessionStorage.getItem('okuyuki-runtime-recovery')), null);
        await protectedPage.reload();
        await protectedPage.waitForFunction(() => document.getElementById('root').textContent === 'RECOVERED', null, {timeout: 25000});
        await blocked.close();

        // Concurrent checks cannot replace a newer staged update with an older signed one.
        const concurrent = await browser.newContext();
        const old = createBundle({version: '0.1.3', shell, javascript: 'void 0;', css: 'body{}'}, keys.privateKey);
        const recent = createBundle({version: '0.1.4', shell, javascript: 'void 0;', css: 'body{}'}, keys.privateKey);
        let calls = 0;
        await concurrent.route(config.updateUrl, async route => {
            const first = ++calls === 1;
            if (first) await new Promise(resolve => setTimeout(resolve, 700));
            await route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, body: first ? old : recent});
        });
        const firstPage = await concurrent.newPage();
        const secondPage = await concurrent.newPage();
        await Promise.all([firstPage.goto(pathToFileURL(join(root, 'index.html')).href), secondPage.goto(pathToFileURL(join(root, 'index.html')).href)]);
        await firstPage.waitForFunction(() => new Promise(resolve => {
            const request = indexedDB.open('okuyuki-tv-runtime', 1);
            request.onsuccess = () => { const get = request.result.transaction('state').objectStore('state').get('highWater'); get.onsuccess = () => resolve(get.result === '0.1.4'); };
        }));
        await firstPage.waitForTimeout(1200);
        const highWater = await firstPage.evaluate(() => new Promise(resolve => {
            const request = indexedDB.open('okuyuki-tv-runtime', 1);
            request.onsuccess = () => { const get = request.result.transaction('state').objectStore('state').get('highWater'); get.onsuccess = () => resolve(get.result); };
        }));
        assert.equal(highWater, '0.1.4');
        await concurrent.close();

        // An update checking during its own startup is already running, not waiting for another restart.
        const startup = await browser.newContext();
        const startupUpdate = createBundle({version: '0.1.3', shell, javascript: 'document.getElementById("root").textContent="STARTING";window.okuyukiCheckRuntimeUpdate().then(r=>window.startupCheck=r.status);window.dispatchEvent(new Event("okuyuki-runtime-started"));', css: 'body{}'}, keys.privateKey);
        await startup.route(config.updateUrl, route => route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, body: startupUpdate}));
        const startupPage = await startup.newPage();
        await startupPage.goto(pathToFileURL(join(root, 'index.html')).href);
        await startupPage.waitForFunction(() => window.okuyukiRuntimeUpdateReady === '0.1.3');
        await startupPage.reload();
        await startupPage.waitForFunction(() => window.startupCheck === 'current');
        await startup.close();
    } finally {
        await browser.close();
        for (const name of files) await rm(join(root, name), {force: true});
        await rmdir(root);
    }
});
