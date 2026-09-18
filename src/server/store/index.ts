import { getConfig } from "../db/config";
import { MemoryAppStore } from "./memory";
import { MssqlAppStore } from "./mssql";
import type { AppStore } from "./types";

// Shared across separately bundled Next routes within one process.
const g = globalThis as unknown as { __jadiAppStore?: AppStore | null };

/**
 * APP_STORE=memory (default; JSON file at APP_STORE_FILE if set) or APP_STORE=mssql (DASH_CONNECTION_STRING).
 * In mock-data mode the memory store keeps the whole snapshot pipeline runnable without a database.
 */
export function getAppStore(): AppStore {
  if (g.__jadiAppStore) return g.__jadiAppStore;
  const cfg = getConfig();
  g.__jadiAppStore = cfg.APP_STORE === "mssql" ? new MssqlAppStore() : new MemoryAppStore(cfg.APP_STORE_FILE || undefined);
  return g.__jadiAppStore;
}

export function setAppStoreForTests(store: AppStore | null): void {
  g.__jadiAppStore = store;
}
