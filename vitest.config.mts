import { defineConfig } from "vitest/config";
import path from "node:path";

const staging = process.env.VITEST_STAGING === "1";

export default defineConfig({
  test: {
    environment: "node",
    include: staging ? ["tests/staging/**/*.test.ts"] : ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    env: { NODE_ENV: "test", DATA_PROVIDER: staging ? "mssql" : "mock", AUTH_DEV_LOGIN: "true", APP_STORE: "memory", APP_STORE_FILE: "" },
    testTimeout: staging ? 180_000 : 5_000,
    hookTimeout: staging ? 60_000 : 10_000,
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
