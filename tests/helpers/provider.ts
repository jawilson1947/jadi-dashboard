import type { DataProvider } from "@/server/repositories/types";

/** Override selected methods of a provider instance without losing its prototype methods. */
export function withOverrides(base: DataProvider, overrides: Partial<DataProvider>): DataProvider {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop in overrides) return (overrides as Record<string | symbol, unknown>)[prop];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
