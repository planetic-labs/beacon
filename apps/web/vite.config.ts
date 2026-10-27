import { defineConfig } from "vite";
import { shellCache } from "./build/shell-cache";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {version:string};

export default defineConfig({
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(version), "import.meta.env.VITE_BUILD_TIME": JSON.stringify(new Date().toISOString()) },
  plugins: [react(), shellCache()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    fs: { allow: ["./", "../../packages/shared", "../../node_modules"].map(path => fileURLToPath(new URL(path, import.meta.url))) },
  },
  build: { sourcemap: false },
});
