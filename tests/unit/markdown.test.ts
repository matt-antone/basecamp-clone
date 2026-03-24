import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

describe("markdown renderer", () => {
  it("renders markdown and removes script tags", () => {
    const html = renderMarkdown("# Hello\n<script>alert('x')</script>");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).not.toContain("<script>");
  });
});
