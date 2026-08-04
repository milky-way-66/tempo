import { defineConfig } from "vitest/config";

// Tests are organized by scope under test/:
//   unit        — pure logic, no filesystem or process boundary (fast)
//   integration — the engine wired to the on-disk store and board render
//   e2e         — the MCP server driven end-to-end over the protocol
// `npm test` runs them all; run one scope with `npm run test:unit`
// (or test:integration / test:e2e), which just filters by directory.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
