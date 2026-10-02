import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  version: integer("version").notNull().default(1),
});
export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  isSeller: integer("is_seller").notNull().default(0),
  balance: text("balance"),
  updatedAt: text("updated_at"),
});
export const deals = sqliteTable("deals", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  destination: text("destination").notNull(),
  status: text("status").notNull(),
  sellerId: text("seller_id").notNull(),
  forecast: text("forecast").notNull(),
  createdAt: text("created_at").notNull(),
  parentId: text("parent_id"),
  routeMode: text("route_mode").notNull().default("highsec"),
});
