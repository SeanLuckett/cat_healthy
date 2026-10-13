import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [".."],
    },
    proxy: {
      "/api": {
        // 127.0.0.1, not localhost: the server binds IPv4 only (0.0.0.0) and
        // Node may resolve localhost to ::1 first, giving ECONNREFUSED.
        target: "http://127.0.0.1:3000",
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
  },
});
