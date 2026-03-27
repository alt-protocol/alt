import {
  pgSchema,
  serial,
  varchar,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const manageSchema = pgSchema("manage");

export const apiKeys = manageSchema.table(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    key_hash: varchar("key_hash", { length: 64 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    created_at: timestamp("created_at").defaultNow(),
    is_active: boolean("is_active").default(true).notNull(),
    rate_limit: integer("rate_limit").default(100), // requests per minute
  },
  (table) => [uniqueIndex("api_keys_key_hash_idx").on(table.key_hash)],
);
