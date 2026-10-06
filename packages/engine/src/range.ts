import type { Range } from "@ledger/schema";

export const ZERO: Range = [0, 0, 0];

export const add = (a: Range, b: Range): Range => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Range, k: number): Range => [a[0] * k, a[1] * k, a[2] * k];
export const point = (x: number): Range => [x, x, x];

/**
 * Put a range back in order. Multiplying by a negative change swaps low and
 * high, so a raw [low-coefficient, central, high-coefficient] triple may not
 * be ordered; the central value is kept as computed.
 */
export const ordered = (a: Range): Range => [Math.min(a[0], a[1], a[2]), a[1], Math.max(a[0], a[1], a[2])];
