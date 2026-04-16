"use client";

import { memo } from "react";

type MarkdownHtmlProps = {
  html: string;
};

function MarkdownHtmlImpl({ html }: MarkdownHtmlProps) {
  return <div className="markdownContent" dangerouslySetInnerHTML={{ __html: html }} />;
}

export const MarkdownHtml = memo(MarkdownHtmlImpl, (prev, next) => prev.html === next.html);
