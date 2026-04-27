import "dotenv/config";
import { createServer, type IncomingMessage } from "http";
import { run } from "@grammyjs/runner";
import { bot } from "./bot.js";
import { startAlertPoller } from "./services/alert-poller.js";

// Startup validations
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY) {
  console.warn("WARNING: ENCRYPTION_KEY not set — /settings apikey will fail.");
}
if (!process.env.PLATFORM_ANTHROPIC_KEY) {
  console.warn("WARNING: PLATFORM_ANTHROPIC_KEY not set — free tier chat disabled.");
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

console.log("Starting Akashi Telegram Bot...");

// Register commands with Telegram
await bot.api.setMyCommands([
  { command: "start", description: "Register with Akashi" },
  { command: "connect", description: "Link your Solana wallet" },
  { command: "settings", description: "View/update settings" },
  { command: "usage", description: "View token usage and costs" },
  { command: "soul", description: "Customize bot personality" },
  { command: "reset", description: "Clear all data and start fresh" },
]);

const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (WEBHOOK_URL) {
  // ---------- Production: Webhook mode ----------
  const PORT = Number(process.env.PORT) || 3000;
  const SECRET = process.env.WEBHOOK_SECRET;

  if (!SECRET) {
    console.error("WEBHOOK_SECRET is required in webhook mode");
    process.exit(1);
  }

  await bot.api.setWebhook(`${WEBHOOK_URL}/webhook`, {
    secret_token: SECRET,
  });

  // --- Deduplication: LRU set of recently processed update IDs ---
  const processedUpdates = new Set<number>();
  const MAX_DEDUP_SIZE = 10_000;
  setInterval(() => processedUpdates.clear(), 5 * 60 * 1000);

  // --- In-flight tracking for graceful drain ---
  let inflight = 0;
  let draining = false;

  function parseBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });
  }

  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/webhook") {
      // Verify secret token
      if (req.headers["x-telegram-bot-api-secret-token"] !== SECRET) {
        res.writeHead(403).end();
        return;
      }

      let body: any;
      try {
        body = await parseBody(req);
      } catch {
        res.writeHead(400).end();
        return;
      }

      // Deduplicate
      const updateId: number = body.update_id;
      if (processedUpdates.has(updateId) || draining) {
        res.writeHead(200).end();
        return;
      }
      if (processedUpdates.size >= MAX_DEDUP_SIZE) processedUpdates.clear();
      processedUpdates.add(updateId);

      // Acknowledge immediately — prevents Telegram retries
      res.writeHead(200).end();

      // Process in background
      inflight++;
      bot.handleUpdate(body).catch((err) => {
        console.error("Update handler error:", err);
      }).finally(() => {
        inflight--;
      });
    } else if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", mode: "webhook", inflight }));
    } else {
      res.writeHead(404).end();
    }
  });

  server.listen(PORT, () => {
    console.log(`Bot running (webhook mode, port ${PORT}).`);
    startAlertPoller(bot);
  });

  // Graceful shutdown: stop accepting, drain in-flight, then exit
  const shutdown = () => {
    console.log("Shutting down, draining in-flight requests...");
    draining = true;
    server.close(() => {});

    const drainInterval = setInterval(() => {
      if (inflight === 0) {
        clearInterval(drainInterval);
        console.log("Drain complete, exiting.");
        process.exit(0);
      }
    }, 500);

    // Hard exit after 30s
    setTimeout(() => {
      console.warn(`Force exit with ${inflight} in-flight requests.`);
      process.exit(0);
    }, 30_000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  // ---------- Local dev: Long polling mode ----------
  await bot.api.deleteWebhook();

  const runner = run(bot);
  console.log("Bot running (polling mode — set WEBHOOK_URL for production).");
  startAlertPoller(bot);

  const shutdown = () => runner.isRunning() && runner.stop();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
