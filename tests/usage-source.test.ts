import assert from "node:assert/strict";
import test from "node:test";

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { GET_RESOURCE, LIST_RESOURCES, registerUsageSource } from "../src/usage-source.ts";

type Handlers = Record<string, (input: never) => Promise<unknown>>;

function setup(usage: unknown, providerIds = ["grok-build-usage", "acp-grok"]) {
  let handlers: Handlers = {};
  let options: unknown;
  const calls: unknown[] = [];
  const bb = {
    rpc: {
      register(_contract: unknown, registered: Handlers, opts: unknown) {
        handlers = registered;
        options = opts;
      },
    },
    sdk: {
      hosts: {
        list: async () => [{ id: "host_1", name: "MacBook", status: "connected" }],
      },
      providers: {
        list: async () => providerIds.map((id) => ({ id })),
      },
      system: {
        usageLimits: async (args: unknown) => {
          calls.push(args);
          return { "grok-build-usage": usage };
        },
      },
    },
  } as unknown as BbPluginApi;
  registerUsageSource(bb);
  return { handlers, options, calls };
}

const okUsage = {
  status: "ok",
  accountEmail: "a@b.c",
  planLabel: "SuperGrok",
  windows: [{ label: "Weekly credits", usedPercent: 12, resetsAt: null }],
};

test("registers as a discoverable usage source", () => {
  const { options } = setup(okUsage);
  assert.deepEqual((options as { experimental_discoverable: boolean }).experimental_discoverable, true);
});

test("lists one host resource for the Grok Build provider", async () => {
  const { handlers } = setup(okUsage);
  const result = (await handlers[LIST_RESOURCES]({} as never)) as { resources: { id: string; providerId: string }[] };
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].providerId, "grok-build-usage");
  assert.equal(result.resources[0].id, JSON.stringify(["host_1", "grok-build-usage"]));
});

test("lists nothing when the provider has no usage capability", async () => {
  const { handlers } = setup(okUsage, ["acp-grok"]);
  const result = (await handlers[LIST_RESOURCES]({} as never)) as { resources: unknown[] };
  assert.deepEqual(result.resources, []);
});

test("getResource returns windows from usageLimits", async () => {
  const { handlers, calls } = setup(okUsage);
  const result = (await handlers[GET_RESOURCE]({
    resourceId: JSON.stringify(["host_1", "grok-build-usage"]),
    refresh: true,
  } as never)) as { usage: { status: string; windows: { id: string; usedPercent: number; kind: string }[] } };
  assert.deepEqual(calls, [{ hostId: "host_1", providerId: "grok-build-usage" }]);
  assert.equal(result.usage.status, "ok");
  assert.equal(result.usage.windows[0].id, "0:Weekly credits");
  assert.equal(result.usage.windows[0].usedPercent, 12);
  assert.equal(result.usage.windows[0].kind, "custom");
});

// bb's `usageLimits` returns a bare `{ status }` for these states, so the source
// has to supply the account fields its consumer requires.
for (const status of ["not_installed", "unauthenticated", "expired"] as const) {
  test(`getResource passes through the bare ${status} state`, async () => {
    const { handlers } = setup({ status });
    const result = (await handlers[GET_RESOURCE]({
      resourceId: JSON.stringify(["host_1", "grok-build-usage"]),
      refresh: true,
    } as never)) as { usage: { status: string; accountEmail: string | null; planLabel: string | null } };
    assert.equal(result.usage.status, status);
    assert.equal(result.usage.accountEmail, null);
    assert.equal(result.usage.planLabel, null);
  });
}

test("getResource keeps the host's error message", async () => {
  const { handlers } = setup({
    status: "error",
    message: "Grok Build billing request timed out",
    accountEmail: "a@b.c",
    planLabel: null,
  });
  const result = (await handlers[GET_RESOURCE]({
    resourceId: JSON.stringify(["host_1", "grok-build-usage"]),
    refresh: true,
  } as never)) as { usage: { status: string; message?: string; accountEmail: string | null } };
  assert.equal(result.usage.status, "error");
  assert.equal(result.usage.message, "Grok Build billing request timed out");
  assert.equal(result.usage.accountEmail, "a@b.c");
});

test("getResource rejects resources for other providers", async () => {
  const { handlers } = setup(okUsage);
  await assert.rejects(
    handlers[GET_RESOURCE]({ resourceId: JSON.stringify(["host_1", "acp-cursor"]), refresh: false } as never),
    /no longer exists/,
  );
});
