import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The TV app against the mock phone host (tools/mock-host). The mock picks the still format from
// what this Chromium reports it can play (AV1 or VP9 here, HEVC on the TV), so the whole flow runs.

const HOST = 'http://127.0.0.1:38765';
const PHONE = { host: '127.0.0.1', port: 38765 };

// The synthetic library: item n has id 1000000 + n, every 7th is a video, every 11th photo is 3D.
const newestPhoto = '1000150';
const isVideo = (id: string) => (Number(id) - 1000000) % 7 === 0;

function trackErrors(page: Page) {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
}

async function screenshot(page: Page, name: string) {
	const body = await page.screenshot();
	await test.info().attach(name, { body, contentType: 'image/png' });
	if (process.env.SCREENSHOT_DIR) {
		mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
		await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `${name}.png`) });
	}
}

async function mock(request: APIRequestContext, action: string, query = '') {
	const response = await request.post(`${HOST}/__mock/${action}${query}`);
	expect(response.ok()).toBeTruthy();
	return response.json();
}

async function mockState(request: APIRequestContext) {
	return (await request.get(`${HOST}/__mock/state`)).json();
}

/** Opens the app the way the TV would, optionally launched by the phone with its address. */
async function launch(page: Page, params: Record<string, unknown> | null = PHONE) {
	await page.addInitScript((launchParams) => {
		const tv = window as unknown as Record<string, unknown>;
		// webOS TVs still provide the old PalmSystem name next to webOSSystem, and iLib reads both.
		tv.webOSSystem = tv.PalmSystem = {
			launchParams,
			deviceInfo: JSON.stringify({ modelName: 'OLED65C5PJA', sdkVersion: '25.0.0', uhd: 'true', screenWidth: 3840, screenHeight: 2160 }),
			locale: 'ja-JP',
			timeZone: 'Asia/Tokyo',
			platformBack: () => {
				tv.okuyukiExited = true;
			},
			stageReady: () => {}
		};
	}, params ? JSON.stringify(params) : '');
	await page.goto('/index.html');
}

/** Approves the pairing request on the "phone" after checking the TV shows the same code. */
async function approve(page: Page, request: APIRequestContext) {
	const code = page.getByTestId('pair-code');
	await expect(code).toHaveText(/^\d{4}$/);
	const shown = (await code.textContent())?.trim();
	const state = await mockState(request);
	expect(state.pending.map((pair: { code: string }) => pair.code)).toContain(shown);
	expect(state.pending[0].clientName).toBe('LG OLED65C5PJA');
	expect(state.pending[0].clientKind).toBe('tv');
	await mock(request, 'approve', `?code=${shown}`);
}

const gridItems = (page: Page) => page.locator('[data-item-id]');
const viewer = (page: Page) => page.getByTestId('photo-viewer');

async function openLibrary(page: Page, request: APIRequestContext) {
	await launch(page);
	await approve(page, request);
	await expect(gridItems(page).first()).toBeVisible();
}

test.beforeEach(async ({ request }) => {
	await mock(request, 'reset');
});

test('pairs with the phone and shows its library', async ({ page, request }) => {
	const errors = trackErrors(page);
	await launch(page);
	await expect(page.getByTestId('pair-code')).toBeVisible();
	await screenshot(page, 'tv-pairing');
	await approve(page, request);

	await expect(page.getByText('ライブラリ')).toBeVisible();
	await expect(page.getByText(/モック.*・150 件/)).toBeVisible();
	await expect(gridItems(page).first()).toHaveAttribute('data-item-id', newestPhoto);
	const state = await mockState(request);
	expect(state.capabilities.screen).toMatchObject({ graphicsWidth: 1920, graphicsHeight: 1080, videoWidth: 3840, videoHeight: 2160 });
	expect(state.capabilities.video.length).toBeGreaterThan(0);
	expect(state.sockets).toBe(1);
	await screenshot(page, 'tv-library');
	expect(errors).toEqual([]);
});

test('filters the library', async ({ page, request }) => {
	await openLibrary(page, request);
	await page.locator('[data-filter="video"]').click();
	await expect(gridItems(page).first()).toBeVisible();
	await expect(page.getByText(/・21 件/)).toBeVisible();
	const ids = await gridItems(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-item-id') ?? ''));
	expect(ids.length).toBeGreaterThan(0);
	expect(ids.every(isVideo)).toBe(true);
	await page.locator('[data-filter="stereo"]').click();
	await expect(page.getByText(/・12 件/)).toBeVisible();
	await screenshot(page, 'tv-library-3d');
});

test('loads more of the library while scrolling', async ({ page, request }) => {
	await openLibrary(page, request);
	await page.locator('[data-item-id]').first().hover();
	for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 1200);
	// The oldest item only exists on the third page.
	await expect(page.locator('[data-item-id="1000001"]')).toBeAttached({ timeout: 20_000 });
});

test('shows a photo, then swaps in the 4K still', async ({ page, request }) => {
	const errors = trackErrors(page);
	await openLibrary(page, request);
	await gridItems(page).first().click();
	await expect(viewer(page)).toHaveAttribute('data-item-id', newestPhoto);
	await expect(viewer(page)).toHaveAttribute('data-display', 'loaded');
	await expect(page.getByTestId('quality')).toHaveText('標準');
	await screenshot(page, 'tv-photo-standard');

	await expect(viewer(page)).toHaveAttribute('data-quality', 'still', { timeout: 30_000 });
	await expect(page.getByTestId('quality')).toHaveText('4K');
	const frame = await page.locator('video').evaluate((video: HTMLVideoElement) => ({
		width: video.videoWidth,
		height: video.videoHeight,
		paused: video.paused
	}));
	expect(frame).toEqual({ width: 3840, height: 2160, paused: true });
	expect((await mockState(request)).viewing).toBe(newestPhoto);
	await screenshot(page, 'tv-photo-4k');
	expect(errors).toEqual([]);
});

test('moves between photos with the remote and returns to the same place', async ({ page, request }) => {
	await openLibrary(page, request);
	await gridItems(page).first().click();
	await expect(viewer(page)).toHaveAttribute('data-item-id', newestPhoto);
	await page.keyboard.press('ArrowRight');
	await expect(viewer(page)).toHaveAttribute('data-item-id', '1000149');
	await page.keyboard.press('ArrowRight');
	await expect(viewer(page)).toHaveAttribute('data-item-id', '1000148');
	await page.keyboard.press('ArrowLeft');
	await expect(viewer(page)).toHaveAttribute('data-item-id', '1000149');
	await expect.poll(async () => (await mockState(request)).viewing).toBe('1000149');

	await page.keyboard.press('Escape');
	await expect(viewer(page)).toBeHidden();
	await expect(page.locator('[data-item-id="1000149"]')).toBeFocused();
	await expect.poll(async () => (await mockState(request)).viewing).toBeNull();
});

test('plays a video with the TV player', async ({ page, request }) => {
	const errors = trackErrors(page);
	await openLibrary(page, request);
	await page.locator('[data-filter="video"]').click();
	await expect(gridItems(page).first()).toHaveAttribute('data-item-id', '1000147');
	await gridItems(page).first().click();
	await expect(page.getByTestId('video-viewer')).toBeVisible();
	const video = page.locator('[data-testid="video-viewer"] video');
	await expect(video).toBeAttached({ timeout: 30_000 });
	await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime), { timeout: 20_000 }).toBeGreaterThan(0.5);
	await screenshot(page, 'tv-video');

	// The first Back hides the controls if they are up; Back with nothing up leaves the video.
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('video-viewer')).toBeHidden();
	await expect(gridItems(page).first()).toBeVisible();
	expect(errors).toEqual([]);
});

test('opens what the phone asks it to show', async ({ page, request }) => {
	await openLibrary(page, request);
	await mock(request, 'show', '?id=1000120');
	await expect(viewer(page)).toHaveAttribute('data-item-id', '1000120');
	// A video from the phone starts playing right away.
	await mock(request, 'show', '?id=1000140');
	await expect(page.getByTestId('video-viewer')).toHaveAttribute('data-item-id', '1000140');
});

test('reconnects without pairing again, and asks again after the phone revokes it', async ({ page, request }) => {
	await openLibrary(page, request);
	await page.reload();
	await expect(gridItems(page).first()).toBeVisible();
	expect((await mockState(request)).pending).toEqual([]);

	await mock(request, 'revoke');
	await expect(page.getByTestId('pair-code')).toBeVisible({ timeout: 20_000 });
	await approve(page, request);
	await expect(gridItems(page).first()).toBeVisible();
});

test('connects to an address typed on the TV', async ({ page, request }) => {
	await launch(page, null);
	await expect(page.locator('[data-status="idle"]')).toBeVisible();
	await page.getByPlaceholder('192.168.1.23:38765').fill('not an address');
	await page.getByRole('button', { name: '接続' }).click();
	await expect(page.getByText('「IP アドレス:ポート」の形で入力してください')).toBeVisible();
	await page.getByPlaceholder('192.168.1.23:38765').fill('127.0.0.1:38765');
	await page.getByRole('button', { name: '接続' }).click();
	await approve(page, request);
	await expect(gridItems(page).first()).toBeVisible();
	await screenshot(page, 'tv-connected-by-address');
});

test('tells the user when the phone turns sharing off', async ({ page, request }) => {
	await openLibrary(page, request);
	await mock(request, 'close');
	await expect(page.getByText('スマホで接続がオフになりました')).toBeVisible();
	await screenshot(page, 'tv-sharing-off');
	await page.getByRole('button', { name: 'もう一度つなぐ' }).click();
	await expect(gridItems(page).first()).toBeVisible();
});

test('reloads the library when the phone says it changed', async ({ page, request }) => {
	await openLibrary(page, request);
	await mock(request, 'library_changed', '?add=1');
	await expect(gridItems(page).first()).toHaveAttribute('data-item-id', '1000151');
	await expect(page.getByText(/・151 件/)).toBeVisible();
});

test('keeps photos at standard quality when best quality is off', async ({ page, request }) => {
	await openLibrary(page, request);
	await page.getByRole('button', { name: '設定' }).click();
	await page.getByText('写真を最高画質（4K）で表示する').click();
	await screenshot(page, 'tv-settings');
	await page.keyboard.press('Escape');
	await gridItems(page).first().click();
	await expect(viewer(page)).toHaveAttribute('data-display', 'loaded');
	await page.waitForTimeout(3000);
	await expect(viewer(page)).toHaveAttribute('data-quality', 'standard');
	await expect(page.getByTestId('quality')).toHaveText('標準');
});

test('asks before leaving the app', async ({ page, request }) => {
	await openLibrary(page, request);
	await page.keyboard.press('Escape');
	await expect(page.getByText('Okuyuki TV を終了しますか？')).toBeVisible();
	await screenshot(page, 'tv-exit');
	await page.keyboard.press('Escape');
	await expect(page.getByText('Okuyuki TV を終了しますか？')).toBeHidden();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: '終了' }).click();
	await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).okuyukiExited)).toBe(true);
});
