import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(input: string) {
  const html = marked.parse(input, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "span", "input"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title"],
      input: ["type", "checked", "disabled"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      input: (tagName, attribs) => {
        if (attribs.type !== "checkbox") return { tagName: "span", attribs: {} };
        const out: Record<string, string> = { type: "checkbox", disabled: "disabled" };
        if (attribs.checked !== undefined) out.checked = "checked";
        return { tagName: "input", attribs: out };
      }
    }
  });
}

export function markdownToPlainText(input: string | null | undefined): string {
  if (!input) return "";
  const html = marked.parse(input, { async: false }) as string;
  const stripped = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {}
  });
  return stripped.replace(/\s+/g, " ").trim();
}
