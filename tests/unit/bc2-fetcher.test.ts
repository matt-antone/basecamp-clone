// tests/unit/bc2-fetcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { Bc2Fetcher } from "@/lib/imports/bc2-fetcher";
import { Bc2Client } from "@/lib/imports/bc2-client";

function makeClient(responses: Array<{ body: unknown; nextUrl?: string | null }>) {
  const client = {
    get: vi.fn()
  } as unknown as Bc2Client;
  let call = 0;
  (client.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const page = responses[call++];
    return Promise.resolve({ body: page.body, nextUrl: page.nextUrl ?? null });
  });
  return client;
}

describe("Bc2Fetcher", () => {
  it("yields all items across multiple pages from fetchPeople", async () => {
    const client = makeClient([
      { body: [{ id: 1, name: "Alice" }], nextUrl: "https://basecamp.com/12345/api/v1/people.json?page=2" },
      { body: [{ id: 2, name: "Bob" }], nextUrl: null }
    ]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const person of fetcher.fetchPeople()) {
      results.push(person);
    }
    expect(results).toEqual([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);
    expect((client.get as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("fetchMessages uses topics endpoint, filters Message type, fetches individual messages", async () => {
    const topicsPage = [
      { id: 10, topicable: { id: 99, type: "Message", url: "..." } },
      { id: 11, topicable: { id: 200, type: "Document", url: "..." } } // should be skipped
    ];
    const fullMessage = {
      id: 99,
      subject: "Hello",
      content: "World",
      created_at: "2024-01-01T00:00:00Z",
      creator: { id: 1, name: "Alice" },
      comments: [{ id: 7, content: "nice", created_at: "2024-01-02T00:00:00Z", creator: { id: 2, name: "Bob" } }]
    };

    const client = makeClient([
      { body: topicsPage, nextUrl: null },          // GET /projects/42/topics.json
      { body: fullMessage, nextUrl: null }           // GET /projects/42/messages/99.json
    ]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const msg of fetcher.fetchMessages("42")) {
      results.push(msg);
    }

    const calls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toContain("/projects/42/topics.json");
    expect(calls[1][0]).toContain("/projects/42/messages/99");
    expect(results).toHaveLength(1);
    expect((results[0] as typeof fullMessage).comments).toHaveLength(1);
    // Document topic must not trigger a message fetch
    expect(calls).toHaveLength(2);
  });
});
