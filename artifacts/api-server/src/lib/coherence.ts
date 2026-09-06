export interface CoherenceFactors {
  trend: number;
  momentum: number;
  meanReversion: number;
  volatility: number;
  volume: number;
  composite: number;
}

export interface TimeframeFactorSnapshot {
  timeframe: string;
  factors: CoherenceFactors;
}

export interface TimeframeCoherence {
  timeframe: string;
  direction: "BUY" | "SELL" | "HOLD";
  composite: number;
}

export interface CoherenceResult {
  score: number;
  indicatorAgreement: number;
  timeframeAgreement: number;
  isCoherent: boolean;
  reason: string;
  direction: "BUY" | "SELL" | "HOLD";
  timeframes: TimeframeCoherence[];
}

const INDICATOR_THRESHOLD = 0.62;
const SCORE_THRESHOLD = 0.7;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function directionForComposite(composite: number, signalThreshold: number): "BUY" | "SELL" | "HOLD" {
  if (composite > signalThreshold) return "BUY";
  if (composite < -signalThreshold) return "SELL";
  return "HOLD";
}

function formatDirection(direction: "BUY" | "SELL" | "HOLD"): string {
  return direction === "BUY" ? "bullish" : direction === "SELL" ? "bearish" : "neutral";
}

/**
 * Coherence is intentionally stricter than the composite signal:
 * - directional indicators must agree with the proposed direction;
 * - volatility must be stable enough to support the signal;
 * - every required timeframe must point in the same direction.
 *
 * A HOLD is returned by the caller when isCoherent is false. This means
 * enabling coherence can only suppress trades; it can never create one.
 */
export function calculateCoherence(
  factors: CoherenceFactors,
  timeframeSnapshots: TimeframeFactorSnapshot[],
  signalThreshold: number,
): CoherenceResult {
  const direction = directionForComposite(factors.composite, signalThreshold);
  const directionalFactors = [factors.trend, factors.momentum, factors.meanReversion, factors.volume];

  if (direction === "HOLD") {
    const timeframes = timeframeSnapshots.map(({ timeframe, factors: timeframeFactors }) => ({
      timeframe,
      direction: directionForComposite(timeframeFactors.composite, signalThreshold),
      composite: round(timeframeFactors.composite),
    }));
    return {
      score: 0,
      indicatorAgreement: 0,
      timeframeAgreement: 0,
      isCoherent: false,
      reason: `No directional edge: the composite score is ${round(factors.composite, 2).toFixed(2)}, below the ${signalThreshold.toFixed(2)} signal threshold.`,
      direction,
      timeframes,
    };
  }

  const directionalAgreement = directionalFactors.reduce(
    (sum, factor) => sum + clamp(factor * (direction === "BUY" ? 1 : -1)),
    0,
  ) / directionalFactors.length;
  const volatilitySupport = clamp(factors.volatility);
  const indicatorAgreement = round(directionalAgreement * 0.9 + volatilitySupport * 0.1);

  const timeframes = timeframeSnapshots.map(({ timeframe, factors: timeframeFactors }) => ({
    timeframe,
    direction: directionForComposite(timeframeFactors.composite, signalThreshold),
    composite: round(timeframeFactors.composite),
  }));
  const matchingTimeframes = timeframes.filter((snapshot) => snapshot.direction === direction).length;
  const timeframeAgreement = timeframes.length > 0 ? round(matchingTimeframes / timeframes.length) : 0;
  const requiredTimeframes = ["1m", "5m", "15m"];
  const missingTimeframes = requiredTimeframes.filter(
    (timeframe) => !timeframes.some((snapshot) => snapshot.timeframe === timeframe),
  );
  const score = round(indicatorAgreement * 0.55 + timeframeAgreement * 0.45);
  const isCoherent =
    indicatorAgreement >= INDICATOR_THRESHOLD &&
    missingTimeframes.length === 0 &&
    timeframeAgreement === 1 &&
    score >= SCORE_THRESHOLD;

  const indicatorPercent = Math.round(indicatorAgreement * 100);
  const timeframeSummary = timeframes.length > 0
    ? timeframes.map((snapshot) => `${snapshot.timeframe} ${formatDirection(snapshot.direction)}`).join(", ")
    : "no timeframe data";

  const reasons: string[] = [];
  if (indicatorAgreement < INDICATOR_THRESHOLD) {
    reasons.push(`indicator agreement is ${indicatorPercent}% (need ${Math.round(INDICATOR_THRESHOLD * 100)}%)`);
  } else {
    reasons.push(`${indicatorPercent}% of indicator weight supports the ${formatDirection(direction)} direction`);
  }
  if (missingTimeframes.length > 0) {
    reasons.push(`missing required timeframe data (${missingTimeframes.join(", ")})`);
  }
  if (timeframeAgreement < 1) {
    reasons.push(`timeframes disagree (${timeframeSummary})`);
  } else if (missingTimeframes.length === 0) {
    reasons.push(`1m, 5m, and 15m are aligned ${formatDirection(direction)}`);
  }
  if (score < SCORE_THRESHOLD) {
    reasons.push(`coherence score is ${Math.round(score * 100)}% (need ${Math.round(SCORE_THRESHOLD * 100)}%)`);
  }

  return {
    score,
    indicatorAgreement,
    timeframeAgreement,
    isCoherent,
    reason: isCoherent
      ? `Coherent ${formatDirection(direction)} signal: ${reasons.join("; ")}.`
      : `HOLD: ${reasons.join("; ")}.`,
    direction,
    timeframes,
  };
}

export function applyCoherence(
  factors: CoherenceFactors,
  coherence: CoherenceResult,
  signalThreshold: number,
): { signal: "BUY" | "SELL" | "HOLD"; confidence: number } {
  const rawSignal = directionForComposite(factors.composite, signalThreshold);
  const signal = rawSignal !== "HOLD" && coherence.isCoherent && coherence.direction === rawSignal
    ? rawSignal
    : "HOLD";
  return {
    signal,
    confidence: round((factors.composite + 1) / 2),
  };
}