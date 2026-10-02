import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// AI-MODEL-UX-01 (AC-4, issue-AI-MODEL-UX-01-empty-model-state-lacks-cause.md):
// fix "provider mismatch" (`provider_unavailable`), "empty allowlist"
// (`tenant_policy_excludes_all`) and "no active models" (`no_active_models`)
// against a REAL running backend + real browser, not mocked page.route
// fixtures. Every other e2e/*.spec.ts in this project pins external
// dependencies with page.route (see docs/e2e_testing.md "再現性・flaky対策"),
// which is right for UI-only regression coverage but cannot prove that the
// backend's `unavailableReason` resolver (03_Implement/backend/src/
// sui_sensemaking_api/routes/ai.py get_available_models(), lines ~907-955) actually
// drives the ModelSelector's guidance text end to end.
//
// Requires a live backend. Per CONTRIBUTING.md's "SQLite代替E2E" path:
//
//   cd 03_Implement/backend
//   PYTHONPATH=src SUI_DATABASE_URL="sqlite:////tmp/sui_sensemaking_model_ux_e2e.sqlite3" \
//     python -m alembic upgrade head
//   PYTHONPATH=src SUI_DATABASE_URL="sqlite:////tmp/sui_sensemaking_model_ux_e2e.sqlite3" \
//     SUI_LLM_PROVIDER=none \
//     python -m uvicorn sui_sensemaking_api.main:app --host 127.0.0.1 --port 8000
//
// (SUI_LLM_PROVIDER=none is already the default -- set explicitly here so
// the fixture's assumption is visible.) No SUI_API_KEY / _ADMIN_API_KEY
// is required: local-dev is the zero-configuration profile, so both the
// business plane and the control plane (/admin/provision/**) are open
// (control_plane_auth.py `_OPEN_WHEN_UNCONFIGURED_PROFILES`). Use a *fresh*
// database -- these tests register fixture models/providers and mutate the
// `local-default` tenant's allowlist, and assert on an initially-empty
// registry for the `no_active_models` case.
//
// Then, from 03_Implement/frontend (an npm-ci'd checkout -- WSL-native if on
// Windows, see docs/e2e_testing.md):
//
//   SUI_E2E_REAL_BACKEND=1 npx playwright test \
//     e2e/ai_model_ux_available_models_reason.spec.ts --reporter=line --workers=1
//
// Gated behind SUI_E2E_REAL_BACKEND (mirrors the SUI_E2E_SAAS gate
// in tenant_session_multitab.spec.ts) so a plain `npm run e2e` -- which every
// other spec here satisfies with mocks alone -- does not fail merely because
// no backend happens to be running.
//
// Mechanism note: `get_available_models` computes `runtime_models` by
// intersecting active registry models with providers whose registered
// `providerKind` string-matches the actually configured runtime provider
// (`_provider_matches_runtime`, ai.py ~line 94). With the backend run under
// `SUI_LLM_PROVIDER=none`, a registry provider registered with
// providerKind "none" is therefore "reachable" (no live LLM connectivity is
// needed for this contract -- only the available-models listing is under
// test, never an actual generate call), while providerKind "deepseek" is not.
// That lets every scenario below run against one backend process without
// juggling multiple SUI_LLM_PROVIDER runtimes.

const BACKEND_URL = process.env.SUI_E2E_BACKEND_URL ?? "http://127.0.0.1:8000";
const TENANT_ID = "local-default";
const START_PANEL = '[data-panel="start-document-entry"]';
const MODEL_SELECTOR_REGION = '[data-ui-region="model-selector-title"]';

// Fixture ids for this spec only -- distinct from admin_lifecycle.py / other
// scripts that share the same open local-dev backend during manual runs.
const UNREACHABLE_PROVIDER_ID = "e2e-model-ux-unreachable-provider";
const UNREACHABLE_MODEL_ID = "e2e-model-ux-unreachable-model";
const REACHABLE_PROVIDER_ID = "e2e-model-ux-reachable-provider";
const REACHABLE_MODEL_ID = "e2e-model-ux-reachable-model";

const REASON_TEXT = {
  no_active_models:
    "No active model is registered. Ask an administrator to register or enable one.",
  provider_unavailable:
    "The registered models do not match the active AI connection. Ask an administrator to check the provider settings.",
  tenant_policy_excludes_all:
    "This tenant's model policy currently excludes every executable model. Ask an administrator to review its allowlist.",
} as const;

async function adminPost(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await request.post(`${BACKEND_URL}${path}`, { data });
  if (response.status() !== 201) {
    throw new Error(
      `POST ${path} expected 201, got ${response.status()}: ${await response.text()}`,
    );
  }
}

// OPS-ADMIN-CONCURRENCY-01 AC-4: expectedRevision is required (the
// unconditional-PUT compatibility window is over), so read the current
// revision first -- the same GET-then-PUT sequence the official admin CLI
// already performs for `model-allowlist-set`.
async function setTenantAllowlist(request: APIRequestContext, modelIds: string[]): Promise<void> {
  const current = await request.get(
    `${BACKEND_URL}/admin/provision/models/tenants/${TENANT_ID}/allowlist`,
  );
  if (current.status() !== 200) {
    throw new Error(
      `GET allowlist expected 200, got ${current.status()}: ${await current.text()}`,
    );
  }
  const { revision } = (await current.json()) as { revision: string };
  const response = await request.put(
    `${BACKEND_URL}/admin/provision/models/tenants/${TENANT_ID}/allowlist`,
    { data: { modelIds, expectedRevision: revision } },
  );
  if (response.status() !== 200) {
    throw new Error(
      `PUT allowlist ${JSON.stringify(modelIds)} expected 200, got ${response.status()}: ${await response.text()}`,
    );
  }
}

async function registerReachableModel(request: APIRequestContext): Promise<void> {
  // providerKind "none" string-matches the backend's actual configured
  // provider (SUI_LLM_PROVIDER=none) -- see the mechanism note above.
  await adminPost(request, "/admin/provision/models/providers", {
    id: REACHABLE_PROVIDER_ID,
    providerKind: "none",
    displayName: "E2E reachable (none) provider",
  });
  await adminPost(request, "/admin/provision/models", {
    id: REACHABLE_MODEL_ID,
    providerId: REACHABLE_PROVIDER_ID,
    displayName: "E2E Reachable Model",
    capabilities: "intermediate,generate",
  });
}

async function registerUnreachableModel(request: APIRequestContext): Promise<void> {
  // providerKind "deepseek" does NOT match the backend's actual "none"
  // runtime provider, so this model is active but never in `runtime_models`.
  await adminPost(request, "/admin/provision/models/providers", {
    id: UNREACHABLE_PROVIDER_ID,
    providerKind: "deepseek",
    displayName: "E2E unreachable (deepseek) provider",
  });
  await adminPost(request, "/admin/provision/models", {
    id: UNREACHABLE_MODEL_ID,
    providerId: UNREACHABLE_PROVIDER_ID,
    displayName: "E2E Unreachable Model",
    capabilities: "intermediate,generate",
  });
}

/** Re-enter the workspace so the top-level `fetchAvailableModels` effect
 * (App.tsx, keyed on the tenant session, not polled) runs again against the
 * backend's current registry/allowlist state. The canvas document itself is
 * client-only until an explicit save, so every fresh entry lands back on the
 * start panel -- this deliberately re-does "Create new document" each time
 * rather than relying on any live-update mechanism the app does not have. */
async function reenterWorkspace(page: Page): Promise<void> {
  await expect(page.locator(START_PANEL)).toBeVisible();
  await page.getByRole("button", { name: "Create new document" }).click();
  await expect(page.locator(START_PANEL)).toBeHidden();
  // The title-area model selector is an AI feature shown only with Advanced on.
  const advanced = page.getByRole("button", { name: "Advanced", exact: true });
  if ((await advanced.getAttribute("aria-pressed")) !== "true") {
    await advanced.click();
  }
}

function modelSelectorStatus(page: Page): Locator {
  return page.locator(MODEL_SELECTOR_REGION).getByRole("status");
}

test.beforeEach(() => {
  test.skip(
    process.env.SUI_E2E_REAL_BACKEND !== "1",
    "Requires a live backend -- see the file-header comment for setup, then "
      + "set SUI_E2E_REAL_BACKEND=1 to run this spec.",
  );
});

test.beforeAll(async ({ request }) => {
  if (process.env.SUI_E2E_REAL_BACKEND !== "1") {
    return;
  }
  const health = await request.get(`${BACKEND_URL}/healthz`).catch(() => null);
  if (!health || !health.ok()) {
    throw new Error(
      `Backend not reachable at ${BACKEND_URL}/healthz. Start it per the `
        + "file-header comment before running with SUI_E2E_REAL_BACKEND=1.",
    );
  }
});

test(
  "empty registry shows the no_active_models guidance (real backend, fresh registry)",
  async ({ page, request }) => {
    const registry = await request.get(`${BACKEND_URL}/admin/provision/models`);
    expect(registry.ok()).toBe(true);
    const registryBody = (await registry.json()) as { models: unknown[] };
    expect(
      registryBody.models,
      "This scenario requires a FRESH backend database with zero registered "
        + "models. Re-run against a new sqlite file per the file-header comment.",
    ).toEqual([]);

    await page.goto("/?locale=en");
    await reenterWorkspace(page);

    const region = page.locator(MODEL_SELECTOR_REGION);
    await expect(region).toBeVisible();
    await expect(region.locator("select")).toBeDisabled();
    await expect(region.locator("select")).toHaveValue("");
    await expect(modelSelectorStatus(page)).toHaveText(REASON_TEXT.no_active_models);
  },
);

test(
  "an active model whose provider is unreachable shows provider_unavailable, "
    + "then correctly switches to tenant_policy_excludes_all once a reachable "
    + "model is excluded by the allowlist, and clears once the allowlist is reset",
  async ({ page, request }) => {
    // --- Step 1: provider_unavailable ------------------------------------
    // Active model registered, but its provider's kind does not match the
    // backend's actual runtime provider.
    await registerUnreachableModel(request);

    await page.goto("/?locale=en");
    await reenterWorkspace(page);
    await expect(page.locator(MODEL_SELECTOR_REGION).locator("select")).toBeDisabled();
    await expect(modelSelectorStatus(page)).toHaveText(REASON_TEXT.provider_unavailable);

    // --- Step 2: tenant_policy_excludes_all ------------------------------
    // Register a second model whose provider DOES match the runtime (so
    // runtime_models becomes non-empty), then restrict the tenant allowlist
    // to the still-unreachable model from step 1. The reachable model is
    // filtered out by the allowlist intersection, so the effective set is
    // empty for a different reason than step 1: policy, not connectivity.
    await registerReachableModel(request);
    await setTenantAllowlist(request, [UNREACHABLE_MODEL_ID]);

    await page.reload();
    await reenterWorkspace(page);
    await expect(page.locator(MODEL_SELECTOR_REGION).locator("select")).toBeDisabled();
    await expect(modelSelectorStatus(page)).toHaveText(REASON_TEXT.tenant_policy_excludes_all);

    // --- Step 3: same session/tenant, restored allowlist -> models appear -
    // 対応方針: "API応答と表示文言は、model/providerの状態変更後にも同一
    // session・tenant条件で整合させる" -- the empty-state reason must not be
    // sticky once the underlying cause is actually resolved, in the same
    // browser session and the same (default) tenant.
    await setTenantAllowlist(request, []);

    await page.reload();
    await reenterWorkspace(page);
    const select = page.locator(MODEL_SELECTOR_REGION).locator("select");
    await expect(select).toBeEnabled();
    await expect(page.locator(MODEL_SELECTOR_REGION).getByRole("status")).toHaveCount(0);
    await expect(select.locator(`option[value="${REACHABLE_MODEL_ID}"]`)).toHaveText(
      "E2E Reachable Model",
    );
    // The unreachable model must never be offered, allowlist aside.
    await expect(select.locator(`option[value="${UNREACHABLE_MODEL_ID}"]`)).toHaveCount(0);
  },
);
