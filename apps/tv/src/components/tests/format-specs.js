import {formatDuration, longDate, named, qualityLabel, shortDate, splitTerms, tileBadges} from '../format';

// Local times, so the expectations hold in any time zone.
const NOW = new Date(2026, 9, 12, 20, 15).getTime();
const at = (...parts) => new Date(...parts).getTime();

test('durations', () => {
	expect(formatDuration(0)).toBe('0:00');
	expect(formatDuration(61233)).toBe('1:01');
	expect(formatDuration(3723000)).toBe('1:02:03');
	expect(formatDuration(null)).toBe('');
});

test('dates in the grid', () => {
	expect(shortDate(at(2026, 9, 12, 8, 5), NOW)).toBe('今日 8:05');
	expect(shortDate(at(2026, 9, 11, 23, 59), NOW)).toBe('昨日 23:59');
	expect(shortDate(at(2026, 1, 7, 13, 0), NOW)).toBe('2月7日 13:00');
	expect(shortDate(at(2025, 11, 31, 13, 0), NOW)).toBe('2025年12月31日');
	expect(shortDate(null, NOW)).toBe('');
});

test('dates in the viewer', () => {
	expect(longDate(at(2026, 9, 12, 8, 5), NOW)).toBe('今日 8:05');
	expect(longDate(at(2026, 1, 7, 13, 0), NOW)).toBe('2月7日（土）13:00');
	expect(longDate(at(2025, 11, 31, 9, 30), NOW)).toBe('2025年12月31日（水）9:30');
});

test('names in sentences', () => {
	expect(named('SM-S938Q', 'につないでいます…')).toBe('SM-S938Q につないでいます…');
	expect(named('スマホ', 'につないでいます…')).toBe('スマホにつないでいます…');
	expect(named('Pixel 9（仕事用）', 'に')).toBe('Pixel 9（仕事用）に');
});

test('quality badge', () => {
	expect(qualityLabel(null)).toBe('標準');
	expect(qualityLabel({width: 3840, height: 2160, hdr: 'none'})).toBe('4K');
	expect(qualityLabel({width: 3840, height: 2160, hdr: 'hdr10'})).toBe('4K HDR');
	expect(qualityLabel({width: 2560, height: 1440, hdr: 'none'})).toBe('高画質');
});

test('grid badges', () => {
	expect(tileBadges({kind: 'video', durationMs: 61233, stereo: false, hdr: 'hdr10plus'})).toEqual({duration: '1:01', marks: ['HDR']});
	expect(tileBadges({kind: 'photo', durationMs: null, stereo: true, hdr: 'none'})).toEqual({duration: '', marks: ['3D']});
	expect(tileBadges({kind: 'photo', durationMs: null, stereo: false, hdr: 'none'})).toEqual({duration: '', marks: []});
});

test('names of buttons on the phone stay whole', () => {
	expect(splitTerms('スマホの「接続を待つ」をオンにして、「開く」を押す')).toEqual(['スマホの', '「接続を待つ」', 'をオンにして、', '「開く」', 'を押す']);
	expect(splitTerms('一覧を読み込めませんでした')).toEqual(['一覧を読み込めませんでした']);
});
