import http from "node:http";
import { handler } from "../netlify/functions/award-xp.mjs";

const PATH = "/.netlify/functions/award-xp";

const server = http.createServer(async (req, res) => {
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k, Array.isArray(v)?v.join(','):v]));
  if (req.url !== PATH) { res.writeHead(404).end("Not found"); return; }

  if (req.method === "OPTIONS") {
    const r = await handler({ httpMethod: "OPTIONS", headers });
    res.writeHead(r.statusCode || 204, r.headers || {}).end(r.body || "");
    return;
  }

  if (req.method !== "POST") { res.writeHead(405).end("method_not_allowed"); return; }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const r = await handler({ httpMethod: "POST", headers, body });
    res.writeHead(r.statusCode ?? 200, r.headers || {}).end(r.body || "");
  });
});

server.listen(8888, () => {
  console.log(`Local function ready: http://localhost:8888${PATH}`);
});
