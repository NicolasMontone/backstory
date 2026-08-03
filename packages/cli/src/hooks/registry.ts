import type { HookProvider } from "./types.ts";

const registry = new Map<string, HookProvider>();

export function registerHookProvider(provider: HookProvider): void {
  registry.set(provider.name, provider);
}

export function hookProviders(): HookProvider[] {
  return [...registry.values()];
}

export function hookProvider(name: string): HookProvider | undefined {
  return registry.get(name);
}
