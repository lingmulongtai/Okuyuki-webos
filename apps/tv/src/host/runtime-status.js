import {isReleaseNewer} from './updates';

export function packageVersion (config, fallback) {
	return config && typeof config.version === 'string' ? config.version : fallback;
}

export function releaseNotice (release, runtime, runtimeVersion, pendingVersion) {
	if (pendingVersion || release.status !== 'available' || !isReleaseNewer(release.version, runtimeVersion) || runtime.status === 'checking' || runtime.status === 'ready' || runtime.status === 'stalled') return null;
	const prefix = 'Okuyuki TV ' + release.version + ' が公開されました。';
	if (runtime.status === 'incompatible') return prefix + 'この更新には PC からの IPK 再導入が必要です。';
	if (runtime.status === 'unavailable') return prefix + 'テレビ単体の更新を利用できないため、PC から IPK を導入できます。';
	if (runtime.status === 'error') return prefix + '更新を確認できませんでした。後で自動的に再確認します。';
	return prefix + 'テレビ単体の更新を後でもう一度確認してください。';
}

export function runtimeMessage (update, pendingVersion) {
	if (pendingVersion && update.status !== 'ready') {
		const saved = '画面更新 ' + pendingVersion + ' を保存しました。次回起動時に適用します。';
		if (update.status === 'checking') return saved + ' 新しい更新を確認中です。';
		if (update.status === 'error') return saved + ' 最新の更新は確認できませんでした。後で自動的に再確認します。';
		if (update.status === 'stalled' || update.status === 'unavailable') return saved + ' 新しい更新の確認にはアプリを再起動してください。';
		if (update.status === 'incompatible') return saved + ' さらに新しい更新には IPK 再導入が必要です。';
		return saved;
	}
	switch (update.status) {
		case 'checking': return 'テレビ単体の更新を確認中…';
		case 'ready': return '画面更新 ' + update.version + ' を保存しました。次回起動時に適用します。';
		case 'current': return '互換性のある画面更新は適用済みです。';
		case 'incompatible': return '新しい更新には PC からの IPK 再導入が必要です。';
		case 'unavailable': return 'テレビ単体の更新機能を利用できません。再起動しても解消しない場合は IPK の再導入をお試しください。';
		case 'stalled': return '更新確認に時間がかかっています。アプリを再起動して再確認できます。';
		default: return 'テレビ単体の更新を確認できませんでした。後で自動的に再確認します。';
	}
}
