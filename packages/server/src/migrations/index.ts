import init from "./001_init";
import indexes from "./002_indexes";
import t1 from "./003_t1";

/** Ordered migrations; append new ones, never edit applied ones. */
export const MIGRATIONS: [id: string, sql: string][] = [
  ["001_init", init],
  ["002_indexes", indexes],
  ["003_t1", t1],
];
