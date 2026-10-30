import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp, rm, rmdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run = promisify(execFile);
const appId = 'com.okuyuki.tv';
const releaseApi = 'https://api.github.com/repos/lingmulongtai/Okuyuki-webos/releases?per_page=30';
const maximumBytes = 64 * 1024 * 1024;
const cli = new URL('../../node_modules/@webos-tools/cli/bin/ares-install.js', import.meta.url);

function version(text) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-alpha\.\d+(?:-preview)?)?$/.exec(text || '');
    return match ? match.slice(1).map(Number) : null;
}

function newer(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

export function installedVersion(output) {
    const blocks = output.split(/^id\s*:\s*/m).slice(1);
    const match = blocks.find(block => block.split(/\r?\n/, 1)[0].trim() === appId);
    const found = match && /^version\s*:\s*(\d+\.\d+\.\d+)\s*$/m.exec(match);
    if (!found || !version(found[1])) throw new Error('TV の Okuyuki のバージョンを確認できません。');
    return found[1];
}

export function selectRelease(releases, installed) {
    const current = version(installed);
    if (!current || !Array.isArray(releases)) throw new Error('更新情報が正しくありません。');
    let best = current;
    let selected = null;
    for (const release of releases) {
        const candidate = version(release.tag_name);
        if (release.draft || !candidate || !newer(candidate, best) || !Array.isArray(release.assets)) continue;
        const name = `${appId}_${candidate.join('.')}_all.ipk`;
        const expected = `https://github.com/lingmulongtai/Okuyuki-webos/releases/download/${release.tag_name}/${name}`;
        const asset = release.assets.find(item => item.state === 'uploaded' && item.name === name &&
            item.browser_download_url === expected && /^sha256:[0-9a-f]{64}$/i.test(item.digest || '') &&
            Number.isSafeInteger(item.size) && item.size > 0 && item.size <= maximumBytes);
        if (!asset) continue;
        best = candidate;
        selected = {name, url: expected, digest: asset.digest.slice(7).toLowerCase(), size: asset.size, tag: release.tag_name};
    }
    return selected;
}

export async function updateOnce(device, {fetcher = fetch, execute = run} = {}) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(device || '')) throw new Error('TV のデバイス名を指定してください。');
    const command = [process.execPath, fileURLToPath(cli)];
    const exec = args => execute(command[0], [command[1], '--device', device, ...args], {timeout: 120000, maxBuffer: 4 * 1024 * 1024});
    const installed = installedVersion((await exec(['--listfull'])).stdout);
    const response = await fetcher(releaseApi, {headers: {'Accept': 'application/vnd.github+json'}, signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`更新確認に失敗しました (HTTP ${response.status})。`);
    const selected = selectRelease(await response.json(), installed);
    if (!selected) return null;
    const download = await fetcher(selected.url, {signal: AbortSignal.timeout(120000)});
    if (!download.ok) throw new Error('IPK のダウンロードに失敗しました。');
    const declared = Number(download.headers.get('content-length'));
    if (declared && declared !== selected.size) throw new Error('IPK のサイズが一致しません。');
    const chunks = [];
    let size = 0;
    for await (const chunk of download.body) {
        size += chunk.length;
        if (size > selected.size || size > maximumBytes) throw new Error('IPK のサイズが上限を超えました。');
        chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (size !== selected.size || createHash('sha256').update(bytes).digest('hex') !== selected.digest) throw new Error('IPK の検証に失敗しました。');
    const temporary = await mkdtemp(join(tmpdir(), 'okuyuki-tv-update-'));
    const path = join(temporary, selected.name);
    try {
        await writeFile(path, bytes, {flag: 'wx'});
        await exec([path]);
        return selected.tag;
    } finally { await rm(path, {force: true}); await rmdir(temporary); }
}
