import { pgTable, serial, text, real, timestamp, integer, unique } from "drizzle-orm/pg-core";

export const portfolioTable = pgTable("portfolio", {
  id: serial("id").primaryKey(),
  startingCapital: real("starting_capital").notNull(),
  cash: real("cash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// unique("positions_symbol_unique") prevents duplicate open positions per symbol
export const positionsTable = pgTable("positions", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  quantity: real("quantity").notNull(),
  avgEntryPrice: real("avg_entry_price").notNull(),
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

export type Portfolio = typeof portfolioTable.$inferSelect;
export type Position = typeof positionsTable.$inferSelect;
export type Trade = typeof tradesTable.$inferSelect;
