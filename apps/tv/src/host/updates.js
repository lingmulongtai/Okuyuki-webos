const releasesUrl = 'https://api.github.com/repos/lingmulongtai/Okuyuki-webos/releases?per_page=30';
const retryKey = 'okuyuki-release-rate-limit-until';
const retryCountKey = 'okuyuki-release-rate-limit-count';
let retryUntil = 0;
let rateLimitFailures = 0;

function savedRetryUntil () {
	try {
		const value = Number(window.localStorage.getItem(retryKey));
		return Number.isFinite(value) ? Math.max(value, retryUntil) : retryUntil;
	} catch (error) {
		return retryUntil;
	}
}

function rememberedFailures () {
	try {
		const count = Number(window.localStorage.getItem(retryCountKey));
		return Math.min(6, Math.max(rateLimitFailures, Number.isFinite(count) ? count : 0));
	} catch (error) {
		return rateLimitFailures;
	}
}

function rememberRetryUntil (value) {
	retryUntil = value;
	if (!value) rateLimitFailures = 0;
	try {
		if (value) {
			window.localStorage.setItem(retryKey, String(value));
			window.localStorage.setItem(retryCountKey, String(rateLimitFailures));
		} else {
			window.localStorage.removeItem(retryKey);
			window.localStorage.removeItem(retryCountKey);
		}
	} catch (error) {
		// The in-memory limit still prevents repeated requests in this session.
	}
}

function rateLimitError (until) {
	const error = new Error('Release checks are rate limited');
	error.retryAt = until;
	return error;
}

export function rateLimitUntil (response, now) {
	const headers = response.headers;
	const retryAfter = headers && headers.get('retry-after');
	const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 0;
	const remaining = headers && headers.get('x-ratelimit-remaining');
	const reset = headers && headers.get('x-ratelimit-reset');
	const resetTime = remaining === '0' && reset && /^\d+$/.test(reset) ? Number(reset) * 1000 : 0;
	const until = Math.max(seconds ? now + seconds * 1000 : 0, resetTime || 0);
	// When CORS or a proxy hides the headers, use a conservative one-hour pause.
	return Number.isFinite(until) && until > now ? until : now + 60 * 60 * 1000;
}

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
	const until = savedRetryUntil();
	if (until > Date.now()) throw rateLimitError(until);
	const response = await fetch(releasesUrl, {signal, headers: {Accept: 'application/vnd.github+json'}});
	if (response.status === 403 || response.status === 429) {
		const now = Date.now();
		const failures = rememberedFailures();
		const backoff = Math.min(60000 * (2 ** failures), 60 * 60 * 1000);
		const retryAt = Math.max(rateLimitUntil(response, now), now + backoff);
		rateLimitFailures = Math.min(failures + 1, 6);
		rememberRetryUntil(retryAt);
		throw rateLimitError(retryAt);
	}
	if (!response.ok) throw new Error('Update check failed');
	rememberRetryUntil(0);
	return selectUpdate(await response.json(), installed);
}
