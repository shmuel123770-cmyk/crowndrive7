-- Bring the live application tables under managed migrations and index them
-- for the site's per-second polling. These tables were previously created ad-hoc
-- at runtime; IF NOT EXISTS keeps this migration safe on branches where they
-- already exist while creating them cleanly where they do not.

-- Main record store: one row per record, keyed by (collection, id).
CREATE TABLE IF NOT EXISTS "crown_records" (
	"collection" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY ("collection", "id")
);
--> statement-breakpoint

-- Credentials: passwords are stored only as scrypt hashes (salt:hash).
CREATE TABLE IF NOT EXISTS "crown_auth" (
	"uid" text PRIMARY KEY,
	"email" text UNIQUE NOT NULL,
	"pass" text,
	"pass_hash" text,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "crown_auth" ADD COLUMN IF NOT EXISTS "pass_hash" text;
--> statement-breakpoint

-- Sessions: only a SHA-256 hash of each token is stored, never the token.
CREATE TABLE IF NOT EXISTS "crown_sessions" (
	"token_hash" text PRIMARY KEY,
	"uid" text NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"expires_at" timestamptz NOT NULL
);
--> statement-breakpoint

-- Indexes for the hot paths hit every second by the live feeds:
-- list by collection ordered by recency ...
CREATE INDEX IF NOT EXISTS "idx_crown_records_collection_updated"
	ON "crown_records" ("collection", "updated_at" DESC);
--> statement-breakpoint
-- ... and filtered queries over JSON fields (data ->> field, data @> ...).
CREATE INDEX IF NOT EXISTS "idx_crown_records_data_gin"
	ON "crown_records" USING gin ("data");
--> statement-breakpoint
-- Session lookups by token validity and cleanup by user.
CREATE INDEX IF NOT EXISTS "idx_crown_sessions_expires"
	ON "crown_sessions" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crown_sessions_uid"
	ON "crown_sessions" ("uid");
