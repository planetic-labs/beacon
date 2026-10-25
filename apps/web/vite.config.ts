import { defineConfig } from "vite";
import { shellCache } from "./build/shell-cache";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), shellCache()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    fs: { allow: ["./", "../../packages/shared", "../../node_modules"].map(path => fileURLToPath(new URL(path, import.meta.url))) },
  },
  build: { sourcemap: false },
});
