import { pgTable, text, jsonb } from "drizzle-orm/pg-core";

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
