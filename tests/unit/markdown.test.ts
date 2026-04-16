import { describe, expect, it } from "vitest";
import { markdownToPlainText, renderMarkdown } from "@/lib/markdown";

describe("markdown renderer", () => {
  it("renders markdown and removes script tags", () => {
    const html = renderMarkdown("# Hello\n<script>alert('x')</script>");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).not.toContain("<script>");
  });
});

describe("markdownToPlainText", () => {
  it("returns empty string for empty input", () => {
    expect(markdownToPlainText("")).toBe("");
    expect(markdownToPlainText(null as unknown as string)).toBe("");
    expect(markdownToPlainText(undefined as unknown as string)).toBe("");
  });

  it("strips heading hashes", () => {
    expect(markdownToPlainText("# Title\n## Sub")).toBe("Title Sub");
  });

  it("strips bold, italic, and inline code markers", () => {
    expect(markdownToPlainText("**bold** and *italic* and `code`")).toBe("bold and italic and code");
  });

  it("reduces links to their text", () => {
    expect(markdownToPlainText("See [the docs](https://example.com) now")).toBe("See the docs now");
  });

  it("strips list bullets and numbering", () => {
    expect(markdownToPlainText("- one\n- two\n1. three")).toBe("one two three");
  });

  it("strips blockquote prefixes", () => {
    expect(markdownToPlainText("> quoted line")).toBe("quoted line");
  });

  it("strips fenced code blocks", () => {
    expect(markdownToPlainText("intro\n```\nconst x = 1;\n```\nend")).toBe("intro const x = 1; end");
  });

  it("collapses whitespace to single spaces", () => {
    expect(markdownToPlainText("one\n\n\ntwo   three")).toBe("one two three");
  });
});
