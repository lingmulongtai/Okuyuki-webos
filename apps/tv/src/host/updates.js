const releasesUrl = 'https://api.github.com/repos/lingmulongtai/Okuyuki-webos/releases?per_page=30';

function version (tag) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+)(?:-preview)?)?$/.exec(tag);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? Number(match[4]) : Infinity] : null;
}

function newer (a, b) {
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return a[i] > b[i];
	}
	return false;
}

export function isReleaseNewer (release, current) {
	const candidate = version(release);
	const installed = version(current);
	return Boolean(candidate && installed && newer(candidate, installed));
}

export function selectUpdate (releases, installed) {
	let best = version(installed);
	if (!best || !Array.isArray(releases)) return null;
	let selected = null;
	for (const release of releases) {
		const candidate = version(release.tag_name || '');
		if (release.draft || !candidate || !newer(candidate, best) || !Array.isArray(release.assets)) continue;
		const ipk = release.assets.find((asset) => asset.state === 'uploaded' && typeof asset.name === 'string' && asset.name.endsWith('.ipk'));
		if (!ipk) continue;
		best = candidate;
		selected = {version: release.tag_name.replace(/^v/, '')};
	}
	return selected;
}

export async function checkUpdates (installed, signal) {
	const response = await fetch(releasesUrl, {signal, headers: {Accept: 'application/vnd.github+json'}});
	if (!response.ok) throw new Error('Update check failed');
	return selectUpdate(await response.json(), installed);
}
