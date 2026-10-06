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

/**
 * Client events, named as in the event catalogue in
 * docs/CUSTOMER_JOURNEYS.md ("Analytics plan"). Follow events carry no
 * promise or actor id (privacy rule 6). Form pages fire nothing from the
 * client (rule 4): submissions are counted on the server in M3b.
 */
export type AnalyticsEvent =
  | { name: "unit_changed"; props: { unit: Unit } }
  | { name: "chart_table_opened"; props: { chart_id: "statement" | "debt_fan" } }
  | { name: "quality_badge_opened"; props: { quality: string } }
  | { name: "lever_changed"; props: { lever_id: string } }
  | { name: "preset_applied"; props: { preset_id: string } }
  | { name: "promise_card_viewed"; props: { promise_id: string; status: string } }
  | { name: "run_in_sandbox_clicked"; props: { promise_id: string } }
  | { name: "follow_panel_opened"; props: { target_kind: "promise" | "actor" | "area" } }
  | { name: "scenario_shared"; props: { method: "copy" } };

type Sink = (event: AnalyticsEvent) => void;

let sink: Sink | null = null;

export function setAnalyticsSink(next: Sink | null) {
  sink = next;
}

export function track<E extends AnalyticsEvent>(name: E["name"], props: E["props"]) {
  sink?.({ name, props } as AnalyticsEvent);
}
