// Re-export shared DB connection.
// During migration, tables remain in the `public` schema.
export { db } from "../../shared/db.js";
