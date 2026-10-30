// Test pictures for the mock host, drawn and PNG-encoded in plain JavaScript so the synthetic
// library needs nothing installed. Each item gets its own landscape and its number.
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

// Sky (top and bottom), far hill, near hill and sun for each picture, after the Quest app's
// screenshot pictures.
const PALETTES = [
	[[0x1e, 0x3c, 0x72], [0x6a, 0x85, 0xb6], [0x20, 0x3a, 0x43], [0x0f, 0x20, 0x27], [0xff, 0xe6, 0xa7]],
	[[0xff, 0x9a, 0x8b], [0xff, 0xc3, 0xa0], [0x5f, 0x2c, 0x82], [0x2c, 0x1b, 0x47], [0xff, 0xf4, 0xd6]],
	[[0x89, 0xc4, 0xf4], [0xd6, 0xec, 0xfa], [0x3e, 0x8e, 0x41], [0x1f, 0x5e, 0x2a], [0xff, 0xff, 0xff]],
	[[0xf6, 0xd3, 0x65], [0xfd, 0xa0, 0x85], [0x8e, 0x5b, 0x3e], [0x4a, 0x2e, 0x21], [0xff, 0xfb, 0xea]],
	[[0x7f, 0x7f, 0xd5], [0x91, 0xea, 0xe4], [0x3a, 0x60, 0x73], [0x16, 0x22, 0x2a], [0xff, 0xff, 0xff]],
	[[0x2c, 0x3e, 0x50], [0xfd, 0x74, 0x6c], [0x4b, 0x3a, 0x55], [0x1c, 0x14, 0x24], [0xff, 0xd1, 0xa6]]
];

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** The top edge of a hill in each column, as a fraction of the height. */
function ridge(width, base, seed, swing) {
	const phase = (seed % 13) / 13 * Math.PI * 2;
	return Float64Array.from({ length: width }, (_, x) => {
		const t = x / width;
		return base - swing * (Math.sin(t * Math.PI * 1.3 + phase) * 0.6 + Math.sin(t * Math.PI * 3.1 + phase * 2) * 0.25);
	});
}

// Change when the pictures change: the mock host keys its cache of prepared stills on it.
export const DRAWING_VERSION = 2;

/**
 * Draws the picture for item number `seed`: a landscape in the item's own colours (sky, sun and
 * two hills) with the number on a plate at the bottom right, which makes it easy to see on the TV
 * (or in a screenshot) which photo is on screen. The plate is a one-pixel checkerboard when `fine`
 * (the 4K still) and plain grey otherwise, so on the TV the switch to the 4K still is visible up
 * close. The plate stays clear of the sides the TV crops from a thumbnail and of its badges.
 */
export function drawItem(width, height, seed, { fine = false } = {}) {
	const rgb = Buffer.alloc(width * height * 3);
	const [skyTop, skyBottom, far, near, sunColour] = PALETTES[seed % PALETTES.length];
	const farRidge = ridge(width, 0.66, seed, 0.1);
	const nearRidge = ridge(width, 0.8, seed + 5, 0.07);
	const sun = { x: width * (0.25 + (seed % 3) * 0.25), y: height * 0.3, r: height * 0.08 };
	for (let y = 0; y < height; y++) {
		const sky = mix(skyTop, skyBottom, y / height);
		for (let x = 0; x < width; x++) {
			// Edges are blended over a pixel, so thumbnails stay smooth.
			let colour = mix(sky, sunColour, clamp01(sun.r - Math.hypot(x - sun.x, y - sun.y) + 0.5));
			colour = mix(colour, far, clamp01(y - farRidge[x] * height + 0.5));
			colour = mix(colour, near, clamp01(y - nearRidge[x] * height + 0.5));
			const i = (y * width + x) * 3;
			rgb[i] = colour[0];
			rgb[i + 1] = colour[1];
			rgb[i + 2] = colour[2];
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

	// The plate, then the number on it, white with a dark shadow.
	const text = String(seed);
	const cell = Math.max(3, Math.round(height / 120));
	const plate = { w: (text.length * 6 + 5) * cell, h: 13 * cell };
	plate.x = Math.round(width * 0.86) - plate.w;
	plate.y = Math.round(height * 0.92) - plate.h;
	for (let y = plate.y; y < plate.y + plate.h; y++) {
		for (let x = plate.x; x < plate.x + plate.w; x++) {
			const value = fine ? ((x + y) % 2) * 255 : 128;
			const i = (y * width + x) * 3;
			rgb[i] = value;
			rgb[i + 1] = value;
			rgb[i + 2] = value;
		}
	}
	const left = plate.x + 3 * cell;
	const top = plate.y + 3 * cell;
	for (const [colour, offset] of [[[0, 0, 0], Math.max(1, Math.round(cell / 2))], [[255, 255, 255], 0]]) {
		[...text].forEach((digit, n) => {
			DIGITS[digit].forEach((row, y) => {
				[...row].forEach((bit, x) => {
					if (bit === '1') fill(left + offset + (n * 6 + x) * cell, top + offset + y * cell, cell, cell, colour);
				});
			});
		});
	}
	return encodePng(width, height, rgb);
}
