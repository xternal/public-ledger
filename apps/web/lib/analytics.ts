/**
 * Product analytics: one typed entry point, no vendor yet.
 *
 * M0 sends nothing. When a first-party, cookieless collector is chosen,
 * register it with setAnalyticsSink(); call sites do not change.
 *
 * Rules (CLAUDE.md invariant 7, docs/PRIVACY_AND_ACCOUNTS.md):
 * - properties are ids and enums only: never salary, email, free text or IP;
 * - nothing that ties a person to the promises or actors they follow;
 * - no third-party scripts on pages with forms.
 */

import type { Unit } from "./format";

export type AnalyticsEvent =
  | { name: "unit_changed"; props: { unit: Unit } }
  | { name: "statement_table_toggled"; props: { open: boolean } }
  | { name: "statement_line_inspected"; props: { line_id: string } }
  | { name: "lever_changed"; props: { lever_id: string } }
  | { name: "measure_toggled"; props: { lever_id: string; on: boolean } }
  | { name: "preset_applied"; props: { preset_id: string } }
  | { name: "scenario_reset"; props: Record<string, never> }
  | { name: "promise_card_viewed"; props: { promise_id: string } }
  | { name: "promise_run_in_sandbox"; props: { promise_id: string } }
  | { name: "follow_opened"; props: { promise_id: string } }
  | { name: "evidence_started"; props: { promise_id: string } }
  | { name: "submission_form_sent"; props: { kind: "new" | "evidence" } };

type Sink = (event: AnalyticsEvent) => void;

let sink: Sink | null = null;

export function setAnalyticsSink(next: Sink | null) {
  sink = next;
}

export function track<E extends AnalyticsEvent>(name: E["name"], props: E["props"]) {
  sink?.({ name, props } as AnalyticsEvent);
}
