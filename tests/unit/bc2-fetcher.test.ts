// tests/unit/bc2-fetcher.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Bc2Fetcher } from "@/lib/imports/bc2-fetcher";
import { Bc2Client } from "@/lib/imports/bc2-client";

function makeClient(pages: Array<{ body: unknown; nextUrl?: string | null }>) {
  const client = {
    get: vi.fn()
  } as unknown as Bc2Client;
  let call = 0;
  (client.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const page = pages[call++];
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

  it("fetchMessages uses correct project endpoint", async () => {
    const client = makeClient([{ body: [{ id: 99, subject: "Hello" }], nextUrl: null }]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const msg of fetcher.fetchMessages("42")) {
      results.push(msg);
    }
    expect(results).toHaveLength(1);
    expect((client.get as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("/projects/42/messages.json");
  });

  it("fetchComments uses correct message endpoint", async () => {
    const client = makeClient([{ body: [{ id: 7, content: "great" }], nextUrl: null }]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const c of fetcher.fetchComments("42", "99")) {
      results.push(c);
    }
    expect((client.get as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      "/projects/42/messages/99/comments.json"
    );
  });
});
