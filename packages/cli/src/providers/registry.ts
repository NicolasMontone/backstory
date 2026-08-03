import type { Provider } from "./types.ts";

const registry = new Map<string, Provider>();

/** Register a session provider. Later registration of the same name wins. */
export function registerSessionProvider(provider: Provider): void {
  registry.set(provider.name, provider);
}

/** All registered session providers, in registration order. */
export function sessionProviders(): Provider[] {
  return [...registry.values()];
}

/** Look up a single provider by name. */
export function sessionProvider(name: string): Provider | undefined {
  return registry.get(name);
}
