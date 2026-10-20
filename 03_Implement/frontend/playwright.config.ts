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
    // Budget measurements must not compete with other UI tests for CPU/GPU.
    // They run alone via playwright.perf.config.ts (`npm run e2e:perf`).
    "representative_visual_cue_capacity_budget.spec.ts",
    "responsiveness_performance_budget.spec.ts",
  ],
  // Playwright's default worker count starves page creation on a 12-logical-CPU
  // Windows host (browserContext.newPage / start-panel timeouts). Three keeps
  // the full suite reproducible without retries; see Issue #3250.
  workers: 3,
  // A cold Vite server plus four browsers can take longer than 30s to create a
  // page on Windows. These budgets are for correctness, not latency; the
  // latency budgets live in the isolated perf config.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  outputDir: "test-results/ui",
  reporter: [["list"], ["json", { outputFile: "test-results/reports/ui.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
