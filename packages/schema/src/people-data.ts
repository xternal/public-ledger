import peopleRaw from "../../../data/build/people.json";
import { PeopleBundle } from "./people";

/** data/build/people.json, parsed. Throws on a bad file, so the build fails rather than drawing wrong numbers. */
export function loadPeople(raw: unknown = peopleRaw): PeopleBundle {
  const r = PeopleBundle.safeParse(raw);
  if (!r.success) {
    throw new Error(`data/build/people.json failed validation:\n${r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return r.data;
}
