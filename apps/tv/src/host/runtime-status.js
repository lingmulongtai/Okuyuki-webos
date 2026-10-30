import {isReleaseNewer} from './updates';

export function packageVersion (config, fallback) {
	return config && typeof config.version === 'string' ? config.version : fallback;
}

export function releaseNotice (release, runtime, runtimeVersion, pendingVersion) {
	if (pendingVersion || release.status !== 'available' || !isReleaseNewer(release.version, runtimeVersion) || runtime.status === 'checking' || runtime.status === 'ready') return null;
	const prefix = 'Okuyuki TV ' + release.version + ' が公開されました。';
	if (runtime.status === 'incompatible') return prefix + 'この更新には PC からの IPK 再導入が必要です。';
	if (runtime.status === 'unavailable') return prefix + 'テレビ単体の更新を利用できないため、PC から IPK を導入できます。';
	if (runtime.status === 'error') return prefix + 'テレビのインターネット接続を確認して、更新を再確認してください。';
	return prefix + 'テレビ単体の更新を後でもう一度確認してください。';
}

export function runtimeMessage (update) {
	switch (update.status) {
		case 'checking': return 'テレビ単体の更新を確認中…';
		case 'ready': return '画面更新 ' + update.version + ' を保存しました。次回起動時に適用します。';
		case 'current': return '互換性のある画面更新は適用済みです。';
		case 'incompatible': return '新しい更新には PC からの IPK 再導入が必要です。';
		case 'unavailable': return 'テレビ単体の更新機能を利用できません。';
		default: return 'テレビ単体の更新を確認できませんでした。';
	}
}

