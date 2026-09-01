import assert from "node:assert/strict";
import test from "node:test";

import { parseBillingUsage, parseSubscriptionTier } from "../src/grok-usage.ts";
import { GROK_LAUNCH_SPEC } from "../src/server.ts";

test("exposes Grok's xhigh effort and forwards it to the CLI", () => {
  assert.deepEqual(GROK_LAUNCH_SPEC.reasoningCli.supportedLevels, [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.equal(GROK_LAUNCH_SPEC.reasoningCli.levelValues?.xhigh, "xhigh");
});

test("parses the current subscription from Grok settings", () => {
  assert.equal(
    parseSubscriptionTier({ subscription_tier_display: "SuperGrok Heavy" }),
    "SuperGrok Heavy",
  );
});

test("uses the settings subscription when billing omits the plan", () => {
  const usage = parseBillingUsage(
    {
      config: {
        creditUsagePercent: 3,
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          end: "2026-09-08T00:00:00Z",
        },
      },
    },
    "user@example.com",
    "SuperGrok Heavy",
  );

  assert.equal(usage.planLabel, "SuperGrok Heavy");
});

test("parses the current weekly credits response", () => {
  const usage = parseBillingUsage(
    {
      config: {
        creditUsagePercent: 42.5,
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          end: "2026-09-08T00:00:00Z",
        },
      },
      subscriptionTier: "SuperGrok Heavy",
    },
    "user@example.com",
  );

  assert.deepEqual(usage, {
    status: "ok",
    accountEmail: "user@example.com",
    planLabel: "SuperGrok Heavy",
    windows: [{
      label: "Weekly credits",
      usedPercent: 43,
      resetsAt: "2026-09-08T00:00:00.000Z",
    }],
  });
});

test("derives usage from the legacy monthly counters", () => {
  const usage = parseBillingUsage(
    {
      config: {
        monthlyLimit: { val: 16_500 },
        used: { val: 5_092 },
        billingPeriodEnd: "2026-10-01T00:00:00Z",
      },
    },
    null,
  );

  assert.equal(usage.status, "ok");
  assert.deepEqual(usage.windows, [{
    label: "Monthly credits",
    usedPercent: 31,
    resetsAt: "2026-10-01T00:00:00.000Z",
  }]);
});

test("rejects an invalid billing percentage", () => {
  assert.throws(() => parseBillingUsage({ config: { creditUsagePercent: 101 } }, null), /invalid usage percentage/);
});
