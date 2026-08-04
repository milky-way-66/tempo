import { describe, it, expect } from "vitest";
import { slugify, newId } from "../../src/core/ids";

describe("slugify", () => {
  it("kebab-cases a title", () => {
    expect(slugify("Write the Spec")).toBe("write-the-spec");
    expect(slugify("Fix Data-Source Page Bug")).toBe("fix-data-source-page-bug");
  });

  it("collapses runs of separators and trims edges", () => {
    expect(slugify("  Hello   World!!  ")).toBe("hello-world");
    expect(slugify("a -- b __ c")).toBe("a-b-c");
  });

  it("normalizes accented characters to ascii", () => {
    expect(slugify("Café Menu")).toBe("cafe-menu");
  });

  it("falls back to 'task' when nothing survives", () => {
    expect(slugify("!!!")).toBe("task");
    expect(slugify("")).toBe("task");
  });

  it("suffixes collisions with an incrementing number", () => {
    const existing = new Set(["spec"]);
    expect(slugify("Spec", existing)).toBe("spec-2");
    existing.add("spec-2");
    expect(slugify("Spec", existing)).toBe("spec-3");
  });
});

describe("newId", () => {
  it("returns a unique uuid each call", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
