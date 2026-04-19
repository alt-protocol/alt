import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { logger } from "./logger.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected database pool error");
});

export const db = drizzle(pool);
export { pool };
