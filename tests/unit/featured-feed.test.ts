import { describe, expect, it } from "vitest";
import { FEATURED_FEEDS, parseFeedPosts, parseLatestFeedPost, shuffleFeedSources, type FeaturedFeedSource } from "@/lib/featured-feed";

describe("featured feed parsing", () => {
  it("parses the latest rss item and strips html from the description", () => {
    const source: FeaturedFeedSource = { name: "Abduzeedo", url: "https://abduzeedo.com/rss.xml" };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title><![CDATA[Designing calmer dashboards]]></title>
            <link>https://example.com/posts/calmer-dashboards</link>
            <description><![CDATA[<p>Build <strong>clarity</strong>, not clutter.</p>]]></description>
          </item>
        </channel>
      </rss>`;

    expect(parseLatestFeedPost(xml, source)).toEqual({
      title: "Designing calmer dashboards",
      description: "Build clarity, not clutter.",
      url: "https://example.com/posts/calmer-dashboards",
      sourceName: "Abduzeedo"
    });
  });

  it("strips html from titles as well as descriptions", () => {
    const source: FeaturedFeedSource = { name: "Eye on Design", url: "https://eyeondesign.aiga.org/feed" };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title><![CDATA[<em>Typeface</em> systems for modern brands]]></title>
            <link>https://example.com/posts/typeface-systems</link>
            <description><![CDATA[<p>Build <strong>clarity</strong> into the system.</p>]]></description>
          </item>
        </channel>
      </rss>`;

    expect(parseLatestFeedPost(xml, source)).toEqual({
      title: "Typeface systems for modern brands",
      description: "Build clarity into the system.",
      url: "https://example.com/posts/typeface-systems",
      sourceName: "Eye on Design"
    });
  });

  it("decodes encoded html entities in titles and descriptions", () => {
    const source: FeaturedFeedSource = { name: "I Love Typography", url: "https://ilovetypography.com/feed" };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>Type &amp;amp; grids &#8217; for editorial systems</title>
            <link>https://example.com/posts/type-grids</link>
            <description><![CDATA[Ideas for &lt;strong&gt;balanced&lt;/strong&gt; rhythm &amp;amp; hierarchy &#8230;]]></description>
          </item>
        </channel>
      </rss>`;

    const post = parseLatestFeedPost(xml, source);

    expect(post).toEqual({
      title: "Type & grids ’ for editorial systems",
      description: "Ideas for balanced rhythm & hierarchy …",
      url: "https://example.com/posts/type-grids",
      sourceName: "I Love Typography"
    });
    expect(post.description).not.toContain("<strong>");
  });

  it("falls back to atom href links and a default description", () => {
    const source: FeaturedFeedSource = { name: "HeyDesigner", url: "https://heydesigner.com/rss.xml" };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Fresh links for product teams</title>
          <link href="https://example.com/posts/fresh-links" />
        </entry>
      </feed>`;

    expect(parseLatestFeedPost(xml, source)).toEqual({
      title: "Fresh links for product teams",
      description: "Read the latest from HeyDesigner.",
      url: "https://example.com/posts/fresh-links",
      sourceName: "HeyDesigner"
    });
  });

  it("trims long descriptions to a compact excerpt", () => {
    const source: FeaturedFeedSource = { name: "Eye Magazine", url: "https://www.eyemagazine.com/rss" };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>Editorial systems that still feel alive</title>
            <link>https://example.com/posts/editorial-systems</link>
            <description><![CDATA[
              <p>Design systems for editorial teams need to balance consistency, pacing, typographic nuance, image rhythm, and a sense of surprise across long-form publishing surfaces without collapsing into sameness or losing the authorial voice that makes a publication memorable over time.</p>
            ]]></description>
          </item>
        </channel>
      </rss>`;

    const description = parseLatestFeedPost(xml, source).description;

    expect(description.length).toBeLessThanOrEqual(241);
    expect(description.endsWith("…")).toBe(true);
    expect(description).toContain("Design systems for editorial teams need to balance consistency");
    expect(description).not.toContain("<p>");
  });

  it("returns the latest five items from a feed as a selection pool", () => {
    const source: FeaturedFeedSource = { name: "Creative Review", url: "https://www.creativereview.co.uk/feed" };
    const items = Array.from({ length: 6 }, (_, index) => {
      const entry = index + 1;
      return `
        <item>
          <title>Story ${entry}</title>
          <link>https://example.com/posts/story-${entry}</link>
          <description><![CDATA[<p>Summary ${entry}</p>]]></description>
        </item>`;
    }).join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${items}</channel></rss>`;

    expect(parseFeedPosts(xml, source, 5)).toEqual([
      {
        title: "Story 1",
        description: "Summary 1",
        url: "https://example.com/posts/story-1",
        sourceName: "Creative Review"
      },
      {
        title: "Story 2",
        description: "Summary 2",
        url: "https://example.com/posts/story-2",
        sourceName: "Creative Review"
      },
      {
        title: "Story 3",
        description: "Summary 3",
        url: "https://example.com/posts/story-3",
        sourceName: "Creative Review"
      },
      {
        title: "Story 4",
        description: "Summary 4",
        url: "https://example.com/posts/story-4",
        sourceName: "Creative Review"
      },
      {
        title: "Story 5",
        description: "Summary 5",
        url: "https://example.com/posts/story-5",
        sourceName: "Creative Review"
      }
    ]);
  });
});

describe("featured feed sources", () => {
  it("includes the expanded design and typography feed set", () => {
    expect(FEATURED_FEEDS.map((source) => source.name)).toEqual([
      "Nielsen Norman Group",
      "UX Collective",
      "Abduzeedo",
      "HeyDesigner",
      "Eye Magazine",
      "Creative Review",
      "Eye on Design",
      "I Love Typography",
      "Fonts In Use"
    ]);
  });
});

describe("featured feed shuffling", () => {
  it("returns a new randomized order without mutating the input", () => {
    const sources: FeaturedFeedSource[] = [
      { name: "A", url: "https://a.test/feed.xml" },
      { name: "B", url: "https://b.test/feed.xml" },
      { name: "C", url: "https://c.test/feed.xml" }
    ];

    const shuffled = shuffleFeedSources(sources, () => 0);

    expect(shuffled.map((source) => source.name)).toEqual(["B", "C", "A"]);
    expect(sources.map((source) => source.name)).toEqual(["A", "B", "C"]);
    expect(shuffled).not.toBe(sources);
  });
});
