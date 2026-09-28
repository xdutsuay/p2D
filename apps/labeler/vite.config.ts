import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateDir = path.join(root, "data", "private");
const photosDir = path.join(privateDir, "photos");
const catalogPath = path.join(privateDir, "photo_catalog.json");
const graphPath = path.join(privateDir, "house_graph.json");

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function localApiPlugin(): Plugin {
  return {
    name: "p2d-local-api",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url?.split("?")[0] ?? "";

        if (url.startsWith("/api/photos/") && (req.method === "GET" || req.method === "HEAD")) {
          const name = decodeURIComponent(url.slice("/api/photos/".length));
          const file = path.join(photosDir, path.basename(name));
          if (!fs.existsSync(file)) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
          res.setHeader("Content-Type", "image/jpeg");
          res.setHeader("Content-Length", String(fs.statSync(file).size));
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          fs.createReadStream(file).pipe(res);
          return;
        }

        if (url === "/api/catalog" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(fs.readFileSync(catalogPath, "utf8"));
          return;
        }

        if (url === "/api/catalog" && req.method === "PUT") {
          const body = JSON.parse(await readBody(req));
          body.updated_at = new Date().toISOString();
          writeJson(catalogPath, body);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, updated_at: body.updated_at }));
          return;
        }

        if (url === "/api/house-graph" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(fs.readFileSync(graphPath, "utf8"));
          return;
        }

        if (url === "/api/house-graph" && req.method === "PUT") {
          const body = JSON.parse(await readBody(req));
          writeJson(graphPath, body);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (url === "/api/photo-list" && req.method === "GET") {
          const files = fs
            .readdirSync(photosDir)
            .filter((f: string) => /\.(jpe?g|png|webp)$/i.test(f))
            .sort();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ files }));
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  resolve: {
    alias: {
      "@p2d/schema": path.resolve(root, "packages/schema/types.ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
