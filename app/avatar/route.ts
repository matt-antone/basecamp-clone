import { isAllowedAvatarUrl } from "@/lib/avatar";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("src")?.trim() ?? "";

  if (!source || !isAllowedAvatarUrl(source)) {
    return new Response("Avatar not allowed", { status: 400 });
  }

  try {
    const upstream = await fetch(source, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      },
      next: {
        revalidate: 60 * 60 * 24
      }
    });

    if (!upstream.ok || !upstream.body) {
      return new Response("Avatar unavailable", { status: upstream.status || 502 });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
      }
    });
  } catch {
    return new Response("Avatar unavailable", { status: 502 });
  }
}
