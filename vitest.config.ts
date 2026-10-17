import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", hookTimeout: 30000, include: ["tests/**/*.test.ts"], fileParallelism: false } });
