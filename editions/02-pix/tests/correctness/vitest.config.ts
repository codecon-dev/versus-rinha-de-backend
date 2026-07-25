import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cenários de concorrência esperam o worker liquidar centenas de transferências
    testTimeout: 60_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
