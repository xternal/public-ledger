import { createHash } from "node:crypto";
import { normaliseUrl } from "../../intake/normalise";
import { safeFetch, type Fetch } from "../../intake/ssrf";
import { captionTracksFrom, pickCaptionTrack, playerResponseFrom, transcriptFromJson3 } from "../../intake/text";
import type { SourceDoc, SpeakerSegment, Venue } from "../types";
import type { UploadInput } from "./index";
import { isIsoDate, squash, USER_AGENT } from "./util";

/**
 * A transcript an editor supplies by hand: pasted text, or the captions of a
 * YouTube video. The video link is supplied by a person, so every request for
 * it goes through safeFetch (public addresses only, pinned connections).
 */

const VENUE_LABELS: Record<Venue, string> = {
  manifesto: "Manifesto",
  speech: "Speech",
  debate: "Debate",
  tv: "TV",
  interview: "Interview",
  press_release: "Press release",
  parliament: "Parliament",
  social: "Social media",
};

export function uploadId(text: string): string {
  return `upload-${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 10)}`;
}

/** Line endings made "\n" and the ends trimmed; nothing else changes. */
function tidy(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

/** The caption text of a YouTube video, caption segments joined with single spaces. */
export async function youtubeCaptions(youtubeUrl: string, doFetch?: Fetch): Promise<string> {
  const { youtubeId } = normaliseUrl(youtubeUrl);
  if (!youtubeId) throw new Error("not a YouTube video link");
  const headers = { "user-agent": `Mozilla/5.0 (compatible; ${USER_AGENT})`, "accept-language": "en-GB,en;q=0.8" };
  const get = (url: string) => safeFetch(url, { fetch: doFetch, headers });
  const page = await get(`https://www.youtube.com/watch?v=${youtubeId}`);
  if (page.status !== 200) throw new Error(`YouTube page: HTTP ${page.status}`);
  const player = playerResponseFrom(page.body);
  const track = player ? pickCaptionTrack(captionTracksFrom(player)) : null;
  if (!track) throw new Error("this video has no captions");
  const captionsUrl = new URL(track.baseUrl, "https://www.youtube.com");
  if (!/(^|\.)youtube\.com$/.test(captionsUrl.hostname)) throw new Error("caption track is not on youtube.com");
  captionsUrl.searchParams.set("fmt", "json3");
  const res = await get(captionsUrl.href);
  if (res.status !== 200 || !res.body.trim()) throw new Error(`captions: HTTP ${res.status}`);
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new Error("captions: not JSON");
  }
  const text = transcriptFromJson3(json).text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("this video has no captions");
  return text;
}

export async function buildUploadDoc(input: UploadInput, doFetch?: Fetch): Promise<SourceDoc> {
  if (!isIsoDate(input.date)) throw new Error("date must be YYYY-MM-DD");
  if (!squash(input.url)) throw new Error("url is required");
  if (!squash(input.title)) throw new Error("title is required");
  let text: string;
  if (input.text && input.text.trim()) text = tidy(input.text);
  else if (input.youtubeUrl) text = await youtubeCaptions(input.youtubeUrl, doFetch);
  else throw new Error("give text or a YouTube link");

  const segments: SpeakerSegment[] = [];
  const people: string[] = [];
  const name = squash(input.speaker?.name);
  if (name) {
    segments.push({ start: 0, end: text.length, name, role: squash(input.speaker?.role) || null, party: squash(input.speaker?.party) || null, memberId: null });
    people.push(name);
  }
  return {
    id: uploadId(text),
    kind: "upload",
    url: input.url.trim(),
    title: squash(input.title),
    date: input.date,
    venue: input.venue,
    venueLabel: squash(input.venueLabel) || VENUE_LABELS[input.venue] || input.venue,
    text,
    segments,
    people,
  };
}
