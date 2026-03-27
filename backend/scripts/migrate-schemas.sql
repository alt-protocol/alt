-- Move tables from public schema to dedicated module schemas.
-- Safe to run multiple times (IF NOT EXISTS + conditional moves).
-- Preserves data, indexes, sequences, and constraints.

BEGIN;

-- Create dedicated schemas
CREATE SCHEMA IF NOT EXISTS discover;
CREATE SCHEMA IF NOT EXISTS manage;
CREATE SCHEMA IF NOT EXISTS monitor;

-- Move Discover tables
ALTER TABLE IF EXISTS public.protocols SET SCHEMA discover;
ALTER TABLE IF EXISTS public.yield_opportunities SET SCHEMA discover;
ALTER TABLE IF EXISTS public.yield_snapshots SET SCHEMA discover;

-- Move Manage tables
ALTER TABLE IF EXISTS public.api_keys SET SCHEMA manage;

-- Move Monitor tables
ALTER TABLE IF EXISTS public.tracked_wallets SET SCHEMA monitor;
ALTER TABLE IF EXISTS public.user_positions SET SCHEMA monitor;
ALTER TABLE IF EXISTS public.user_position_events SET SCHEMA monitor;

COMMIT;
