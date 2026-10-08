import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Many tests start an in-memory Postgres (PGlite), which can take seconds when the
    // machine is busy (CI, or several test runs at once); 5 s made them fail at random.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
