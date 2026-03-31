// tests/unit/bc2-fetcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { Bc2Fetcher, parseBc2IsoTimestamptz } from "@/lib/imports/bc2-fetcher";
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

describe("parseBc2IsoTimestamptz", () => {
  it("returns null for empty or invalid input", () => {
    expect(parseBc2IsoTimestamptz(null)).toBeNull();
    expect(parseBc2IsoTimestamptz(undefined)).toBeNull();
    expect(parseBc2IsoTimestamptz("")).toBeNull();
    expect(parseBc2IsoTimestamptz("   ")).toBeNull();
    expect(parseBc2IsoTimestamptz("not-a-date")).toBeNull();
  });

  it("parses ISO strings to Date", () => {
    const d = parseBc2IsoTimestamptz("2024-01-01T00:00:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });
});

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

  it("fetchProjects omits archived endpoint by default", async () => {
    const active = {
      id: 1,
      name: "Active",
      description: null,
      archived: false,
      created_at: "",
      updated_at: ""
    };
    const client = makeClient([{ body: [active], nextUrl: null }]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const p of fetcher.fetchProjects()) {
      results.push(p);
    }
    expect(results).toEqual([active]);
    const calls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(c => String(c[0]).includes("/projects.json"))).toBe(true);
    expect(calls.some(c => String(c[0]).includes("/archived"))).toBe(false);
  });

  it("fetchProjects({ source: 'all' }) paginates active then archived", async () => {
    const active = {
      id: 1,
      name: "A",
      description: null,
      archived: false,
      created_at: "",
      updated_at: ""
    };
    const archived = {
      id: 2,
      name: "Old",
      description: null,
      archived: true,
      created_at: "",
      updated_at: ""
    };
    const client = makeClient([
      { body: [active], nextUrl: null },
      { body: [archived], nextUrl: null }
    ]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const p of fetcher.fetchProjects({ source: "all" })) {
      results.push(p);
    }
    expect(results).toEqual([active, archived]);
    const calls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(c => String(c[0]).includes("/projects/archived.json"))).toBe(true);
  });

  it("fetchProjects({ source: 'archived' }) uses only archived endpoint", async () => {
    const archived = {
      id: 2,
      name: "Old",
      description: null,
      archived: true,
      created_at: "",
      updated_at: ""
    };
    const client = makeClient([{ body: [archived], nextUrl: null }]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const p of fetcher.fetchProjects({ source: "archived" })) {
      results.push(p);
    }
    expect(results).toEqual([archived]);
    const calls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain("/projects/archived.json");
    expect(String(calls[0][0])).not.toContain("/projects.json");
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
