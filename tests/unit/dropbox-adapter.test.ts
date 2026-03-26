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
});
