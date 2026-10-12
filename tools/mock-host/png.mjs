// Test pictures for the mock host, drawn and PNG-encoded in plain JavaScript so the synthetic
// library needs nothing installed. Each item gets its own colours and its number in large digits,
// which makes it easy to see on the TV (or in a screenshot) which photo is on screen.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Int32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c;
});

function crc32(buffer) {
	let crc = -1;
	for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** Encodes 8-bit RGB pixels (`width * height * 3` bytes) as a PNG file. */
export function encodePng(width, height, rgb) {
	const stride = width * 3;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: width * height > 4000000 ? 1 : 6 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

// 5x7 digits, one string per row.
const DIGITS = {
	0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
	1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
	2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
	3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
	4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
	5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
	6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
	7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
	8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
	9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};

function hsl(h, s, l) {
	const a = s * Math.min(l, 1 - l);
	const f = (n) => {
		const k = (n + h / 30) % 12;
		return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
	};
	return [f(0), f(8), f(4)];
}

/**
 * Draws the picture for item number `seed`: a diagonal gradient in the item's own hues, a thin
 * frame and the number in the middle. Video posters get a play triangle as well. The patch at
 * the bottom left is a one-pixel checkerboard when `fine` (the 4K still) and plain grey
 * otherwise, so on the TV the switch to the 4K still is visible up close.
 */
export function drawItem(width, height, seed, { video = false, fine = false } = {}) {
	const rgb = Buffer.alloc(width * height * 3);
	const hue = (seed * 47) % 360;
	const from = hsl(hue, 0.55, 0.3);
	const to = hsl((hue + 60) % 360, 0.6, 0.55);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const t = (x / width + y / height) / 2;
			const i = (y * width + x) * 3;
			rgb[i] = from[0] + (to[0] - from[0]) * t;
			rgb[i + 1] = from[1] + (to[1] - from[1]) * t;
			rgb[i + 2] = from[2] + (to[2] - from[2]) * t;
		}
	}
	const fill = (x0, y0, w, h, colour) => {
		for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) {
			for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x++) {
				const i = (y * width + x) * 3;
				rgb[i] = colour[0];
				rgb[i + 1] = colour[1];
				rgb[i + 2] = colour[2];
			}
		}
	};
	const white = [255, 255, 255];
	const edge = Math.max(2, Math.round(width / 240));
	fill(0, 0, width, edge, white);
	fill(0, height - edge, width, edge, white);
	fill(0, 0, edge, height, white);
	fill(width - edge, 0, edge, height, white);

	const text = String(seed);
	const cell = Math.max(2, Math.floor(Math.min(width / (text.length * 6 + 1), height / 2 / 7)));
	const left = Math.round((width - (text.length * 6 - 1) * cell) / 2);
	const top = Math.round((height - 7 * cell) / 2);
	[...text].forEach((digit, n) => {
		DIGITS[digit].forEach((row, y) => {
			[...row].forEach((bit, x) => {
				if (bit === '1') fill(left + (n * 6 + x) * cell, top + y * cell, cell, cell, white);
			});
		});
	});

	const patch = { x: Math.round(width * 0.04), y: Math.round(height * 0.7), w: Math.round(width * 0.16), h: Math.round(height * 0.2) };
	for (let y = patch.y; y < patch.y + patch.h; y++) {
		for (let x = patch.x; x < patch.x + patch.w; x++) {
			const value = fine ? ((x + y) % 2) * 255 : 128;
			const i = (y * width + x) * 3;
			rgb[i] = value;
			rgb[i + 1] = value;
			rgb[i + 2] = value;
		}
	}

	if (video) {
		const size = Math.round(height / 6);
		const x0 = Math.round(width - size * 1.6);
		const y0 = Math.round(height - size * 1.6);
		for (let y = 0; y < size; y++) {
			const span = Math.round(size * (1 - Math.abs(y - size / 2) / (size / 2)) * 0.9);
			fill(x0, y0 + y, span, 1, white);
		}
	}
	return encodePng(width, height, rgb);
}
