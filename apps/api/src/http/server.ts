import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import staticFiles from "@fastify/static";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fromNodeHeaders } from "better-auth/node";
import { GET as v1, POST as v1Post, PATCH as v1Patch } from "./controllers/v1";
import { GET as authGet, POST as authPost } from "./controllers/auth";
import { GET as pushGet, POST as pushPost, PATCH as pushPatch, DELETE as pushDelete } from "./controllers/push";
import { POST as avatar } from "./controllers/avatar";
import { GET as media } from "./controllers/media";
import { GET as health } from "./controllers/health";
import { GET as openid } from "./controllers/openid";
import { GET as oauthMetadata } from "./controllers/oauth-metadata";

type Handler = (request: Request) => Promise<Response> | Response;
const webRoot = fileURLToPath(new URL("../../../web/", import.meta.url));

export async function createApp(options: { dev?: boolean; serveWeb?: boolean } = {}) {
  const app = Fastify({
    logger: false,
    bodyLimit: 6 * 1024 * 1024,
    routerOptions: { maxParamLength: 2048 },
  });
  // Preserve JSON, OAuth form bodies and multipart bytes for Fetch API controllers.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (!status || status >= 500) console.error("ERROR HTTP request failed");
    reply.code(status && status >= 400 && status < 500 ? status : 500)
      .header("Cache-Control", "no-store").send({ error: status === 413 ? "Слишком большой запрос" : "Не удалось выполнить запрос" });
  });
  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (!request.url.startsWith("/assets/")) reply.header("Cache-Control", "no-store");
  });
  function bridge(handler: Handler) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // Keep the configured issuer stable; never derive it from an untrusted Host.
      const url = new URL(process.env.APP_URL!);
      const incoming = new URL(request.raw.url!, "http://request.invalid");
      url.pathname = incoming.pathname; url.search = incoming.search;
      const init: RequestInit = { method: request.method, headers: fromNodeHeaders(request.headers) };
      if (request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined)
        init.body = new Uint8Array(request.body as Buffer).buffer;
      const response = await handler(new Request(url, init));
      reply.code(response.status);
      response.headers.forEach((value, key) => { if (key !== "set-cookie") reply.header(key, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    };
  }
  app.get("/api/health", bridge(() => health()));
  for (const [method, handler] of [["GET", authGet], ["POST", authPost]] as const)
    app.route({ method, url: "/api/auth/*", handler: bridge(handler) });
  for (const [method, handler] of [["GET", v1], ["POST", v1Post], ["PATCH", v1Patch]] as const)
    app.route({ method, url: "/api/v1/*", handler: bridge(request => handler(request,
      new URL(request.url).pathname.slice("/api/v1/".length).split("/").map(decodeURIComponent),
    )) });
  for (const [method, handler] of [["GET", pushGet], ["POST", pushPost], ["PATCH", pushPatch], ["DELETE", pushDelete]] as const) {
    const run = bridge(request => handler(request,
      new URL(request.url).pathname.slice("/api/push".length).split("/").filter(Boolean).map(decodeURIComponent),
    ));
    app.route({ method, url: "/api/push", handler: run });
    app.route({ method, url: "/api/push/*", handler: run });
  }
  app.post("/api/avatar", bridge(avatar));
  app.get("/media/:id", bridge(request => media(request,
    decodeURIComponent(new URL(request.url).pathname.slice("/media/".length)),
  )));
  app.get("/.well-known/openid-configuration", bridge(openid));
  app.get("/.well-known/oauth-authorization-server", bridge(oauthMetadata));

  let index: () => Promise<string>;
  if (options.serveWeb === false) index = async () => "";
  else if (options.dev) {
    const [{ createServer }, { default: middie }] = await Promise.all([import("vite"), import("@fastify/middie")]);
    const origin = new URL(process.env.APP_URL!);
    const vite = await createServer({
      root: webRoot, configFile: `${webRoot}vite.config.ts`, appType: "custom",
      server: { middlewareMode: true, cors: false, allowedHosts: [origin.hostname],
        hmr: { server: app.server, path: "/__vite_hmr", clientPort: Number(origin.port) || (origin.protocol === "https:" ? 443 : 80) } },
    });
    await app.register(middie);
    app.use(vite.middlewares);
    index = async () => vite.transformIndexHtml("/", await readFile(`${webRoot}index.html`, "utf8"));
    app.addHook("onClose", async () => { await vite.close(); });
  } else {
    await app.register(staticFiles, {
      root: `${webRoot}dist`, wildcard: false,
      setHeaders(response, filename) {
        if (filename.includes("/assets/")) response.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    });
    index = async () => readFile(`${webRoot}dist/index.html`, "utf8");
  }
  app.setNotFoundHandler(async (request, reply) => {
    const path = new URL(request.url, "http://request.invalid").pathname;
    const reserved = ["/api", "/media", "/.well-known", "/socket.io", "/assets", "/src", "/@fs", "/@vite", "/node_modules"]
      .some(prefix => path === prefix || path.startsWith(`${prefix}/`));
    if (options.serveWeb !== false && request.method === "GET" && !reserved &&
      (path === "/" || request.headers.accept?.includes("text/html")))
      return reply.type("text/html; charset=utf-8").send(await index());
    return reply.code(404).send({ error: "Не найдено" });
  });
  return app;
}
