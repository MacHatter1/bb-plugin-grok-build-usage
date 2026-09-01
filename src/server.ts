import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { AcpLaunchSpec } from "@get-bb/plugin-sdk/provider-bridge/acp";

const GROK_LAUNCH_SPEC = {
  displayName: "Grok Build",
  command: "grok",
  args: ["agent", "stdio"],
  env: {},
  modelCli: {
    listArgs: ["models"],
    selectFlag: "--model",
    primaryModels: ["grok-4.5", "grok-composer-2.5-fast"],
  },
  permissionCli: {
    full: ["--always-approve"],
    insertAfterArgs: 1,
  },
  reasoningCli: {
    flag: "--reasoning-effort",
    supportedLevels: ["low", "medium", "high"],
    levelValues: {
      none: "low",
      xhigh: "high",
      ultracode: "high",
      max: "high",
    },
    defaultLevel: "high",
  },
  nativeSkillRoots: {
    user: [{ path: ".agents/skills", recursive: true }],
    project: [
      { path: ".grok/skills", recursive: true, ancestors: true },
      { path: ".agents/skills", recursive: true, ancestors: true },
    ],
  },
} satisfies AcpLaunchSpec;

export default function plugin(bb: BbPluginApi) {
  bb.providers.register({
    // `acp-grok` is owned by bb's built-in ACP plugin. This companion id keeps
    // the existing execution provider untouched while adding usage support.
    id: "grok-build-usage",
    displayName: "Grok Build",
    family: "grok-build",
    icon: "./assets/icons/grok.svg",
    experimental_bridgeOptions: {
      acpDialect: "grok",
      acpLaunchSpec: GROK_LAUNCH_SPEC,
    },
    experimental_visibility: "installed",
    maintenance: {
      health: true,
      usage: true,
    },
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high"],
    },
    composerActions: ["goal", "plan"],
    strings: {
      signInHint: "Run `grok login` on the machine to sign in.",
      expiredHint: "Your Grok Build session expired. Run `grok login`, then reload.",
      installUrl: "https://docs.x.ai/build/overview",
      brandPrefix: "Grok ",
      planModeCopy: "Grok Build plan mode",
    },
    serviceTiers: [
      { id: "default", label: "Default" },
      { id: "fast", label: "Fast" },
    ],
    reasoningLevels: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
    ],
    models: { scope: "host" },
    experimental_nativeSkillRoots: GROK_LAUNCH_SPEC.nativeSkillRoots,
  });
}
