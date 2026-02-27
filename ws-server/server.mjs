import http from "http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 3000);

function klog(kind, data) {
  const payload = data && typeof data === "object" ? ` ${JSON.stringify(data)}` : "";
  process.stdout.write(`[klog] ${kind}${payload}\n`);
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.send("connected");

  ws.on("message", (msg) => {
    ws.send("echo:" + msg.toString());
  });
});

server.listen(PORT, "0.0.0.0", () => {
  klog("ws_listening", { message: `WS listening on ${PORT}`, port: PORT });
});
