import http from "node:http";
import net from "node:net";

const server = http.createServer((req, res) => {
  const options = {
    hostname: "127.0.0.1",
    port: 8080,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: "localhost:8080" },
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Proxy error: " + e.message);
  });
  req.pipe(proxyReq, { end: true });
});

server.on("upgrade", (req, socket, head) => {
  const proxySocket = net.connect(8080, "127.0.0.1", () => {
    proxySocket.write(head);
    socket.pipe(proxySocket).pipe(socket);
  });
  proxySocket.on("error", () => socket.destroy());
});

server.listen(8081, "0.0.0.0", () => {
  console.log("Proxy active on http://localhost:8081 -> http://localhost:8080");
});
