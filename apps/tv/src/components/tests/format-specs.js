import {formatDuration, itemBadges, qualityLabel} from '../format';

test('durations', () => {
	expect(formatDuration(0)).toBe('0:00');
	expect(formatDuration(61233)).toBe('1:01');
	expect(formatDuration(3723000)).toBe('1:02:03');
	expect(formatDuration(null)).toBe('');
});

test('quality badge', () => {
	expect(qualityLabel(null)).toBe('標準');
	expect(qualityLabel({width: 3840, height: 2160, hdr: 'none'})).toBe('4K');
	expect(qualityLabel({width: 3840, height: 2160, hdr: 'hdr10'})).toBe('4K HDR');
	expect(qualityLabel({width: 2560, height: 1440, hdr: 'none'})).toBe('高画質');
});

test('grid badges', () => {
	expect(itemBadges({kind: 'video', durationMs: 61233, stereo: false, hdr: 'hdr10plus'})).toBe('1:01  HDR');
	expect(itemBadges({kind: 'photo', durationMs: null, stereo: true, hdr: 'none'})).toBe('3D');
	expect(itemBadges({kind: 'photo', durationMs: null, stereo: false, hdr: 'none'})).toBe('');
});
