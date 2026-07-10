import { pgTable, text, jsonb, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Each table stores one record per row: a stable id plus the full record as
// JSON, mirroring the flexible, per-record shape the site already works with
// (cars, bookings, etc. each carry a different set of fields).

export const owners = pgTable("owners", {
  id: text().primaryKey(),
  data: jsonb().notNull(),
});

export const renters = pgTable("renters", {
  id: text().primaryKey(),
  data: jsonb().notNull(),
});

export const cars = pgTable("cars", {
  id: text().primaryKey(),
  data: jsonb().notNull(),
});

export const bookings = pgTable("bookings", {
  id: text().primaryKey(),
  data: jsonb().notNull(),
});

export const messages = pgTable("messages", {
  id: text().primaryKey(),
  data: jsonb().notNull(),
});

export const ratings = pgTable("ratings", {
  id: text().primaryKey(),
  data: jsonb().notNull(),
});

// Tables backing the `db` serverless function (netlify/functions/db.mts). These
// were previously created at runtime via `CREATE TABLE ...` inside the function,
// which requires schema-owner privileges the request-time database role does not
// have — the source of the "permission denied for schema public" error. Defining
// them here means the platform creates them during the deploy migration step,
// with the right privileges, so the function only ever needs read/write access.

// Generic per-record store keyed by (collection, id) with the record body as JSON.
export const crownRecords = pgTable(
  "crown_records",
  {
    collection: text().notNull(),
    id: text().notNull(),
    data: jsonb().notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.collection, t.id] }),
    index("crown_records_collection_idx").on(t.collection),
  ],
);

// Authentication credentials (one row per account).
export const crownAuth = pgTable("crown_auth", {
  uid: text().primaryKey(),
  email: text().notNull().unique(),
  pass: text(),
  passHash: text("pass_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Session tokens (hashed) with expiry.
export const crownSessions = pgTable(
  "crown_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    uid: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("crown_sessions_uid_idx").on(t.uid)],
);
