/**
 * Chart geometry. These are layout constants, not data: every figure a chart
 * shows comes from the seed through the engine.
 */
export const SANKEY = {
  width: 1000,
  height: 760,
  nodeWidth: 8,
  nodePadding: 13,
  labelGutterLeft: 212,
  labelGutterRight: 262,
  top: 34,
  bottom: 12,
  labelOffset: 10,
  /** Nodes shorter than this get a single-line label. */
  compactNodeHeight: 32,
  minLinkWidth: 1,
  /** Opacity of flows that are not part of the hovered line. */
  dimOpacity: 0.28,
  hatchSize: 7,
} as const;

export const FAN = {
  width: 560,
  height: 240,
  margin: { left: 40, right: 64, top: 16, bottom: 28 },
  /** Padding above and below the data, in percentage points of GDP. */
  yPadding: 1,
  yTicks: 4,
  dotRadius: 3.5,
} as const;

/** Below this many pixels the Sankey becomes two ranked bar lists (DESIGN_HANDOFF). */
export const MOBILE_BREAKPOINT_PX = 720;

/** Changes smaller than this (£bn) are not labelled on charts. */
export const LABEL_DELTA_MIN_BN = 0.05;
