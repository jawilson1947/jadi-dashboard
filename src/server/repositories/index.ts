import { getConfig } from "../db/config";
import { MockDataProvider } from "./mock/provider";
import { MssqlDataProvider } from "./mssql/provider";
import type { DataProvider } from "./types";

const g = globalThis as unknown as { __jadiProvider?: DataProvider | null };

/** Every DataProvider method. A cached instance from before a dev hot-reload that lacks one is rebuilt instead of reused. */
const REQUIRED_METHODS: (keyof DataProvider)[] = ["getSourceInfo", "getTermMetadata", "getEnrollmentClearance", "getCurrentReceivable", "getChargesCredits", "getDnrDncSummary", "getClassificationCounts", "getStudentsForPopulation"];

function isCurrentShape(p: DataProvider): boolean {
  return REQUIRED_METHODS.every((m) => typeof (p as unknown as Record<string, unknown>)[m] === "function");
}

/** Returns the process-wide DataProvider selected by DATA_PROVIDER. */
export function getDataProvider(): DataProvider {
  if (g.__jadiProvider && isCurrentShape(g.__jadiProvider)) return g.__jadiProvider;
  const { DATA_PROVIDER } = getConfig();
  g.__jadiProvider = DATA_PROVIDER === "mssql" ? new MssqlDataProvider() : new MockDataProvider();
  return g.__jadiProvider;
}

/** Test helper — inject a provider. */
export function setDataProviderForTests(provider: DataProvider | null): void {
  g.__jadiProvider = provider;
}
