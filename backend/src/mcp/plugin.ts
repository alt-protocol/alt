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
 *
 * Write tools (build_deposit_tx, build_withdraw_tx, submit_transaction, build_swap_tx)
 * require an API key via Authorization: Bearer <key> header.
 * Read tools (search_yields, get_portfolio, etc.) are open.
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

      // Extract auth and agent context from HTTP request
      const authHeader = request.headers.authorization;
      const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const agentId = (request.headers["x-agent-id"] as string) ?? "anonymous";

      const server = createMcpServer({ bearerToken, agentId });
      await server.connect(transport);

      // MCP endpoint allows all origins — agents call from CLIs, desktop apps, web.
      // Non-custodial design means CORS is not a security boundary here.
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");
      reply.raw.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
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
