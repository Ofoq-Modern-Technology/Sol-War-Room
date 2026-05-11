import { db, settingsTable } from "@workspace/db";

let cachedSettings: typeof settingsTable.$inferSelect | null = null;

export async function getSettings() {
  if (cachedSettings) return cachedSettings;
  const rows = await db.select().from(settingsTable).limit(1);
  if (rows.length === 0) {
    const [inserted] = await db.insert(settingsTable).values({}).returning();
    cachedSettings = inserted;
  } else {
    cachedSettings = rows[0];
  }
  return cachedSettings!;
}

export function invalidateSettingsCache() {
  cachedSettings = null;
}
