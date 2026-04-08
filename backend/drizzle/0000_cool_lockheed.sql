CREATE TABLE "discover"."protocols" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"website_url" varchar(255),
	"logo_url" varchar(255),
	"audit_status" varchar(50),
	"auditors" text[],
	"launched_at" date,
	"integration" varchar(20) DEFAULT 'data_only',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "protocols_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "discover"."yield_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"protocol_id" integer NOT NULL,
	"external_id" varchar(255),
	"name" varchar(200) NOT NULL,
	"category" varchar(50) NOT NULL,
	"tokens" text[] NOT NULL,
	"apy_current" numeric(10, 4),
	"apy_7d_avg" numeric(10, 4),
	"apy_30d_avg" numeric(10, 4),
	"tvl_usd" numeric(20, 2),
	"min_deposit" numeric(20, 6),
	"lock_period_days" integer DEFAULT 0,
	"risk_tier" varchar(20),
	"deposit_address" varchar(255),
	"protocol_name" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"extra_data" jsonb,
	"max_leverage" numeric(6, 2),
	"utilization_pct" numeric(6, 2),
	"liquidity_available_usd" numeric(20, 2),
	"is_automated" boolean,
	"depeg" numeric(10, 6),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "yield_opportunities_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "discover"."yield_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"apy" numeric(10, 4),
	"tvl_usd" numeric(20, 2),
	"snapshot_at" timestamp NOT NULL,
	"source" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "manage"."api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"is_active" boolean DEFAULT true NOT NULL,
	"rate_limit" integer DEFAULT 100
);
--> statement-breakpoint
CREATE TABLE "monitor"."tracked_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_address" varchar(255) NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"fetch_status" varchar(20) DEFAULT 'pending' NOT NULL,
	CONSTRAINT "tracked_wallets_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "monitor"."user_position_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_address" varchar(255) NOT NULL,
	"protocol_slug" varchar(50) NOT NULL,
	"product_type" varchar(50) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"amount" numeric(30, 10),
	"amount_usd" numeric(20, 2),
	"tx_signature" varchar(255),
	"event_at" timestamp NOT NULL,
	"extra_data" jsonb,
	CONSTRAINT "user_position_events_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE "monitor"."user_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_address" varchar(255) NOT NULL,
	"protocol_slug" varchar(50) NOT NULL,
	"product_type" varchar(50) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"opportunity_id" integer,
	"deposit_amount" numeric(30, 10),
	"deposit_amount_usd" numeric(20, 2),
	"pnl_usd" numeric(20, 2),
	"pnl_pct" numeric(10, 4),
	"initial_deposit_usd" numeric(20, 2),
	"opened_at" timestamp,
	"held_days" numeric(10, 4),
	"apy" numeric(10, 4),
	"apy_realized" numeric(10, 4),
	"is_closed" boolean,
	"closed_at" timestamp,
	"close_value_usd" numeric(20, 2),
	"token_symbol" varchar(50),
	"extra_data" jsonb,
	"snapshot_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "discover"."yield_opportunities" ADD CONSTRAINT "yield_opportunities_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "discover"."protocols"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover"."yield_snapshots" ADD CONSTRAINT "yield_snapshots_opportunity_id_yield_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "discover"."yield_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_yo_protocol_id" ON "discover"."yield_opportunities" USING btree ("protocol_id");--> statement-breakpoint
CREATE INDEX "idx_yo_active_apy" ON "discover"."yield_opportunities" USING btree ("is_active","apy_current");--> statement-breakpoint
CREATE INDEX "idx_yo_active_tvl" ON "discover"."yield_opportunities" USING btree ("is_active","tvl_usd");--> statement-breakpoint
CREATE INDEX "idx_yo_category" ON "discover"."yield_opportunities" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_yo_protocol_external" ON "discover"."yield_opportunities" USING btree ("protocol_id","external_id");--> statement-breakpoint
CREATE INDEX "idx_ys_opp_snap" ON "discover"."yield_snapshots" USING btree ("opportunity_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "idx_ys_snap_at" ON "discover"."yield_snapshots" USING btree ("snapshot_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "manage"."api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "idx_tw_wallet" ON "monitor"."tracked_wallets" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_upe_wallet" ON "monitor"."user_position_events" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_up_wallet_snap" ON "monitor"."user_positions" USING btree ("wallet_address","snapshot_at");--> statement-breakpoint
CREATE INDEX "idx_up_wallet_ext" ON "monitor"."user_positions" USING btree ("wallet_address","external_id");--> statement-breakpoint
CREATE INDEX "idx_up_wallet_proto" ON "monitor"."user_positions" USING btree ("wallet_address","protocol_slug");