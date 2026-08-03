import { registerHookProvider } from "./registry.ts";
import { gitPostCommitHook } from "./git-post-commit.ts";

// Register the built-in hook providers. To add one: implement HookProvider
// (see types.ts) and register it here.
registerHookProvider(gitPostCommitHook);

export { registerHookProvider, hookProviders, hookProvider } from "./registry.ts";
export { recordHook } from "./git-post-commit.ts";
export type { HookProvider, HookStatus, HookInstallResult } from "./types.ts";
