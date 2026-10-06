"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { Preset, Settings, StatementSeed } from "@ledger/schema";
import type { Seed } from "@ledger/schema";
import { fundingKey } from "@ledger/schema";
import { baseSettings, compute, createModel, debtFan, type DebtFan, type Model, type ScenarioResult } from "@ledger/engine";
import type { Unit } from "./format";
import { track } from "./analytics";

interface State {
  settings: Settings;
  unit: Unit;
  presetId: string | null;
}

type Action =
  | { type: "lever"; id: string; value: number }
  | { type: "funding"; id: string; option: string }
  | { type: "preset"; preset: Preset | null; base: Settings }
  | { type: "unit"; unit: Unit };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "lever":
      return { ...state, settings: { ...state.settings, [action.id]: action.value }, presetId: null };
    case "funding":
      return { ...state, settings: { ...state.settings, [fundingKey(action.id)]: action.option }, presetId: null };
    case "preset":
      return {
        ...state,
        settings: { ...action.base, ...(action.preset?.settings ?? {}) },
        presetId: action.preset?.id ?? null,
      };
    case "unit":
      return { ...state, unit: action.unit };
  }
}

const FRAME_FALLBACK_MS = 100;

/**
 * Hold a value back to the next animation frame. Sliders update their own
 * label at once; charts recompute at most once per frame (CLAUDE.md).
 */
function useFrameValue<T>(value: T): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    // Hidden tabs pause animation frames; the timer makes sure the update still lands.
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      setSettled(value);
    };
    const frame = requestAnimationFrame(settle);
    const timer = setTimeout(settle, FRAME_FALLBACK_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [value]);
  return settled;
}

interface ScenarioContextValue {
  seed: Seed;
  model: Model;
  base: Settings;
  /** Live settings, for controls. */
  settings: Settings;
  unit: Unit;
  presetId: string | null;
  /** Result for the frame-settled settings, for charts and figures. */
  result: ScenarioResult;
  baseResult: ScenarioResult;
  fan: DebtFan;
  /** The year the Statement section shows. The sandbox always runs on seed.baseYear. */
  year: string;
  setYear: (year: string) => void;
  isBaseYear: boolean;
  /** What the Statement and the key figures show: the scenario in the base year, published figures otherwise. */
  view: { statement: StatementSeed; result: ScenarioResult };
  setLever: (id: string, value: number) => void;
  setFunding: (id: string, option: string) => void;
  applyPreset: (preset: Preset | null) => void;
  setUnit: (unit: Unit) => void;
}

const ScenarioContext = createContext<ScenarioContextValue | null>(null);

export function ScenarioProvider({ seed, children }: { seed: Seed; children: ReactNode }) {
  const model = useMemo(() => createModel(seed.statement, seed.levers), [seed]);
  const base = useMemo(() => baseSettings(model), [model]);
  const [state, dispatch] = useReducer(reducer, { settings: base, unit: "bn", presetId: null });

  const settled = useFrameValue(state.settings);
  const result = useMemo(() => compute(model, settled), [model, settled]);
  const baseResult = useMemo(() => compute(model, base), [model, base]);
  const fan = useMemo(() => debtFan(model, result), [model, result]);

  const [year, setYear] = useState(seed.baseYear);
  const isBaseYear = year === seed.baseYear;
  const yearStatement = seed.statements[year] ?? seed.statement;
  const yearResult = useMemo(() => {
    const m = createModel(yearStatement, seed.levers);
    return compute(m, baseSettings(m));
  }, [yearStatement, seed.levers]);
  const view = useMemo(
    () => (isBaseYear ? { statement: seed.statement, result } : { statement: yearStatement, result: yearResult }),
    [isBaseYear, seed.statement, result, yearStatement, yearResult],
  );

  const setLever = useCallback((id: string, value: number) => dispatch({ type: "lever", id, value }), []);
  const setFunding = useCallback((id: string, option: string) => dispatch({ type: "funding", id, option }), []);
  const applyPreset = useCallback(
    (preset: Preset | null) => {
      dispatch({ type: "preset", preset, base });
      if (preset) track("preset_applied", { preset_id: preset.id });
    },
    [base],
  );
  const setUnit = useCallback((unit: Unit) => {
    dispatch({ type: "unit", unit });
    track("unit_changed", { unit });
  }, []);

  const value = useMemo<ScenarioContextValue>(
    () => ({
      seed,
      model,
      base,
      settings: state.settings,
      unit: state.unit,
      presetId: state.presetId,
      result,
      baseResult,
      fan,
      year,
      setYear,
      isBaseYear,
      view,
      setLever,
      setFunding,
      applyPreset,
      setUnit,
    }),
    [seed, model, base, state, result, baseResult, fan, year, isBaseYear, view, setLever, setFunding, applyPreset, setUnit],
  );

  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export function useScenario(): ScenarioContextValue {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error("useScenario must be used inside ScenarioProvider");
  return ctx;
}
