import { defineConfig } from "@playwright/test";

// Performance budget tests are deliberately isolated from the functional e2e
// suite. Running them beside many UI tests makes long-task/heap measurements
// depend on unrelated load; a dedicated config keeps the budget meaningful.
// See Issue #3250.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "representative_visual_cue_capacity_budget.spec.ts",
    "responsiveness_performance_budget.spec.ts",
  ],
  timeout: 60_000,
  retries: 0,
  workers: 1,
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
