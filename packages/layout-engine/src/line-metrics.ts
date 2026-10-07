export interface LineElementMetrics {
  ascent: number;
  descent: number;
  suppressibleBottomSpace?: number;
}

export interface LineVerticalMetrics {
  ascent: number;
  descent: number;
  height: number;
  suppressibleBottomSpace: number;
}

/** Signed 32-bit multiply/divide, including saturation and half-away rounding. */
export function multiplyDivideRound(
  a: number,
  b: number,
  denominator: number
): number {
  a |= 0;
  b |= 0;
  denominator |= 0;
  if (denominator === 0) return 0x7fffffff;
  if (a === 0 || b === denominator) return a;

  let adjustment = Math.trunc(denominator / 2);
  if ((a ^ b ^ denominator) < 0) adjustment = -adjustment;
  const numerator = BigInt(a) * BigInt(b) + BigInt(adjustment);
  const quotient = numerator / BigInt(denominator);
  if (numerator >= -0x80000000n && numerator <= 0x7fffffffn) {
    return Number(BigInt.asIntN(32, quotient));
  }
  return Number(
    quotient < -0x80000000n
      ? -0x80000000n
      : quotient > 0x7fffffffn
      ? 0x7fffffffn
      : quotient
  );
}

/** All measurements and limits must use the same unit. */
export function aggregateLineMetrics(
  elements: readonly LineElementMetrics[]
): LineVerticalMetrics {
  if (elements.length === 0) {
    return { ascent: 0, descent: 0, height: 0, suppressibleBottomSpace: 0 };
  }
  let ascent = -Infinity;
  let descent = -Infinity;
  let unsuppressibleDescent = -Infinity;
  for (const element of elements) {
    ascent = Math.max(ascent, element.ascent);
    descent = Math.max(descent, element.descent);
    unsuppressibleDescent = Math.max(
      unsuppressibleDescent,
      element.descent - (element.suppressibleBottomSpace ?? 0)
    );
  }
  return {
    ascent,
    descent,
    height: ascent + descent,
    suppressibleBottomSpace: descent - unsuppressibleDescent,
  };
}

export function checkLineVerticalFit(
  metrics: LineVerticalMetrics,
  available: number,
  secondaryLimit: number
): { fits: boolean; appliedSuppression: number; rejectedSuppression: number } {
  if (metrics.height <= available) {
    return { fits: true, appliedSuppression: 0, rejectedSuppression: 0 };
  }
  const fits =
    metrics.height <= secondaryLimit &&
    metrics.height - metrics.suppressibleBottomSpace <= available;
  return {
    fits,
    appliedSuppression: fits ? metrics.suppressibleBottomSpace : 0,
    rejectedSuppression: fits ? 0 : metrics.suppressibleBottomSpace,
  };
}

export function constrainParagraphLineSplit(
  linesRemaining: number,
  fittingLines: number,
  minimumBefore: number,
  minimumAfter: number
): number {
  const count = Math.max(0, Math.min(Math.trunc(fittingLines), linesRemaining));
  if (count >= linesRemaining) return linesRemaining;
  const constrained = Math.min(count, linesRemaining - minimumAfter);
  return constrained >= minimumBefore ? constrained : 0;
}
