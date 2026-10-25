import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import type { Plugin } from "vite";

export function shellCache(): Plugin {
  const version = randomUUID();
  let output: string;
  return {
    name: "beacon-shell-cache",
    apply: "build",
    config: () => ({ define: { "import.meta.env.VITE_SHELL_VERSION": JSON.stringify(version) } }),
    configResolved: config => { output = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const urls: string[] = [];
      async function scan(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const filename = resolve(directory, entry.name);
          if (entry.isDirectory()) { await scan(filename); continue; }
          const path = relative(output, filename).replaceAll("\\", "/");
          // Only build output and explicitly public shell resources; never API or media.
          if (/^assets\/.*\.(?:js|css|png|jpe?g|webp|svg|gif|woff2?|ttf|ico)$/.test(path)
            || ["index.html", "offline.html", "icon.svg", "icon-192.png", "icon-512.png", "manifest.webmanifest"].includes(path))
            urls.push(`/${path}`);
        }
      }
      await scan(output);
      const filename = resolve(output, "sw.js");
      const worker = await readFile(filename, "utf8");
      const marker = "/* BEACON_SHELL */ null";
      if (!worker.includes(marker)) throw new Error("Missing shell manifest marker");
      await writeFile(filename, worker.replace(marker, JSON.stringify({ version, urls: urls.sort() })));
    },
  };
}
