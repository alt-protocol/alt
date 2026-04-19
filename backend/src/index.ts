import "dotenv/config";
import { buildApp } from "./app.js";

const REQUIRED_ENV = ["DATABASE_URL", "HELIUS_API_KEY", "HELIUS_RPC_URL"];

function validateEnv() {
  const missing = REQUIRED_ENV.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  const port = Number(process.env.PORT ?? 8001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  if (process.env.MANAGE_AUTH_DISABLED === "true" && process.env.NODE_ENV === "production") {
    throw new Error("MANAGE_AUTH_DISABLED cannot be true in production");
  }
}

async function main() {
  validateEnv();

  const app = await buildApp();
  const port = Number(process.env.PORT ?? 8001);

  await app.listen({ port, host: "0.0.0.0" });

  const shutdown = async () => {
    app.log.info("Shutting down...");
    const forceExit = setTimeout(() => {
      app.log.error("Graceful shutdown timeout — forcing exit");
      process.exit(1);
    }, 30_000);
    await app.close();
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
