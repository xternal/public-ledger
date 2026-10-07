import type { SourceDoc } from "../types";
import { cleanPersonName, errorMessage, getJson, prose, squash, type FetchLike } from "./util";

/**
 * Written ministerial statements made in the Commons on one day. The list
 * endpoint cuts each text at about 255 characters, so every statement we keep
 * is read again in full from its own endpoint.
 */

export const WMS_API = "https://questions-statements-api.parliament.uk/api/writtenstatements/statements";
const PAGE = 100;
const MAX_PAGES = 5;
export const MIN_WMS_CHARS = 200;

interface WmsValue {
  id: number;
  memberId: number | null;
  member?: { name?: string | null; party?: string | null } | null;
  memberRole?: string | null;
  uin: string;
  dateMade?: string | null;
  title?: string | null;
  text?: string | null;
}

interface WmsList {
  totalResults?: number;
  results?: { value: WmsValue }[];
}

type Errors = { sourceId: string; message: string }[];

export function wmsId(uin: string): string {
  return `wms-${uin.toLowerCase()}`;
}

export function wmsUrl(date: string, uin: string): string {
  return `https://questions-statements.parliament.uk/written-statements/detail/${date}/${uin}`;
}

export function wmsListUrl(date: string, skip = 0): string {
  return `${WMS_API}?madeWhenFrom=${date}&madeWhenTo=${date}&house=Commons${skip ? `&skip=${skip}` : ""}&take=${PAGE}&expandMember=true`;
}

/** "Please refer to the Oral Statement I have made today on this subject." */
export function isOralPointer(text: string): boolean {
  return /\b(?:refer|see)\b[^.]{0,80}\boral\s+statement\b/i.test(text.slice(0, 400));
}

function roleOf(raw: string | null | undefined): string | null {
  const r = squash(raw).replace(/^the\s+/i, "");
  return r || null;
}

export async function fetchWmsDay(date: string, doFetch: FetchLike): Promise<{ docs: SourceDoc[]; errors: Errors }> {
  const errors: Errors = [];
  const values: WmsValue[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const list = await getJson<WmsList>(doFetch, wmsListUrl(date, page * PAGE));
    if (!list || !Array.isArray(list.results)) throw new Error("written statements: unexpected answer");
    values.push(...list.results.map((r) => r.value).filter((v): v is WmsValue => !!v && typeof v.uin === "string"));
    if (list.results.length < PAGE || values.length >= (list.totalResults ?? 0)) break;
  }

  const docs: SourceDoc[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const id = wmsId(v.uin);
    if (seen.has(id)) continue;
    seen.add(id);
    if (v.dateMade && v.dateMade.slice(0, 10) !== date) continue;
    // The list text is cut short ("…" at the end); a short text that is not cut is the whole statement.
    const preview = prose(v.text ?? "");
    if (isOralPointer(preview)) continue;
    const cut = /(?:\.\.\.|…)$/.test(preview);
    if (!cut && preview.length < MIN_WMS_CHARS) continue;
    let full: WmsValue;
    try {
      const detail = await getJson<{ value?: WmsValue }>(doFetch, `${WMS_API}/${v.id}?expandMember=true`);
      if (!detail?.value) throw new Error("written statement: unexpected answer");
      full = { ...v, ...detail.value, member: detail.value.member ?? v.member };
    } catch (e) {
      errors.push({ sourceId: id, message: errorMessage(e) });
      continue;
    }
    const text = prose(full.text ?? "");
    if (isOralPointer(text) || text.length < MIN_WMS_CHARS) continue;
    const name = cleanPersonName(full.member?.name ?? "");
    docs.push({
      id,
      kind: "hansard_wms",
      url: wmsUrl(date, full.uin),
      title: squash(full.title) || full.uin,
      date,
      venue: "parliament",
      venueLabel: "Written ministerial statement",
      text,
      segments: name
        ? [{ start: 0, end: text.length, name, role: roleOf(full.memberRole), party: squash(full.member?.party) || null, memberId: full.memberId ?? null }]
        : [],
      people: name ? [name] : [],
    });
  }
  return { docs, errors };
}
