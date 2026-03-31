import { beforeEach, describe, expect, it, vi } from "vitest";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

describe("DropboxStorageAdapter", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(0)
    })) as unknown as typeof fetch;
  });

  it("downloads a file and prefers the top-level content type", async () => {
    const filesDownloadMock = vi.fn().mockResolvedValue({
      result: {
        fileBinary: Buffer.from("file-data"),
        content_type: "image/png",
        metadata: { content_type: "image/webp" }
      }
    });

    const adapter = new DropboxStorageAdapter() as unknown as {
      downloadFile: DropboxStorageAdapter["downloadFile"];
      getClient: () => Promise<{ filesDownload: (args: { path: string }) => Promise<unknown> }>;
    };
    adapter.getClient = async () => ({
      filesDownload: filesDownloadMock
    });

    const result = await adapter.downloadFile("/Projects/alpha/file.png");

    expect(filesDownloadMock).toHaveBeenCalledWith({ path: "/Projects/alpha/file.png" });
    expect(result.bytes).toEqual(Buffer.from("file-data"));
    expect(result.contentType).toBe("image/png");
  });

  it("uses the metadata content type when the top-level field is missing", async () => {
    const filesDownloadMock = vi.fn().mockResolvedValue({
      result: {
        fileBinary: Buffer.from("metadata-data"),
        metadata: { content_type: "image/jpeg" }
      }
    });

    const adapter = new DropboxStorageAdapter() as unknown as {
      downloadFile: DropboxStorageAdapter["downloadFile"];
      getClient: () => Promise<{ filesDownload: (args: { path: string }) => Promise<unknown> }>;
    };
    adapter.getClient = async () => ({
      filesDownload: filesDownloadMock
    });

    const result = await adapter.downloadFile("/Projects/alpha/file.png");
    expect(result.contentType).toBe("image/jpeg");
  });

  it("falls back to application/octet-stream when metadata lacks a content type", async () => {
    const filesDownloadMock = vi.fn().mockResolvedValue({
      result: {
        fileBinary: Buffer.from("other-data")
      }
    });

    const adapter = new DropboxStorageAdapter() as unknown as {
      downloadFile: DropboxStorageAdapter["downloadFile"];
      getClient: () => Promise<{ filesDownload: (args: { path: string }) => Promise<unknown> }>;
    };
    adapter.getClient = async () => ({
      filesDownload: filesDownloadMock
    });

    const result = await adapter.downloadFile("/Projects/alpha/file.png");

    expect(result.contentType).toBe("application/octet-stream");
  });

  it("treats a missing source move as already moved when destination exists", async () => {
    const filesMoveV2Mock = vi.fn().mockRejectedValue(new Error("path/not_found/"));
    const filesGetMetadataMock = vi.fn().mockResolvedValue({ result: { ".tag": "folder" } });
    const ensureDirectoryChainMock = vi.fn().mockResolvedValue(undefined);

    const adapter = new DropboxStorageAdapter() as unknown as {
      moveProjectFolder: DropboxStorageAdapter["moveProjectFolder"];
      getClient: () => Promise<{
        filesMoveV2: (args: { from_path: string; to_path: string; autorename: boolean }) => Promise<unknown>;
        filesGetMetadata: (args: { path: string }) => Promise<unknown>;
      }>;
      ensureDirectoryChain: (path: string) => Promise<void>;
    };
    adapter.getClient = async () => ({
      filesMoveV2: filesMoveV2Mock,
      filesGetMetadata: filesGetMetadataMock
    });
    adapter.ensureDirectoryChain = ensureDirectoryChainMock;

    const result = await adapter.moveProjectFolder({
      fromPath: "/Projects/BRGS/BRGS-0001-Acme Website Refresh",
      toPath: "/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh"
    });

    expect(ensureDirectoryChainMock).toHaveBeenCalledWith("/Projects/BRGS/_Archive");
    expect(filesMoveV2Mock).toHaveBeenCalledWith({
      from_path: "/Projects/BRGS/BRGS-0001-Acme Website Refresh",
      to_path: "/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh",
      autorename: false
    });
    expect(filesGetMetadataMock).toHaveBeenCalledWith({
      path: "/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh"
    });
    expect(result).toEqual({ projectDir: "/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh" });
  });

  it("rethrows when source is missing and destination also does not exist", async () => {
    const moveError = new Error("path/not_found/");
    const filesMoveV2Mock = vi.fn().mockRejectedValue(moveError);
    const filesGetMetadataMock = vi.fn().mockRejectedValue(new Error("path/not_found/"));
    const ensureDirectoryChainMock = vi.fn().mockResolvedValue(undefined);

    const adapter = new DropboxStorageAdapter() as unknown as {
      moveProjectFolder: DropboxStorageAdapter["moveProjectFolder"];
      getClient: () => Promise<{
        filesMoveV2: (args: { from_path: string; to_path: string; autorename: boolean }) => Promise<unknown>;
        filesGetMetadata: (args: { path: string }) => Promise<unknown>;
      }>;
      ensureDirectoryChain: (path: string) => Promise<void>;
    };
    adapter.getClient = async () => ({
      filesMoveV2: filesMoveV2Mock,
      filesGetMetadata: filesGetMetadataMock
    });
    adapter.ensureDirectoryChain = ensureDirectoryChainMock;

    await expect(
      adapter.moveProjectFolder({
        fromPath: "/Projects/BRGS/BRGS-0001-Acme Website Refresh",
        toPath: "/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh"
      })
    ).rejects.toThrow("path/not_found/");
    expect(filesGetMetadataMock).toHaveBeenCalledWith({
      path: "/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh"
    });
  });
});
