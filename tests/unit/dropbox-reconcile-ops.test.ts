import { describe, expect, it, vi } from "vitest";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

type FakeClient = {
  filesListFolder: ReturnType<typeof vi.fn>;
  filesListFolderContinue: ReturnType<typeof vi.fn>;
  filesMoveV2: ReturnType<typeof vi.fn>;
};

function adapterWithClient(client: FakeClient) {
  const adapter = new DropboxStorageAdapter() as unknown as {
    listFolderEntries: DropboxStorageAdapter["listFolderEntries"];
    moveFile: DropboxStorageAdapter["moveFile"];
    getClient: () => Promise<FakeClient>;
  };
  adapter.getClient = async () => client;
  return adapter;
}

describe("DropboxStorageAdapter.listFolderEntries", () => {
  it("returns all file entries across pagination", async () => {
    const client: FakeClient = {
      filesListFolder: vi.fn().mockResolvedValue({
        result: {
          entries: [
            { ".tag": "file", name: "a.pdf", path_display: "/u/a.pdf", id: "id:a" },
            { ".tag": "folder", name: "sub", path_display: "/u/sub", id: "id:s" }
          ],
          cursor: "c1",
          has_more: true
        }
      }),
      filesListFolderContinue: vi.fn().mockResolvedValue({
        result: {
          entries: [
            { ".tag": "file", name: "b.pdf", path_display: "/u/b.pdf", id: "id:b" }
          ],
          cursor: "c2",
          has_more: false
        }
      }),
      filesMoveV2: vi.fn()
    };
    const adapter = adapterWithClient(client);
    const entries = await adapter.listFolderEntries("/u");
    expect(entries.map((e) => e.name)).toEqual(["a.pdf", "sub", "b.pdf"]);
    expect(client.filesListFolder).toHaveBeenCalledWith({ path: "/u", recursive: false });
    expect(client.filesListFolderContinue).toHaveBeenCalledWith({ cursor: "c1" });
  });

  it("returns an empty array for a non-existent folder (path/not_found)", async () => {
    const notFound = Object.assign(new Error("not_found"), {
      error: { error_summary: "path/not_found/.." }
    });
    const client: FakeClient = {
      filesListFolder: vi.fn().mockRejectedValue(notFound),
      filesListFolderContinue: vi.fn(),
      filesMoveV2: vi.fn()
    };
    const adapter = adapterWithClient(client);
    expect(await adapter.listFolderEntries("/missing")).toEqual([]);
  });
});

describe("DropboxStorageAdapter.moveFile", () => {
  it("moves by path with autorename=false by default", async () => {
    const client: FakeClient = {
      filesListFolder: vi.fn(),
      filesListFolderContinue: vi.fn(),
      filesMoveV2: vi.fn().mockResolvedValue({
        result: { metadata: { path_display: "/u/foo.pdf", id: "id:1", rev: "r" } }
      })
    };
    const adapter = adapterWithClient(client);
    const result = await adapter.moveFile({ from: "/u/old.pdf", to: "/u/foo.pdf" });
    expect(client.filesMoveV2).toHaveBeenCalledWith({
      from_path: "/u/old.pdf",
      to_path: "/u/foo.pdf",
      autorename: false
    });
    expect(result.path).toBe("/u/foo.pdf");
  });

  it("moves by Dropbox file id using the id: prefix form", async () => {
    const client: FakeClient = {
      filesListFolder: vi.fn(),
      filesListFolderContinue: vi.fn(),
      filesMoveV2: vi.fn().mockResolvedValue({
        result: { metadata: { path_display: "/u/foo.pdf", id: "id:abc", rev: "r" } }
      })
    };
    const adapter = adapterWithClient(client);
    await adapter.moveFile({ fromId: "id:abc", to: "/u/foo.pdf" });
    expect(client.filesMoveV2).toHaveBeenCalledWith({
      from_path: "id:abc",
      to_path: "/u/foo.pdf",
      autorename: false
    });
  });
});
