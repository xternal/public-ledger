"use client";

import { useState, type ReactNode } from "react";
import { track, type PeopleChartId } from "@/lib/analytics";
import { T1_COPY } from "@/lib/t1-copy";
import { TextButton } from "./ui";

type TableChartId = "t1_deciles" | "t1_winners" | "t1_regions" | PeopleChartId;

/** "Show as table" under a chart: every chart has a table version (CLAUDE.md, accessibility). */
export function ChartTable({ id, chartId, label, children }: { id: string; chartId: TableChartId; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TextButton
        className="mt-2"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!open) track("chart_table_opened", { chart_id: chartId });
          setOpen(!open);
        }}
      >
        {open ? T1_COPY.hideTable : T1_COPY.showTable}
      </TextButton>
      {open && (
        // Wide tables scroll sideways on phones; the region is focusable so keyboard users can scroll it too.
        <div id={id} role="region" aria-label={label} tabIndex={0} className="mt-3 overflow-x-auto">
          {children}
        </div>
      )}
    </>
  );
}
