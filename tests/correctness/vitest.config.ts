import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 10_000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
