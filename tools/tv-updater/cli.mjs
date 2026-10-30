import {setTimeout as delay} from 'node:timers/promises';
import {updateOnce} from './updater.mjs';

const args = process.argv.slice(2);
const deviceAt = args.indexOf('--device');
const device = deviceAt >= 0 ? args[deviceAt + 1] : '';
if (!/^[A-Za-z0-9_.-]{1,80}$/.test(device || '')) {
    console.error('使い方: npm run tv:auto-update -- --device TV名 [--once]');
    process.exitCode = 1;
} else {
    do {
        try {
            const installed = await updateOnce(device);
            console.log(installed ? `${installed} を TV にインストールしました。` : 'TV は最新です。');
        } catch (error) {
            console.error(`更新できませんでした: ${error.message}`);
            if (args.includes('--once')) process.exitCode = 1;
        }
        if (!args.includes('--once')) await delay(60 * 60 * 1000);
    } while (!args.includes('--once'));
}
