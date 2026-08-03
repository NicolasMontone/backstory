import { registerSessionProvider, sessionProviders } from "./registry.ts";
import { codexProvider } from "./codex.ts";
import { claudeProvider } from "./claude.ts";

// Register the built-in providers. To add an agent: implement a
// JsonlSessionProvider (see base.ts) and register it here.
registerSessionProvider(codexProvider);
registerSessionProvider(claudeProvider);

export { registerSessionProvider, sessionProviders, sessionProvider } from "./registry.ts";
export { JsonlSessionProvider } from "./base.ts";
export type { Provider, ParsedSession, SessionRecord, PromptRecord } from "./types.ts";
