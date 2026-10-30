import { defineConfig } from '@playwright/test';

const reuse = !process.env.CI;

// Every screen is checked at the 1920x1080 graphics resolution webOS gives web apps.
// The TV app tests need its production build first: `npm run tv:build`.
export default defineConfig({
	testDir: 'tests',
	timeout: 60_000,
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		viewport: { width: 1920, height: 1080 },
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'still4k',
			testMatch: /still4k\.spec\.ts/,
			use: { baseURL: 'http://127.0.0.1:8090' }
		},
		{
			name: 'tv',
			testMatch: /tv\.spec\.ts/,
			use: { baseURL: 'http://127.0.0.1:8091' }
		}
	],
	webServer: [
		{
			command: 'node tools/still4k/serve.mjs apps/still4k 8090',
			url: 'http://127.0.0.1:8090/__health',
			reuseExistingServer: reuse
		},
		{
			command: 'node tools/still4k/serve.mjs apps/tv/dist 8091',
			url: 'http://127.0.0.1:8091/__health',
			reuseExistingServer: reuse
		},
		{
			// The stand-in for the phone; the TV tests drive it through /__mock/*.
			command: 'node tools/mock-host/server.mjs --port 38765 --host 127.0.0.1 --items 150',
			url: 'http://127.0.0.1:38765/v1/hello',
			reuseExistingServer: reuse
		}
	]
});
