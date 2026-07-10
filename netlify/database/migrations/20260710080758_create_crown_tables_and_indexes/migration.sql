CREATE TABLE IF NOT EXISTS "crown_auth" (
	"uid" text PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"pass" text,
	"pass_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crown_records" (
	"collection" text,
	"id" text,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crown_records_pkey" PRIMARY KEY("collection","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crown_sessions" (
	"token_hash" text PRIMARY KEY,
	"uid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crown_records_collection_idx" ON "crown_records" ("collection");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crown_sessions_uid_idx" ON "crown_sessions" ("uid");