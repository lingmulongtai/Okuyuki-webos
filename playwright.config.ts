import { defineConfig } from '@playwright/test';

// Every screen is checked at the 1920x1080 graphics resolution webOS gives web apps.
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
		}
	],
	webServer: [
		{
			command: 'node tools/still4k/serve.mjs apps/still4k 8090',
			url: 'http://127.0.0.1:8090/index.html',
			reuseExistingServer: !process.env.CI
		}
	]
});
