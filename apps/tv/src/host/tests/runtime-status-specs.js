import {packageVersion, releaseNotice, runtimeMessage} from '../runtime-status';

test('identifies the installed IPK separately from the updated runtime', () => {
	expect(packageVersion({version: '0.1.3'}, '0.1.4')).toBe('0.1.3');
	expect(packageVersion(null, '0.1.4')).toBe('0.1.4');
});

test('only recommends reinstall when the TV updater reports incompatibility', () => {
	const release = {status: 'available', version: '0.1.5-alpha.1-preview'};
	expect(releaseNotice(release, {status: 'checking'}, '0.1.4', null)).toBeNull();
	expect(releaseNotice(release, {status: 'current'}, '0.1.4', null)).not.toContain('PC');
	expect(releaseNotice(release, {status: 'error'}, '0.1.4', null)).toContain('接続');
	expect(releaseNotice(release, {status: 'incompatible'}, '0.1.4', null)).toContain('IPK 再導入');
	expect(releaseNotice(release, {status: 'current'}, '0.1.4', '0.1.5')).toBeNull();
	expect(releaseNotice(release, {status: 'current'}, '0.1.5', null)).toBeNull();
});

test('explains when an update needs a new IPK', () => {
	expect(runtimeMessage({status: 'incompatible'})).toContain('IPK');
	expect(runtimeMessage({status: 'ready', version: '0.1.4'})).toContain('0.1.4');
});

test('keeps a saved update visible when a later check fails', () => {
	const failed = runtimeMessage({status: 'error'}, '0.1.5');
	expect(failed).toContain('0.1.5 を保存');
	expect(failed).toContain('確認できません');
	expect(runtimeMessage({status: 'checking'}, '0.1.5')).toContain('確認中');
	expect(runtimeMessage({status: 'incompatible'}, '0.1.5')).toContain('IPK 再導入');
});
