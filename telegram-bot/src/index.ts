import "dotenv/config";
import { createServer } from "http";
import { run } from "@grammyjs/runner";
import { webhookCallback } from "grammy";
import { bot } from "./bot.js";

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

  const handleUpdate = webhookCallback(bot, "http", {
    secretToken: SECRET,
  });

  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/webhook") {
      try {
        await handleUpdate(req, res);
      } catch (err) {
        console.error("Webhook handler error:", err);
        res.writeHead(500).end();
      }
    } else if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", mode: "webhook" }));
    } else {
      res.writeHead(404).end();
    }
  });

  server.listen(PORT, () => {
    console.log(`Bot running (webhook mode, port ${PORT}).`);
  });

  // Graceful shutdown with drain timeout
  const shutdown = () => {
    console.log("Shutting down...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  // ---------- Local dev: Long polling mode ----------
  await bot.api.deleteWebhook();

  const runner = run(bot);
  console.log("Bot running (polling mode — set WEBHOOK_URL for production).");

  const shutdown = () => runner.isRunning() && runner.stop();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
