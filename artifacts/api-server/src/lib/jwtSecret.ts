import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";

let cachedSecret: string | null = null;

export async function getJwtSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;

  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));

  if (row?.jwtSecret) {
    cachedSecret = row.jwtSecret;
    return cachedSecret;
  }

  const secret = randomBytes(48).toString("hex");
  cachedSecret = secret;

  if (row) {
    await db.update(settingsTable).set({ jwtSecret: secret }).where(eq(settingsTable.id, 1));
  } else {
    await db.insert(settingsTable).values({ jwtSecret: secret });
  }

  return secret;
}
