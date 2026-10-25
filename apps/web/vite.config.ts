import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    headers: { "Cache-Control": "no-store" },
    fs: { allow: ["./", "../../packages/shared", "../../node_modules"].map(path => fileURLToPath(new URL(path, import.meta.url))) },
  },
  build: { sourcemap: false },
});
