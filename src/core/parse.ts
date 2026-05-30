// Turn raw OCR text into an integer reading. Pure and testable.

/**
 * Extract the RS integer from raw OCR output. Digit groups are concatenated
 * (so "21 350" → 21350, surviving a stray space the OCR may insert), and all
 * non-digits are dropped. Returns null when there are no digits.
 *
 * This does NOT judge plausibility — that's `isPlausibleReading` in the
 * validator. It only converts text to a number.
 */
export function parseReading(text: string): number | null {
  const groups = text.match(/\d+/g);
  if (!groups) return null;
  const digits = groups.join('');
  if (digits.length === 0) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

/** One OCR detection: recognized text + its confidence (0..1). */
export interface OcrCandidate {
  text: string;
  score?: number;
}

/**
 * Choose the RS reading from PP-OCR's detected lines. Each line is split on
 * whitespace into tokens; the token with the most digits wins (ties broken by
 * confidence). This isolates the number from stray detections — e.g. a crop
 * that bisects the pin icon yielding `"9 17,080"` resolves to 17080, not
 * 917080. Returns null when no token contains a digit.
 */
export function bestReading(candidates: OcrCandidate[]): number | null {
  let best: { digits: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = candidate.score ?? 0;
    for (const token of candidate.text.split(/\s+/)) {
      const digits = token.replace(/\D/g, '');
      if (!digits) continue;
      if (
        !best ||
        digits.length > best.digits.length ||
        (digits.length === best.digits.length && score > best.score)
      ) {
        best = { digits, score };
      }
    }
  }
  if (!best) return null;
  const value = Number.parseInt(best.digits, 10);
  return Number.isFinite(value) ? value : null;
}
