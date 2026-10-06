import init from "./001_init";
import indexes from "./002_indexes";

/** Ordered migrations; append new ones, never edit applied ones. */
export const MIGRATIONS: [id: string, sql: string][] = [
  ["001_init", init],
  ["002_indexes", indexes],
];
