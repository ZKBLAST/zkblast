import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../target/browser-benchmark");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".gz": "application/octet-stream", ".wasm": "application/wasm" };
createServer(async (request, response) => {
  const pathname = request.url === "/" ? "/index.html" : request.url;
  const file = path.join(root, pathname);
  try {
    await stat(file);
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(18547, "127.0.0.1", () => console.log("http://127.0.0.1:18547"));
