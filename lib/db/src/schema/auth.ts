import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const authTable = sqliteTable("auth", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export type Auth = typeof authTable.$inferSelect;
export type InsertAuth = typeof authTable.$inferInsert;
