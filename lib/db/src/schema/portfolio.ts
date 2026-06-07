import { pgTable, serial, text, real, timestamp, integer, unique, boolean } from "drizzle-orm/pg-core";

export const portfolioTable = pgTable("portfolio", {
  id: serial("id").primaryKey(),
  startingCapital: real("starting_capital").notNull(),
  cash: real("cash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// unique("positions_symbol_unique") prevents duplicate open positions per symbol
// high_water_price persists the trailing-stop high-water mark across server restarts
export const positionsTable = pgTable("positions", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  quantity: real("quantity").notNull(),
  avgEntryPrice: real("avg_entry_price").notNull(),
  highWaterPrice: real("high_water_price"),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique("positions_symbol_unique").on(t.symbol)]);

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: real("quantity").notNull(),
  price: real("price").notNull(),
  value: real("value").notNull(),
  realizedPnl: real("realized_pnl"),
  signalId: integer("signal_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Persisted key-value settings (live-enabled, budget, scaling config) ──────
export const settingsTable = pgTable("settings", {
  key:       text("key").primaryKey(),
  value:     text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Live positions (mirrors paper positions but for real Coinbase trades) ─────
export const livePositionsTable = pgTable("live_positions", {
  id:            serial("id").primaryKey(),
  symbol:        text("symbol").notNull(),
  quantity:      real("quantity").notNull(),
  avgEntryPrice: real("avg_entry_price").notNull(),
  highWaterPrice: real("high_water_price"),
  openedAt:      timestamp("opened_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique("live_positions_symbol_unique").on(t.symbol)]);

export type Portfolio      = typeof portfolioTable.$inferSelect;
export type Position       = typeof positionsTable.$inferSelect;
export type Trade          = typeof tradesTable.$inferSelect;
export type Settings       = typeof settingsTable.$inferSelect;
export type LivePosition   = typeof livePositionsTable.$inferSelect;
