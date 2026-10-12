// Display strings for the TV screens (Japanese, as the rest of the UI).

const pad = (value) => (value < 10 ? '0' : '') + value;

export function formatDate (takenAt) {
	if (!takenAt) return '';
	const date = new Date(takenAt);
	return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 ' +
		date.getHours() + ':' + pad(date.getMinutes());
}

export function formatDuration (ms) {
	if (typeof ms !== 'number' || ms < 0) return '';
	const total = Math.round(ms / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	return (hours ? hours + ':' + pad(minutes) : String(minutes)) + ':' + pad(seconds);
}

/** "標準", "4K" or "4K HDR" for the quality badge in the photo viewer. */
export function qualityLabel (still) {
	if (!still) return '標準';
	const label = still.width >= 3840 || still.height >= 2160 ? '4K' : '高画質';
	return still.hdr && still.hdr !== 'none' ? label + ' HDR' : label;
}

export function itemBadges (item) {
	const badges = [];
	if (item.kind === 'video') badges.push(formatDuration(item.durationMs));
	if (item.stereo) badges.push('3D');
	if (item.hdr !== 'none') badges.push('HDR');
	return badges.filter(Boolean).join('  ');
}
