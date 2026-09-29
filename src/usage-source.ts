import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const GROK_PROVIDER_ID = "grok-build-usage";
export const LIST_RESOURCES = "provider-usage.v1.listResources";
export const GET_RESOURCE = "provider-usage.v1.getResource";

const CACHE_MS = 60_000;

const accountKey = z.string().min(1).nullable().default(null);
const plan = z.object({
  id: z.string().min(1),
  multiplier: z.number().int().positive().nullable(),
});
const account = {
  plan: plan.nullable().default(null),
  accountEmail: z.string().nullable(),
  planLabel: z.string().nullable(),
};
const windowSchema = z.object({
  kind: z.enum(["five-hour", "daily", "weekly", "custom"]).default("custom"),
  id: z.string().min(1),
  label: z.string().min(1),
  usedPercent: z.number().nonnegative(),
  resetsAt: z.string().nullable(),
  model: z.string().nullable(),
  cost: z
    .object({ usedUsdCents: z.number().nonnegative(), limitUsdCents: z.number().positive() })
    .nullable(),
});
const usageSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), ...account, windows: z.array(windowSchema) }),
  z.object({ status: z.literal("not_installed"), ...account }),
  z.object({ status: z.literal("unauthenticated"), ...account }),
  z.object({ status: z.literal("expired"), ...account }),
  z.object({ status: z.literal("error"), ...account, message: z.string() }),
]);
const resourceSchema = z.object({
  accountKey,
  id: z.string().min(1),
  providerId: z.string().min(1),
  label: z.string().min(1),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("shared") }),
    z.object({ kind: z.literal("host"), hostId: z.string().min(1), hostName: z.string().min(1) }),
  ]),
});
const observationSchema = z.object({
  accountKey,
  observedAt: z.number().int().nonnegative().nullable(),
  usage: usageSchema,
});

export const usageSourceContract = defineRpcContract({
  [LIST_RESOURCES]: {
    input: z.object({}),
    output: z.object({
      label: z.string().min(1).optional(),
      resources: z.array(resourceSchema),
    }),
  },
  [GET_RESOURCE]: {
    input: z.object({ resourceId: z.string().min(1), refresh: z.boolean() }),
    output: observationSchema,
  },
});

type Observation = z.infer<typeof observationSchema>;

// Resource ids are `[hostId, providerId]`, matching bb's built-in ACP source.
function resourceIdFor(hostId: string): string {
  return JSON.stringify([hostId, GROK_PROVIDER_ID]);
}

function hostIdFrom(resourceId: string): string {
  const parsed: unknown = JSON.parse(resourceId);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    parsed[1] !== GROK_PROVIDER_ID ||
    typeof parsed[0] !== "string"
  ) {
    throw new Error("Usage resource no longer exists.");
  }
  return parsed[0];
}

export function registerUsageSource(bb: BbPluginApi): void {
  const cache = new Map<string, Observation>();
  const inFlight = new Map<string, Promise<Observation>>();

  async function ownsProvider(hostId: string): Promise<boolean> {
    const providers = await bb.sdk.providers.list({ hostId, capability: "usage" });
    return providers.some((provider) => provider.id === GROK_PROVIDER_ID);
  }

  async function collect(resourceId: string, refresh: boolean): Promise<Observation> {
    const hostId = hostIdFrom(resourceId);
    const host = (await bb.sdk.hosts.list()).find((entry) => entry.id === hostId);
    if (host === undefined || !(await ownsProvider(hostId))) {
      throw new Error("Usage resource no longer exists.");
    }

    const previous = cache.get(resourceId);
    const unavailable = (message: string): Observation => ({
      accountKey: previous?.accountKey ?? null,
      observedAt: previous?.observedAt ?? null,
      usage: { status: "error", plan: null, accountEmail: null, planLabel: null, message },
    });
    if (host.status === "disconnected") return unavailable("Machine is disconnected.");

    if (
      !refresh &&
      previous?.usage.status === "ok" &&
      previous.observedAt !== null &&
      Date.now() - previous.observedAt < CACHE_MS
    ) {
      return previous;
    }

    try {
      const limits = await bb.sdk.system.usageLimits({ hostId, providerId: GROK_PROVIDER_ID });
      const usage = limits[GROK_PROVIDER_ID];
      if (usage === undefined) throw new Error("Provider returned no usage information.");
      const observation = observationSchema.parse({
        accountKey: null,
        observedAt: usage.status === "ok" ? Date.now() : (previous?.observedAt ?? null),
        usage: {
          ...usage,
          ...(usage.status === "ok"
            ? {
                windows: usage.windows.map((window, index) => ({
                  ...window,
                  kind: windowSchema.shape.kind.catch("custom").parse((window as { kind?: unknown }).kind),
                  model: windowSchema.shape.model.catch(null).parse((window as { model?: unknown }).model),
                  id: `${index}:${window.label}`,
                  cost: window.cost ?? null,
                })),
              }
            : {}),
        },
      });
      cache.set(resourceId, observation);
      return observation;
    } catch {
      return unavailable("Usage could not be collected from this machine.");
    }
  }

  bb.rpc.register(
    usageSourceContract,
    {
      async [LIST_RESOURCES]() {
        const hosts = await bb.sdk.hosts.list();
        const owning = await Promise.all(
          hosts.map(async (host) => ((await ownsProvider(host.id)) ? host : null)),
        );
        const resources = owning.flatMap((host) =>
          host === null
            ? []
            : [
                {
                  accountKey: cache.get(resourceIdFor(host.id))?.accountKey ?? null,
                  id: resourceIdFor(host.id),
                  providerId: GROK_PROVIDER_ID,
                  label: "Grok Build",
                  scope: { kind: "host" as const, hostId: host.id, hostName: host.name },
                },
              ],
        );
        const live = new Set(resources.map((resource) => resource.id));
        for (const key of cache.keys()) if (!live.has(key)) cache.delete(key);
        return { resources };
      },
      async [GET_RESOURCE]({ resourceId, refresh }) {
        // Coalesce concurrent reads; a forced refresh waits out a cached one.
        const pending = inFlight.get(resourceId);
        if (pending !== undefined) {
          const result = await pending.catch(() => undefined);
          if (result !== undefined && !refresh) return result;
        }
        const request = collect(resourceId, refresh).finally(() => {
          if (inFlight.get(resourceId) === request) inFlight.delete(resourceId);
        });
        inFlight.set(resourceId, request);
        return request;
      },
    },
    {
      experimental_discoverable: true,
      experimental_description: "Host-local Grok Build usage owned by the grok-build-usage plugin.",
    },
  );
}
