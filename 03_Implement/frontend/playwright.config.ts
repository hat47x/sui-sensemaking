import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // UX-PERF-01 measures Time-to-Interactive against the production build.
  // The SaaS multi-instance auth spec likewise owns its own config and service
  // harness (mock Broker, PostgreSQL, gateway, and two backend workers).
  // Neither is representative when executed by this Vite-only default config.
  testIgnore: [
    "ux_perf_01_time_to_interactive.spec.ts",
    "saas_auth_browser_multi_instance.spec.ts",
    // Needs a real OAuth broker on localhost:9100; run with its own harness.
    "tenant_session_real_backend_multitab.spec.ts",
  ],
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
