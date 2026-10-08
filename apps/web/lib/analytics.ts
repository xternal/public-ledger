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
  | { name: "chart_table_opened"; props: { chart_id: "statement" | "debt_fan" | "t1_deciles" | "t1_winners" | "t1_regions" | PeopleChartId } }
  /** /people: which assumption or scenario a reader switched to (published variants only; ids, no free text). */
  | { name: "people_assumption_changed"; props: { assumption: "fertility" | "migration" | "life_expectancy" | "spending"; value: string } }
  | { name: "quality_badge_opened"; props: { quality: string } }
  | { name: "lever_changed"; props: { lever_id: string } }
  | { name: "preset_applied"; props: { preset_id: string } }
  | { name: "promise_card_viewed"; props: { promise_id: string; status: string } }
  | { name: "run_in_sandbox_clicked"; props: { promise_id: string } }
  | { name: "follow_panel_opened"; props: { target_kind: "promise" | "actor" | "area" | "deadline_window" } }
  | { name: "scenario_shared"; props: { method: "copy" } }
  /**
   * T1 (PolicyEngine microsimulation). Counts and buckets only: no scenario
   * code, no lever ids, and never the household or region a reader picks in
   * "People like me".
   */
  | { name: "t1_requested"; props: { levers_count: T1LeversBucket } }
  | { name: "t1_ready"; props: { seconds: T1SecondsBucket } }
  | { name: "t1_failed"; props: { reason: "timeout" | "network" | "server" | "busy" | "invalid" } };

/** How many T1 levers the scenario moved. */
export type T1LeversBucket = "1" | "2" | "3+";
/** Seconds from asking to PolicyEngine's answer. */
export type T1SecondsBucket = "0-5" | "5-30" | "30-60" | "60-120" | "120+";

type Sink = (event: AnalyticsEvent) => void;

let sink: Sink | null = null;

export function setAnalyticsSink(next: Sink | null) {
  sink = next;
}

export function track<E extends AnalyticsEvent>(name: E["name"], props: E["props"]) {
  sink?.({ name, props } as AnalyticsEvent);
}

/** Charts on /people that have a table view. */
export type PeopleChartId = "people_oadr" | "people_workers" | "people_births" | "people_spending";
