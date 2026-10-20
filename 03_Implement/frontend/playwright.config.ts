import { defineConfig } from "@playwright/test";

const externalHarnessSpecs = [
  "ux_perf_01_time_to_interactive.spec.ts",
  "saas_auth_browser_multi_instance.spec.ts",
  "tenant_session_real_backend_multitab.spec.ts",
];
const capacityBudgetSpec = "representative_visual_cue_capacity_budget.spec.ts";

export default defineConfig({
  testDir: "./e2e",
  // UX-PERF-01 measures Time-to-Interactive against the production build.
  // The SaaS multi-instance auth spec likewise owns its own config and service
  // harness (mock Broker, PostgreSQL, gateway, and two backend workers).
  // Neither is representative when executed by this Vite-only default config.
  testIgnore: externalHarnessSpecs,
  // Bound page/context setup under host contention without changing expect
  // timeouts or the explicit capacity/responsiveness budgets in the specs.
  timeout: 60_000,
  retries: 0,
  // Keep local and CI scheduling independent of the host CPU count.
  workers: 2,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-summary.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // With retries=0, on-first-retry never records the failed attempt.
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "ui",
      testIgnore: [...externalHarnessSpecs, capacityBudgetSpec],
    },
    {
      name: "capacity-budget",
      testMatch: capacityBudgetSpec,
      // A serial describe alone would still run beside other spec files.
      dependencies: ["ui"],
      workers: 1,
      // Tracing perturbs long-task measurements; the JSON attachment contains
      // the raw capacity measurements even if a budget assertion fails.
      use: { trace: "off" },
    },
  ],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
