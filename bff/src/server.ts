import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createYoga } from "graphql-yoga";
import { env } from "./env";
import { schema } from "./schema";

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  cors: {
    origin: env.corsOrigin,
    credentials: true,
  },
});

/** Proxy multipart uploads straight through to the backend (no parsing here). */
async function proxyUpload(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  try {
    const upstream = await fetch(`${env.backendUrl}/uploads`, {
      method: "POST",
      headers: { "content-type": req.headers["content-type"] ?? "" },
      body,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "access-control-allow-origin": env.corsOrigin,
    });
    res.end(text);
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: `upload proxy failed: ${String(err)}` }));
  }
}

const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/upload") && req.method === "POST") {
    void proxyUpload(req, res);
    return;
  }
  void yoga(req, res);
});

server.listen(env.port, () => {
  console.log(`BFF ready at http://localhost:${env.port}/graphql`);
});
