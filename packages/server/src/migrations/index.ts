import init from "./001_init";
import indexes from "./002_indexes";
import t1 from "./003_t1";
import t1Version from "./004_t1_version";
import windowsDataAlerts from "./005_windows_data_alerts";
import pendingTargets from "./006_pending_targets";

/** Ordered migrations; append new ones, never edit applied ones. */
export const MIGRATIONS: [id: string, sql: string][] = [
  ["001_init", init],
  ["002_indexes", indexes],
  ["003_t1", t1],
  ["004_t1_version", t1Version],
  ["005_windows_data_alerts", windowsDataAlerts],
  ["006_pending_targets", pendingTargets],
];
