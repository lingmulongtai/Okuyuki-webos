// ffmpeg work for the mock host: 4K stills in the best format the TV can play, short test videos,
// and the thumbnail and screen-size images of real photos given with --photos.
import { execFile } from 'node:child_process';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

// In order of preference, like the phone: the first one the TV reports wins.
export const FORMATS = [
	{
		name: 'hevc-main10',
		ext: 'mp4',
		mime: 'video/mp4',
		codecs: 'hvc1.2.4.L153.B0',
		pixels: 'yuv420p10le',
		args: ['-c:v', 'libx265', '-preset', 'fast', '-x265-params', 'crf=14:log-level=error', '-profile:v', 'main10', '-tag:v', 'hvc1']
	},
	{
		name: 'hevc-main',
		ext: 'mp4',
		mime: 'video/mp4',
		codecs: 'hvc1.1.6.L153.B0',
		pixels: 'yuv420p',
		args: ['-c:v', 'libx265', '-preset', 'fast', '-x265-params', 'crf=14:log-level=error', '-profile:v', 'main', '-tag:v', 'hvc1']
	},
	{
		name: 'av1-main10',
		ext: 'mp4',
		mime: 'video/mp4',
		codecs: 'av01.0.13M.10',
		pixels: 'yuv420p10le',
		args: ['-c:v', 'libsvtav1', '-preset', '10', '-crf', '20', '-svtav1-params', 'tune=0']
	},
	{
		name: 'vp9-profile2',
		ext: 'webm',
		mime: 'video/webm',
		codecs: 'vp09.02.51.10',
		pixels: 'yuv420p10le',
		args: ['-c:v', 'libvpx-vp9', '-profile:v', '2', '-crf', '18', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1']
	},
	{
		name: 'vp9',
		ext: 'webm',
		mime: 'video/webm',
		codecs: 'vp09.00.51.08',
		pixels: 'yuv420p',
		args: ['-c:v', 'libvpx-vp9', '-crf', '18', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1']
	},
	{
		name: 'h264-high',
		ext: 'mp4',
		mime: 'video/mp4',
		codecs: 'avc1.640033',
		pixels: 'yuv420p',
		args: ['-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-profile:v', 'high', '-level', '5.1']
	}
];

const SDR = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];

/** The still and video format for a TV, from the `video` list of its capabilities. */
export function pickFormat(capabilities) {
	const supported = capabilities && Array.isArray(capabilities.video) ? capabilities.video : ['hevc-main10'];
	return FORMATS.find((format) => supported.includes(format.name)) ?? null;
}

/** The size of the TV's video plane, which every still matches exactly. */
export function stillSize(capabilities) {
	const screen = (capabilities && capabilities.screen) || {};
	const width = Number(screen.videoWidth) || 3840;
	const height = Number(screen.videoHeight) || 2160;
	return { width: Math.min(width, 3840) & ~1, height: Math.min(height, 2160) & ~1 };
}

export function ffmpeg(args) {
	return new Promise((resolve, reject) => {
		execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
			if (error) reject(new Error(String(stderr || error.message).trim()));
			else resolve();
		});
	});
}

export function ffprobe(path) {
	return new Promise((resolve, reject) => {
		execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { maxBuffer: 1 << 22 }, (error, stdout) => {
			if (error) reject(error);
			else resolve(JSON.parse(stdout));
		});
	});
}

export async function exists(path) {
	try {
		return (await stat(path)).size > 0;
	} catch {
		return false;
	}
}

// Writes to a temporary name first, so a half-written file is never served.
async function produce(out, args) {
	await mkdir(dirname(out), { recursive: true });
	const partial = out.replace(/(\.\w+)$/, '.partial$1');
	await ffmpeg([...args, partial]);
	await rename(partial, out);
	return out;
}

function fit(width, height, pixels) {
	return `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,` +
		`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
		`scale=out_color_matrix=bt709:out_range=tv,format=${pixels}`;
}

/** A still: two identical frames at 1 fps of the image, fitted into the video plane. */
export function makeStill(image, out, format, size) {
	return produce(out, [
		'-loop', '1', '-framerate', '1', '-i', image,
		'-frames:v', '2', '-an', '-vf', fit(size.width, size.height, format.pixels),
		...format.args, ...SDR,
		...(format.ext === 'mp4' ? ['-movflags', '+faststart'] : [])
	]);
}

/** A short test video for the synthetic library: a moving test pattern with a tone. */
export function makeTestVideo(out, format, seconds) {
	return produce(out, [
		'-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
		'-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
		'-vf', `scale=out_color_matrix=bt709:out_range=tv,format=${format.pixels}`,
		...format.args, ...SDR,
		...(format.ext === 'mp4' ? ['-c:a', 'aac', '-movflags', '+faststart'] : ['-c:a', 'libopus']),
		'-shortest'
	]);
}

/** A JPEG of a real photo (or a video's first frame), fitted into `width`x`height` without padding. */
export function makeJpeg(source, out, width, height) {
	return produce(out, [
		'-i', source, '-frames:v', '1',
		'-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
		'-q:v', '3'
	]);
}
