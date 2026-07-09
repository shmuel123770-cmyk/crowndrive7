import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { owners, renters, cars, bookings, messages, ratings } from "../../db/schema.js";

const TABLES = { owners, renters, cars, bookings, messages, ratings } as const;
type CollectionName = keyof typeof TABLES;

function isCollectionName(name: string | null): name is CollectionName {
  return !!name && Object.prototype.hasOwnProperty.call(TABLES, name);
}

export default async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const [ownerRows, renterRows, carRows, bookingRows, messageRows, ratingRows] = await Promise.all([
      db.select().from(owners),
      db.select().from(renters),
      db.select().from(cars),
      db.select().from(bookings),
      db.select().from(messages),
      db.select().from(ratings),
    ]);

    return Response.json({
      owners: ownerRows.map((r) => r.data),
      renters: renterRows.map((r) => r.data),
      cars: carRows.map((r) => r.data),
      bookings: bookingRows.map((r) => r.data),
      messages: messageRows.map((r) => r.data),
      ratings: ratingRows.map((r) => r.data),
    });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    const collection = body?.collection;
    const item = body?.item;

    if (!isCollectionName(collection) || !item || item.id === undefined || item.id === null) {
      return new Response("Invalid request", { status: 400 });
    }

    const table = TABLES[collection];
    const id = String(item.id);

    await db
      .insert(table)
      .values({ id, data: item })
      .onConflictDoUpdate({ target: table.id, set: { data: item } });

    return Response.json({ ok: true });
  }

  if (req.method === "DELETE") {
    const collection = url.searchParams.get("collection");
    const id = url.searchParams.get("id");

    if (!isCollectionName(collection) || !id) {
      return new Response("Invalid request", { status: 400 });
    }

    const table = TABLES[collection];
    await db.delete(table).where(eq(table.id, id));

    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/db",
};
