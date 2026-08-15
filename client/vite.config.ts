import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) },
  },
  // library mode doesn't shim process.env for CJS deps (e.g. prop-types) —
  // our consumer is the raw browser, so define it ourselves
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/widget.tsx", import.meta.url)),
      name: "MiniChat",
      formats: ["iife"],
      fileName: () => "mini-chat.js",
    },
  },
});
