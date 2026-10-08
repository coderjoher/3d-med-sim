import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * E2E (Chromium only). WebGL via SwiftShader; fake camera so hand-tracking start-up
 * paths run without hardware. Servers: lab API (in-memory, demo seed) + Vite dev server.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        launchOptions: {
          executablePath: '/opt/pw-browsers/chromium',
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run start -w packages/server',
      cwd: repoRoot,
      url: 'http://localhost:3000/api/health',
      env: { DATABASE_URL: '', SEED_DEMO: '1', PORT: '3000', JWT_SECRET: 'e2e' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173/station',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
