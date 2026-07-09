CREATE TABLE "bookings" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cars" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renters" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL
);
