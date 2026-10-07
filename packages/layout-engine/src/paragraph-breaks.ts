/** All amounts must use the same layout unit. */
export function collapseParagraphMargins(amounts: readonly number[]): number {
  let positive = 0;
  let negative = 0;
  for (const amount of amounts) {
    positive = Math.max(positive, amount);
    negative = Math.min(negative, amount);
  }
  return positive + negative;
}

/** The preceding amount has already been included in the flow position. */
export function paragraphMarginContribution(
  previousAmount: number,
  nextAmount: number
): number {
  return collapseParagraphMargins([previousAmount, nextAmount]) - previousAmount;
}
