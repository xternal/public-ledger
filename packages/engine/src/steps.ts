import type { Lever, LeverStep } from "@ledger/schema";
import { STEP_TOLERANCE } from "@ledger/schema";

/**
 * Stepped levers (docs/MODEL.md, T0): the source costs only some changes and
 * says its figures cannot be scaled (HMRC's capital gains tax rates). The
 * engine uses the figure for the step a value stands on and nothing else: no
 * interpolation between steps, no scaling beyond the last one.
 */

export const isStepped = (lever: Lever): boolean => lever.effect.steps !== undefined;

/**
 * The step a value stands on: the one whose `at` equals value − base (within
 * floating-point slack). A value between steps, as an old link might carry,
 * counts as the step at or below it, and a value above the last step as the
 * last step. Undefined means base: no change, or below the first step.
 */
export function stepFor(lever: Lever, value: number): LeverStep | undefined {
  const d = value - lever.base;
  let found: LeverStep | undefined;
  for (const s of lever.effect.steps ?? []) {
    if (s.at > d + STEP_TOLERANCE) break;
    found = s;
  }
  return found;
}

/** The value a stepped lever snaps to: base, or base plus the step at or below the value. */
export function snapToStep(lever: Lever, value: number): number {
  const s = stepFor(lever, value);
  return s ? lever.base + s.at : lever.base;
}
