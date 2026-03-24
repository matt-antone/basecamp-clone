import sanitizeHtml from "sanitize-html";

export type FeaturedFeedSource = {
  name: string;
  url: string;
};

export type FeaturedFeedPost = {
  title: string;
  description: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
};

export const FEATURED_FEEDS: FeaturedFeedSource[] = [
  { name: "Nielsen Norman Group", url: "https://www.nngroup.com/feed/rss/" },
  { name: "UX Collective", url: "https://uxdesign.cc/feed" },
  { name: "Abduzeedo", url: "https://abduzeedo.com/rss.xml" },
  { name: "HeyDesigner", url: "https://heydesigner.com/rss.xml" },
  { name: "Eye Magazine", url: "https://www.eyemagazine.com/rss" },
  { name: "Creative Review", url: "https://www.creativereview.co.uk/feed" },
  { name: "Eye on Design", url: "https://eyeondesign.aiga.org/feed" },
  { name: "I Love Typography", url: "https://ilovetypography.com/feed" },
  { name: "Fonts In Use", url: "https://fontsinuse.com/blog.rss" }
];

const MAX_DESCRIPTION_LENGTH = 240;
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: "\"",
  ldquo: "\"",
  hellip: "…",
  mdash: "—",
  ndash: "–"
};

type FeedField = "title" | "link" | "description" | "summary" | "content:encoded" | "content";
type FeedDateField = "pubDate" | "published" | "updated" | "dc:date";

function decodeCdata(value: string) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function getItemField(item: string, field: FeedField | FeedDateField) {
  const match = item.match(new RegExp(`<${field}[^>]*>([\\s\\S]*?)</${field}>`, "i"));
  return match ? decodeCdata(match[1]) : "";
}

function getItemLink(item: string) {
  const inlineLink = getItemField(item, "link");
  if (inlineLink) {
    return inlineLink;
  }

  const hrefMatch = item.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return hrefMatch ? hrefMatch[1].trim() : "";
}

function getItemDate(item: string) {
  const candidateFields: FeedDateField[] = ["pubDate", "published", "updated", "dc:date"];

  for (const field of candidateFields) {
    const value = getItemField(item, field);
    if (!value) {
      continue;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

function decodeHtmlEntities(value: string) {
  let decoded = value;

  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const codePoint = Number.parseInt(entity.slice(2), 16);
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
      }

      if (entity.startsWith("#")) {
        const codePoint = Number.parseInt(entity.slice(1), 10);
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
      }

      return HTML_ENTITY_MAP[entity.toLowerCase()] ?? match;
    });
  }

  return decoded;
}

function normalizeText(value: string) {
  return decodeHtmlEntities(sanitizeHtml(decodeHtmlEntities(value), { allowedTags: [], allowedAttributes: {} }))
    .replace(/\s+/g, " ")
    .trim();
}

function trimDescription(value: string, maxLength = MAX_DESCRIPTION_LENGTH) {
  if (value.length <= maxLength) {
    return value;
  }

  const trimmed = value.slice(0, maxLength + 1);
  const boundary = trimmed.lastIndexOf(" ");
  const excerpt = (boundary > maxLength * 0.65 ? trimmed.slice(0, boundary) : value.slice(0, maxLength)).trim();

  return `${excerpt.replace(/[.,;:!?\s]+$/, "")}…`;
}

function parseFeedItem(item: string, source: FeaturedFeedSource): FeaturedFeedPost {
  const title = normalizeText(getItemField(item, "title"));
  const url = getItemLink(item);
  const description =
    trimDescription(
      normalizeText(
        getItemField(item, "description") ||
          getItemField(item, "summary") ||
          getItemField(item, "content:encoded") ||
          getItemField(item, "content")
      ) || `Read the latest from ${source.name}.`
    );

  if (!title || !url) {
    throw new Error("Feed item incomplete");
  }

  return {
    title,
    description,
    url,
    sourceName: source.name,
    publishedAt: getItemDate(item)
  };
}

export function parseFeedPosts(xml: string, source: FeaturedFeedSource, limit = 5): FeaturedFeedPost[] {
  const itemMatches = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi);
  if (!itemMatches?.length) {
    throw new Error("Feed item missing");
  }

  const posts: FeaturedFeedPost[] = [];

  for (const item of itemMatches) {
    try {
      posts.push(parseFeedItem(item, source));
    } catch {
      continue;
    }

    if (posts.length >= limit) {
      break;
    }
  }

  if (!posts.length) {
    throw new Error("Feed item incomplete");
  }

  return posts;
}

export function parseLatestFeedPost(xml: string, source: FeaturedFeedSource): FeaturedFeedPost {
  return parseFeedPosts(xml, source, 1)[0];
}

export function sortFeedPostsByPublishedDate(posts: FeaturedFeedPost[]) {
  return [...posts].sort((left, right) => {
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    return rightTime - leftTime;
  });
}

export function shuffleFeedSources(sources: FeaturedFeedSource[], random = Math.random) {
  const shuffled = [...sources];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }

  return shuffled;
}
