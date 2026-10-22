// ─── Alerts ───────────────────────────────────────────────────────────────────
// Fire-and-forget notifications to Telegram and/or Discord. Configure via env:
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
//   DISCORD_WEBHOOK_URL
// When nothing is configured, alerts are only logged. An alert failure never
// throws into the trading path.
import { logger } from "./logger";

export type AlertLevel = "info" | "warn" | "critical";

const ICON: Record<AlertLevel, string> = { info: "ℹ️", warn: "⚠️", critical: "🚨" };

// Simple de-duplication so a flapping condition can't spam the channel.
const _lastSent = new Map<string, number>();
const DEDUPE_MS = 5 * 60 * 1000;

export function alertsConfigured(): boolean {
  return Boolean(
    (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) || process.env.DISCORD_WEBHOOK_URL,
  );
}

async function post(url: string, body: unknown): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`alert HTTP ${res.status}`);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Send an alert. `dedupeKey` suppresses repeats of the same condition for 5 min.
 */
export function sendAlert(level: AlertLevel, message: string, dedupeKey?: string): void {
  const key = dedupeKey ?? `${level}:${message}`;
  const now = Date.now();
  const last = _lastSent.get(key);
  if (last && now - last < DEDUPE_MS) return;
  _lastSent.set(key, now);

  const env = process.env.BOT_NAME ?? "market-signal-trade";
  const text = `${ICON[level]} [${env}] ${message}`;
  const logFn = level === "critical" ? logger.error.bind(logger) : level === "warn" ? logger.warn.bind(logger) : logger.info.bind(logger);
  logFn({ alert: true, alertLevel: level }, message);

  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChat) {
    post(`https://api.telegram.org/bot${tgToken}/sendMessage`, { chat_id: tgChat, text, disable_web_page_preview: true })
      .catch((err) => logger.warn({ err: String(err) }, "Telegram alert failed"));
  }
  const discord = process.env.DISCORD_WEBHOOK_URL;
  if (discord) {
    post(discord, { content: text }).catch((err) => logger.warn({ err: String(err) }, "Discord alert failed"));
  }
}

/** Test hook */
export function _resetAlertDedupe(): void { _lastSent.clear(); }
