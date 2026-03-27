// Re-export shared DB connection.
// During migration, tables remain in the `public` schema.
// When schemas are split, this file will configure the manage search_path.
export { db } from "../../shared/db.js";
