import { expect, test, type Page } from '@playwright/test';

// Desktop Chromium has no HEVC or H.264 decoder, so these tests check the app's flow and timing
// reports. Whether 4K stills look sharp is checked on the TV itself (docs/STILL4K.md).

function trackErrors(page: Page) {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
}

async function attachScreenshot(page: Page, name: string) {
	await test.info().attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

const hud = (page: Page) => page.locator('#hud');

test('menu lists every test and follows the remote', async ({ page }) => {
	const errors = trackErrors(page);
	await page.goto('/index.html');
	const items = page.locator('#menu .item');
	await expect(items).toHaveCount(8);
	await expect(page.locator('#menu-status')).toHaveText('テスト素材: 解像度 8 種類、HDR 3 種類、写真 6 枚');
	await expect(items.first()).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(items.nth(1)).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');
	await expect(items.first()).toBeFocused();
	await attachScreenshot(page, 'menu');
	expect(errors).toEqual([]);
});

test('resolution test shows the 1080p image and the 4K still video', async ({ page }) => {
	const errors = trackErrors(page);
	await page.goto('/index.html');
	await page.keyboard.press('Enter');
	await expect(page.locator('#stage')).toBeVisible();
	await expect(hud(page)).toContainText('解像度  1/8  PNG in <img> (graphics plane)');
	await expect(hud(page)).toContainText('元 3840×2160');
	await expect(page.locator('#still-img')).toBeVisible();
	// The page stays transparent so the TV's video plane shows through it.
	const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(background).toBe('rgba(0, 0, 0, 0)');
	await attachScreenshot(page, 'resolution-image');

	// Left wraps to the last chart: AV1, which desktop Chromium can decode.
	await page.keyboard.press('ArrowLeft');
	await expect(hud(page)).toContainText('8/8  AV1 10-bit, 2 frames');
	await expect(hud(page)).toContainText('動画: 3840×2160  方法: 再生してすぐ一時停止', { timeout: 20_000 });
	await expect(page.locator('#still-img')).toBeHidden();
	await page.keyboard.press('ArrowDown');
	await expect(hud(page)).toContainText('方法: 再生せず最初のフレームだけ', { timeout: 20_000 });

	// OK hides and restores the measurements.
	await page.keyboard.press('Enter');
	await expect(hud(page)).toBeEmpty();
	await page.keyboard.press('Enter');
	await expect(hud(page)).toContainText('AV1 10-bit');

	await page.keyboard.press('Escape');
	await expect(page.locator('#menu')).toBeVisible();
	await expect(page.locator('[data-test="resolution"]')).toBeFocused();
	const recorded = await page.evaluate(() => (window as any).okuyukiStill4k.results.resolution.length);
	expect(recorded).toBeGreaterThanOrEqual(2);
	expect(errors).toEqual([]);
});

test('HDR test reports every still, even ones the browser cannot play', async ({ page }) => {
	const errors = trackErrors(page);
	await page.goto('/index.html');
	await page.locator('[data-test="hdr"]').click();
	await expect(hud(page)).toContainText('HDR  1/3  HDR10 (PQ)');
	await expect(hud(page)).not.toContainText('読み込み中', { timeout: 20_000 });
	await page.keyboard.press('ArrowRight');
	await expect(hud(page)).toContainText('2/3  HLG');
	await expect(hud(page)).not.toContainText('読み込み中', { timeout: 20_000 });
	expect(errors).toEqual([]);
});

test('switching tests run without stalling', async ({ page }) => {
	const errors = trackErrors(page);
	await page.goto('/index.html');
	await page.locator('[data-test="single"]').click();
	await expect(hud(page)).toContainText('自動テスト完了', { timeout: 45_000 });
	await page.keyboard.press('Escape');

	await page.locator('[data-test="double"]').click();
	await expect(hud(page)).toContainText('切り替えから描画まで', { timeout: 20_000 });
	await page.keyboard.press('ArrowRight');
	await expect(hud(page)).toContainText('Photo 2', { timeout: 20_000 });
	await page.keyboard.press('Escape');

	const switching = await page.evaluate(() => (window as any).okuyukiStill4k.results.switching);
	expect(switching.single).toHaveLength(6);
	expect(switching.double.length).toBeGreaterThanOrEqual(2);
	expect(errors).toEqual([]);
});

test('overlay test draws the UI above the video', async ({ page }) => {
	const errors = trackErrors(page);
	await page.goto('/index.html');
	await page.locator('[data-test="overlay"]').click();
	await expect(page.locator('#overlay-demo')).toBeVisible();
	await expect(page.locator('#overlay-demo .sheet-title')).toHaveText('UI の重ね表示テスト');
	await attachScreenshot(page, 'overlay');
	await page.keyboard.press('Escape');
	await expect(page.locator('#overlay-demo')).toBeHidden();
	expect(errors).toEqual([]);
});

test('formats screen summarizes what the browser can decode', async ({ page }) => {
	const errors = trackErrors(page);
	await page.goto('/index.html');
	await page.locator('[data-test="formats"]').click();
	const text = page.locator('#panel-text');
	await expect(text).toContainText('動画の形式（canPlayType / MSE）');
	await expect(text).toContainText('AV1 Main 10-bit: probably');
	await expect(text).toContainText('4K60 HDR の再生（MediaCapabilities）');
	await expect(text).toContainText('画像: AVIF はい、WebP はい');
	await attachScreenshot(page, 'formats');
	await page.keyboard.press('PageDown');
	await page.keyboard.press('Escape');
	await expect(page.locator('[data-test="formats"]')).toBeFocused();
	expect(errors).toEqual([]);
});

test('own photos load from a PC and the results go back to it', async ({ page }) => {
	const errors = trackErrors(page);
	const posted: string[] = [];
	const cors = { 'Access-Control-Allow-Origin': '*' };
	await page.route('http://pc.test/**', async (route) => {
		const { pathname } = new URL(route.request().url());
		if (pathname === '/list.json') {
			await route.fulfill({ headers: cors, json: [{ name: 'sample', still: 'photo-1.mp4', jpeg: 'photo-1.jpg' }] });
		} else if (pathname === '/results') {
			posted.push(route.request().postData() ?? '');
			await route.fulfill({ status: 204, headers: cors });
		} else {
			await route.fulfill({ headers: cors, path: `apps/still4k/assets${pathname}` });
		}
	});

	await page.goto('/index.html');
	await page.locator('[data-test="pc"]').click();
	const input = page.locator('#panel-controls input');
	await expect(input).toBeFocused();
	await input.fill('http://pc.test/');
	await page.locator('#panel-controls button').click();
	await expect(hud(page)).toContainText('sample  4K 静止画動画');
	await expect(hud(page)).not.toContainText('読み込み中', { timeout: 20_000 });
	await page.keyboard.press('Enter');
	await expect(hud(page)).toContainText('sample  1080p JPEG');
	await expect(hud(page)).toContainText('画像の読み込み');
	await page.keyboard.press('Escape');

	await page.locator('[data-test="results"]').click();
	await page.locator('#panel-controls button').click();
	await expect(page.locator('#panel-text')).toContainText('http://pc.test に送りました');
	const results = JSON.parse(posted[0]);
	expect(results.app).toBe('okuyuki-still4k');
	expect(results.pc.map((entry: { label: string }) => entry.label)).toEqual(['sample', 'sample']);
	expect(errors).toEqual([]);
});
