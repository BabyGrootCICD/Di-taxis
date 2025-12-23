/**
 * Gold token conversion utilities
 */

// XAUt conversion factor: 1 troy ounce = 31.1034768 grams
export const XAUT_TO_GRAMS_FACTOR = 31.1034768;

/**
 * Convert XAUt (troy ounces) to grams
 */
export function xautToGrams(xautAmount: number): number {
  return xautAmount * XAUT_TO_GRAMS_FACTOR;
}

/**
 * Convert KAU to grams (1:1 ratio)
 */
export function kauToGrams(kauAmount: number): number {
  return kauAmount;
}

/**
 * Normalize token holding to grams based on symbol
 */
export function normalizeToGrams(symbol: string, balance: number): number {
  switch (symbol.toLowerCase()) {
    case 'xaut':
      return xautToGrams(balance);
    case 'kau':
      return kauToGrams(balance);
    default:
      throw new Error(`Unsupported gold token symbol: ${symbol}`);
  }
}