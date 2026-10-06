import "server-only";
import { intakeContent, type IntakeContent, type IntakeRules } from "@ledger/server/intake";
import { getSeed } from "@/lib/data";
import { EVIDENCE_OPTIONS } from "@/lib/copy";

/** The published cards and the form's choices, from the same seed the pages render. */
let cached: { content: IntakeContent; rules: IntakeRules } | null = null;

export function intake(): { content: IntakeContent; rules: IntakeRules } {
  if (!cached) {
    const content = intakeContent(getSeed());
    cached = { content, rules: { promiseIds: new Set(content.cards.map((c) => c.id)), evidenceTypes: EVIDENCE_OPTIONS.map((o) => o.id) } };
  }
  return cached;
}

/** Read a small request body: JSON or a plain form post. Null if too big or unreadable. */
export async function readBody(req: Request, maxBytes = 20_000): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  try {
    const raw = await req.text();
    if (raw.length > maxBytes) return null;
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    }
    if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
    return null;
  } catch {
    return null;
  }
}
