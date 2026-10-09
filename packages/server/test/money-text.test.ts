import { describe, expect, it } from "vitest";
import { costRangeText, gbpBnText } from "../src/alerts/labels";

describe("money in words", () => {
  it("shows billions as the site does", () => {
    expect(gbpBnText(115)).toBe("£115bn");
    expect(gbpBnText(24.6)).toBe("£24.6bn");
    expect(gbpBnText(0.45)).toBe("£0.45bn");
  });

  it("shows amounts under £0.1bn in millions, so a small range stays a range", () => {
    expect(gbpBnText(0.018)).toBe("£18m");
    expect(gbpBnText(-0.08)).toBe("−£80m");
    expect(costRangeText([0.018, 0.02, 0.022])).toBe("Costs £18m to £22m a year");
    expect(costRangeText([-0.088, -0.08, -0.072])).toBe("Raises £72m to £88m a year");
  });
});
