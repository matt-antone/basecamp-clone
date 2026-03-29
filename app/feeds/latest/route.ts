import { FEATURED_FEEDS, parseFeedPosts, sortFeedPostsByPublishedDate } from "@/lib/featured-feed";
import { ok, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

let latestSuccessfulPosts: ReturnType<typeof sortFeedPostsByPublishedDate> = [];

export async function GET() {
  const results = await Promise.all(
    FEATURED_FEEDS.map(async (source) => {
      try {
        const response = await fetch(source.url, {
          headers: {
            Accept: "application/rss+xml, application/xml, text/xml"
          },
          next: { revalidate: 86400 }
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

  const pool = sortFeedPostsByPublishedDate(results.flatMap((result) => result.posts)).slice(0, 2);

  if (pool.length) {
    latestSuccessfulPosts = pool;
    return ok({ posts: pool });
  }

  if (latestSuccessfulPosts.length) {
    return ok({ posts: latestSuccessfulPosts });
  }

  const errors = results.flatMap((result) => (result.error ? [result.error] : []));
  console.error("featured_feed_latest_failed", errors);
  return serverError("Unable to load featured feed");
}
