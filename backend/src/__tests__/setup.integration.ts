/**
 * Integration test setup.
 * Uses real Postgres (Docker). The global-setup ensures schema is pushed.
 *
 * Note: We do NOT truncate tables between tests because:
 * 1. The test app holds DB connections that can deadlock with truncation
 * 2. Existing integration tests depend on pre-seeded data
 * 3. Tests should seed their own data and not depend on clean state
 *
 * The app singleton is shared across all integration tests for performance.
 */
import "dotenv/config";
