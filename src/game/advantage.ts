export interface AdvantageEstimate {
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly lowerError: number;
  readonly upperError: number;
  readonly conservativeRadius: number;
}

const Z_95 = 1.959963984540054;

export function estimateAdvantage(wins: number, trials: number): AdvantageEstimate {
  if (!Number.isInteger(wins) || !Number.isInteger(trials) || wins < 0 || trials <= 0 || wins > trials) {
    throw new Error('Advantage requires integer counts with 0 <= wins <= trials.');
  }
  const probability = wins / trials;
  const denominator = 1 + (Z_95 * Z_95) / trials;
  const center = (probability + (Z_95 * Z_95) / (2 * trials)) / denominator;
  const radius =
    (Z_95 / denominator) *
    Math.sqrt((probability * (1 - probability)) / trials + (Z_95 * Z_95) / (4 * trials * trials));
  const estimate = 2 * probability - 1;
  const low = Math.max(-1, 2 * (center - radius) - 1);
  const high = Math.min(1, 2 * (center + radius) - 1);
  const lowerError = estimate - low;
  const upperError = high - estimate;
  return {
    estimate,
    low,
    high,
    lowerError,
    upperError,
    conservativeRadius: Math.max(lowerError, upperError),
  };
}