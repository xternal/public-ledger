import { z } from "zod";
import { Settings } from "./levers";

export const Preset = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["editorial", "promise"]),
  settings: Settings,
  promise_id: z.string().optional(),
});
export type Preset = z.infer<typeof Preset>;

export const PresetsSeed = z.object({
  meta: z.object({ note: z.string() }),
  presets: z.array(Preset),
});
export type PresetsSeed = z.infer<typeof PresetsSeed>;
