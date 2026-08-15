import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) },
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
