import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    // Most tests activate commitments at the real current time; without this, whether Day 1 starts
    // today or tomorrow would depend on what time of day the suite happens to run. Tests of the
    // late-start rule set it explicitly.
    env: { PAYMENT_MIN_START_HOURS: '0' },
  },
});
