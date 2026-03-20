import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  signal: text("signal").notNull(),
  confidence: real("confidence").notNull(),
  price: real("price").notNull(),
  symbol: text("symbol").notNull().default("BTC/USDT"),
  timeframe: text("timeframe").notNull().default("1m"),
  returns: real("returns").notNull(),
  ma: real("ma").notNull(),
  volatility: real("volatility").notNull(),
  rsi: real("rsi").notNull(),
  macd: real("macd").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
