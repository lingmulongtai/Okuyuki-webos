// The mock phone's library: a synthetic one by default, or the photos and videos in a folder.
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { ffprobe } from './media.mjs';

export const PAGE_SIZE = 60;
export const TEST_VIDEO_SECONDS = 4;

const START = Date.UTC(2026, 0, 1, 1, 0, 0);
const PHOTO_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

/** Synthetic item number `n` (1 is the oldest). Every 7th is a video, every 11th photo is 3D. */
export function syntheticItem(n) {
	const video = n % 7 === 0;
	const stereo = !video && n % 11 === 0;
	return {
		id: String(1000000 + n),
		kind: video ? 'video' : 'photo',
		name: `OKY_${String(n).padStart(4, '0')}.${video ? 'mp4' : stereo ? 'heic' : 'jpg'}`,
		takenAt: START + n * 6 * 3600 * 1000 + (n % 5) * 60 * 1000,
		width: 3840,
		height: 2160,
		sizeBytes: video ? 48000000 + n * 1000 : 5200000 + n * 100,
		mime: video ? 'video/mp4' : stereo ? 'image/heic' : 'image/jpeg',
		durationMs: video ? TEST_VIDEO_SECONDS * 1000 : null,
		stereo,
		hdr: video ? (n % 2 ? 'hdr10' : 'none') : n % 3 === 0 ? 'ultrahdr' : 'none',
		number: n
	};
}

export function syntheticLibrary(count) {
	return Array.from({ length: count }, (_, i) => syntheticItem(i + 1));
}

function creationTime(probe) {
	const tags = (probe.format && probe.format.tags) || {};
	const value = Date.parse(tags.creation_time || '');
	return Number.isFinite(value) ? value : null;
}

/** The photos and videos directly inside `dir`, with their sizes read by ffprobe. */
export async function folderLibrary(dir) {
	const names = (await readdir(dir)).sort();
	const items = [];
	let number = 0;
	for (const name of names) {
		const ext = extname(name).toLowerCase();
		const mime = PHOTO_TYPES[ext] || VIDEO_TYPES[ext];
		if (!mime) continue;
		const path = join(dir, name);
		const info = await stat(path);
		if (!info.isFile()) continue;
		let probe;
		try {
			probe = await ffprobe(path);
		} catch {
			console.warn(`読み込めないので飛ばします: ${name}`);
			continue;
		}
		const stream = (probe.streams || []).find((candidate) => candidate.codec_type === 'video') || {};
		const video = Boolean(VIDEO_TYPES[ext]);
		number++;
		items.push({
			id: createHash('sha1').update(name).digest('hex').slice(0, 12),
			kind: video ? 'video' : 'photo',
			name,
			takenAt: creationTime(probe) ?? Math.round(info.mtimeMs),
			width: Number(stream.width) || 0,
			height: Number(stream.height) || 0,
			sizeBytes: info.size,
			mime,
			durationMs: video ? Math.round(Number(probe.format && probe.format.duration) * 1000) || null : null,
			stereo: false,
			hdr: stream.color_transfer === 'smpte2084' ? 'hdr10' : stream.color_transfer === 'arib-std-b67' ? 'hlg' : 'none',
			number,
			path,
			codec: stream.codec_name || null,
			profile: stream.profile || null
		});
	}
	return items;
}

/** Newest first; ties broken by id so paging is stable. */
export function sortItems(items) {
	return items.sort((a, b) => b.takenAt - a.takenAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

function matches(item, filter) {
	if (filter === 'photo') return item.kind === 'photo';
	if (filter === 'video') return item.kind === 'video';
	if (filter === 'stereo') return item.stereo;
	return true;
}

const encodeCursor = (item) => Buffer.from(`${item.takenAt}:${item.id}`).toString('base64url');

function decodeCursor(cursor) {
	const [takenAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split(':');
	return { takenAt: Number(takenAt), id };
}

/** One page of `items` (already sorted) for the TV, keyset-paged like the phone does it. */
export function page(items, filter, cursor) {
	let list = items.filter((item) => matches(item, filter));
	const total = list.length;
	if (cursor) {
		const after = decodeCursor(cursor);
		list = list.filter((item) => item.takenAt < after.takenAt || (item.takenAt === after.takenAt && item.id < after.id));
	}
	const slice = list.slice(0, PAGE_SIZE);
	return {
		items: slice.map(publicItem),
		next: list.length > PAGE_SIZE ? encodeCursor(slice[slice.length - 1]) : null,
		total
	};
}

/** The item as the protocol sends it, without the mock's own fields. */
export function publicItem(item) {
	const { id, kind, name, takenAt, width, height, sizeBytes, mime, durationMs, stereo, hdr } = item;
	return { id, kind, name, takenAt, width, height, sizeBytes, mime, durationMs, stereo, hdr };
}
