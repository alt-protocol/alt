import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

/**
 * Fastify plugin that exposes the MCP server over Streamable HTTP.
 *
 * Register with: app.register(mcpPlugin, { prefix: "/api/mcp" })
 *
 * AI agents connect via:
 *   POST https://your-app.railway.app/api/mcp
 */
export async function mcpPlugin(app: FastifyInstance) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.post(
    "/",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const server = createMcpServer();
      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
      await transport.close();
      await server.close();
    },
  );

  app.get("/", async (_request, reply) => {
    reply.status(405).send({ error: "SSE not supported (stateless mode)" });
  });

  app.delete("/", async (_request, reply) => {
    reply.status(405).send({ error: "Session management not supported (stateless mode)" });
  });
}
