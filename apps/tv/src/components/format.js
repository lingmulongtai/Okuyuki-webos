// Display strings for the TV screens (Japanese, as the rest of the UI).

const pad = (value) => (value < 10 ? '0' : '') + value;
const WEEKDAYS = '日月火水木金土';
const DAY_MS = 24 * 60 * 60 * 1000;

const clock = (date) => date.getHours() + ':' + pad(date.getMinutes());
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Calendar days from `date` to `today`: 0 for today, 1 for yesterday. */
const daysBefore = (date, today) => Math.round((startOfDay(today) - startOfDay(date)) / DAY_MS);

/** For the grid: "今日 13:00", "昨日 7:04", "2月6日 19:02", or "2025年12月31日" in an earlier year. */
export function shortDate (takenAt, now = Date.now()) {
	if (!takenAt) return '';
	const date = new Date(takenAt);
	const today = new Date(now);
	const days = daysBefore(date, today);
	if (days === 0) return '今日 ' + clock(date);
	if (days === 1) return '昨日 ' + clock(date);
	const day = (date.getMonth() + 1) + '月' + date.getDate() + '日';
	return date.getFullYear() === today.getFullYear() ? day + ' ' + clock(date) : date.getFullYear() + '年' + day;
}

/** For the viewer: "今日 13:00", "2月7日（土）13:00", or "2025年12月31日（水）13:00" in an earlier year. */
export function longDate (takenAt, now = Date.now()) {
	if (!takenAt) return '';
	const date = new Date(takenAt);
	const today = new Date(now);
	const days = daysBefore(date, today);
	if (days === 0) return '今日 ' + clock(date);
	if (days === 1) return '昨日 ' + clock(date);
	const year = date.getFullYear() === today.getFullYear() ? '' : date.getFullYear() + '年';
	return year + (date.getMonth() + 1) + '月' + date.getDate() + '日（' + WEEKDAYS[date.getDay()] + '）' + clock(date);
}

export function formatDuration (ms) {
	if (typeof ms !== 'number' || ms < 0) return '';
	const total = Math.round(ms / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	return (hours ? hours + ':' + pad(minutes) : String(minutes)) + ':' + pad(seconds);
}

/**
 * `name` followed by the rest of a sentence, with a space after a name in Latin letters
 * ("SM-S938Q に…") and none after a Japanese one ("スマホに…"), as in the phone and Quest apps.
 */
export function named (name, rest) {
	const last = name ? name.charCodeAt(name.length - 1) : 0x3000;
	return last < 0x2e80 ? name + ' ' + rest : name + rest;
}

/**
 * Splits a sentence around the names quoted 「like this」 (buttons and settings on the phone),
 * which are the odd parts, so they can be kept on one line.
 */
export function splitTerms (text) {
	return String(text).split(/(「[^「」]*」)/);
}

/** "標準", "4K" or "4K HDR" for the quality badge in the photo viewer. */
export function qualityLabel (still) {
	if (!still) return '標準';
	const label = still.width >= 3840 || still.height >= 2160 ? '4K' : '高画質';
	return still.hdr && still.hdr !== 'none' ? label + ' HDR' : label;
}

/** What a thumbnail in the grid is marked with: a video's length, and 3D and HDR. */
export function tileBadges (item) {
	return {
		duration: item.kind === 'video' ? formatDuration(item.durationMs) : '',
		marks: [item.stereo ? '3D' : null, item.hdr && item.hdr !== 'none' ? 'HDR' : null].filter(Boolean)
	};
}
