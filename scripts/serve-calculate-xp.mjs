import http from "node:http";
import { handler } from "../netlify/functions/calculate-xp.mjs";

const PATH = "/.netlify/functions/calculate-xp";

const server = http.createServer(async (req, res) => {
  const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value]));
  if (req.url !== PATH) { res.writeHead(404).end("Not found"); return; }

  if (req.method === "OPTIONS") {
    const result = await handler({ httpMethod: "OPTIONS", headers });
    res.writeHead(result.statusCode || 204, result.headers || {}).end(result.body || "");
    return;
  }
  if (req.method !== "POST") { res.writeHead(405).end("method_not_allowed"); return; }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    const result = await handler({ httpMethod: "POST", headers, body });
    res.writeHead(result.statusCode ?? 200, result.headers || {}).end(result.body || "");
  });
});

server.listen(8888, () => {
  process.stdout.write(`Local function ready: http://localhost:8888${PATH}\n`);
});
