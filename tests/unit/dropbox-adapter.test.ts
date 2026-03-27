import { beforeEach, describe, expect, it, vi } from "vitest";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

describe("DropboxStorageAdapter", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(0)
    }));
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

    const result = await adapter.downloadFile("/projects/alpha/file.png");

    expect(filesDownloadMock).toHaveBeenCalledWith({ path: "/projects/alpha/file.png" });
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

    const result = await adapter.downloadFile("/projects/alpha/file.png");
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

    const result = await adapter.downloadFile("/projects/alpha/file.png");

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
      fromPath: "/projects/acme/BRGS-0001-website-refresh",
      toPath: "/projects/acme/_Archive/BRGS-0001-website-refresh"
    });

    expect(ensureDirectoryChainMock).toHaveBeenCalledWith("/projects/acme/_Archive");
    expect(filesMoveV2Mock).toHaveBeenCalledWith({
      from_path: "/projects/acme/BRGS-0001-website-refresh",
      to_path: "/projects/acme/_Archive/BRGS-0001-website-refresh",
      autorename: false
    });
    expect(filesGetMetadataMock).toHaveBeenCalledWith({
      path: "/projects/acme/_Archive/BRGS-0001-website-refresh"
    });
    expect(result).toEqual({ projectDir: "/projects/acme/_Archive/BRGS-0001-website-refresh" });
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
        fromPath: "/projects/acme/BRGS-0001-website-refresh",
        toPath: "/projects/acme/_Archive/BRGS-0001-website-refresh"
      })
    ).rejects.toThrow("path/not_found/");
    expect(filesGetMetadataMock).toHaveBeenCalledWith({
      path: "/projects/acme/_Archive/BRGS-0001-website-refresh"
    });
  });
});
