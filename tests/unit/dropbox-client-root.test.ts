import { beforeEach, describe, expect, it, vi } from "vitest";

type DropboxCtorOptions = Record<string, unknown>;

const instances: Array<{
  options: DropboxCtorOptions;
  usersGetCurrentAccount: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("dropbox", () => ({
  Dropbox: class DropboxMock {
    options: DropboxCtorOptions;
    usersGetCurrentAccount = vi.fn();

    constructor(options: DropboxCtorOptions) {
      this.options = options;
      instances.push(this);
    }
  }
}));

import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

describe("DropboxStorageAdapter root namespace handling", () => {
  beforeEach(() => {
    instances.length = 0;
    delete process.env.DROPBOX_SELECT_USER;
    delete process.env.DROPBOX_SELECT_ADMIN;
    globalThis.fetch = vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(0)
    })) as unknown as typeof fetch;
  });

  it("roots calls to the account root namespace even without DROPBOX_SELECT_USER", async () => {
    const adapter = new DropboxStorageAdapter() as unknown as {
      getClient: () => Promise<unknown>;
    };

    instances[0]?.usersGetCurrentAccount.mockResolvedValue({
      result: {
        root_info: {
          root_namespace_id: "7",
          home_namespace_id: "1"
        }
      }
    });

    const client = await adapter.getClient();

    expect(instances).toHaveLength(2);
    expect(client).toBe(instances[1]);
    expect(instances[1]?.options.pathRoot).toBe(JSON.stringify({ ".tag": "root", root: "7" }));
  });

  it("keeps the base client when the account root matches the home namespace", async () => {
    const adapter = new DropboxStorageAdapter() as unknown as {
      getClient: () => Promise<unknown>;
    };

    instances[0]?.usersGetCurrentAccount.mockResolvedValue({
      result: {
        root_info: {
          root_namespace_id: "1",
          home_namespace_id: "1"
        }
      }
    });

    const client = await adapter.getClient();

    expect(instances).toHaveLength(1);
    expect(client).toBe(instances[0]);
  });
});
