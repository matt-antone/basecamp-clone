import React from "react";

type ProjectTagListProps = {
  tags?: string[] | null;
  className?: string;
  ariaLabel?: string;
};

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

function normalizeTags(tags?: string[] | null) {
  return (tags ?? []).map((tag) => tag.trim()).filter(Boolean);
}

export function ProjectTagList({
  tags,
  className,
  ariaLabel = "Project tags"
}: ProjectTagListProps) {
  const normalizedTags = normalizeTags(tags);
  if (normalizedTags.length === 0) {
    return null;
  }

  return (
    <ul className={joinClassNames("projectTagList", className)} aria-label={ariaLabel}>
      {normalizedTags.map((tag) => (
        <li key={tag} className="projectTagPill">
          {tag}
        </li>
      ))}
    </ul>
  );
}
