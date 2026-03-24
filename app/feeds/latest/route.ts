import { FEATURED_FEEDS, parseFeedPosts } from "@/lib/featured-feed";
import { ok, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const results = await Promise.all(
    FEATURED_FEEDS.map(async (source) => {
      try {
        const response = await fetch(source.url, {
          headers: {
            Accept: "application/rss+xml, application/xml, text/xml"
          },
          next: { revalidate: 3600 }
        });

        if (!response.ok) {
          throw new Error(`Feed request failed: ${response.status}`);
        }

        const xml = await response.text();
        return { posts: parseFeedPosts(xml, source, 5), error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown feed failure";
        return { posts: [], error: `${source.name}: ${message}` };
      }
    })
  );

  const pool = results.flatMap((result) => result.posts);

  if (pool.length) {
    const post = pool[Math.floor(Math.random() * pool.length)];
    return ok({ post });
  }

  const errors = results.flatMap((result) => (result.error ? [result.error] : []));
  console.error("featured_feed_latest_failed", errors);
  return serverError("Unable to load featured feed");
}
