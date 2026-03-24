import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectTagList } from "@/components/project-tag-list";

describe("ProjectTagList", () => {
  it("renders violet tag pills for provided tags", () => {
    const markup = renderToStaticMarkup(<ProjectTagList tags={["launch", "brand refresh", "q2"]} />);

    expect(markup).toContain('class="projectTagList"');
    expect(markup).toContain(">launch<");
    expect(markup).toContain(">brand refresh<");
    expect(markup).toContain(">q2<");
  });

  it("omits markup when tags are empty or blank", () => {
    expect(renderToStaticMarkup(<ProjectTagList tags={[]} />)).toBe("");
    expect(renderToStaticMarkup(<ProjectTagList tags={["", "   "]} />)).toBe("");
    expect(renderToStaticMarkup(<ProjectTagList />)).toBe("");
  });
});
