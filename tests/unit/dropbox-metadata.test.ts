import { describe, expect, it } from "vitest";
import { DropboxStorageAdapter, mapDropboxMetadata } from "@/lib/storage/dropbox-adapter";

describe("Dropbox metadata mapper", () => {
  it("maps request data to DB column keys", () => {
    const mapped = mapDropboxMetadata({
      projectId: "p1",
      uploaderUserId: "u1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      checksum: "sha256",
      dropboxFileId: "dbx:1",
      dropboxPath: "/BasecampClone/p1/report.pdf"
    });

    expect(mapped.project_id).toBe("p1");
    expect(mapped.uploader_user_id).toBe("u1");
    expect(mapped.filename).toBe("report.pdf");
    expect(mapped.dropbox_file_id).toBe("dbx:1");
  });

  it("treats Dropbox 409 folder conflicts as an existing directory during upload completion", async () => {
    const adapter = new DropboxStorageAdapter() as unknown as {
      uploadComplete: DropboxStorageAdapter["uploadComplete"];
      getClient: () => Promise<{
        filesCreateFolderV2: (args: { path: string; autorename: boolean }) => Promise<unknown>;
        filesGetMetadata: (args: { path: string }) => Promise<unknown>;
        filesUpload: (args: { path: string; contents: Buffer }) => Promise<{ result: { id: string; path_display: string; rev: string } }>;
      }>;
    };

    adapter.getClient = async () => ({
      filesCreateFolderV2: async () => {
        throw {
          status: 409,
          message: "Response failed with a 409 code",
          error: {
            error_summary: "path/conflict/folder/.."
          }
        };
      },
      filesGetMetadata: async () => ({ result: { ".tag": "folder" } }),
      filesUpload: async ({ path }: { path: string; contents: Buffer }) => ({
        result: { id: "dbx:1", path_display: path, rev: "1-abc" }
      })
    });

    const uploaded = await adapter.uploadComplete({
      sessionId: "session-1",
      targetPath: "/projects/acme/uploads/file.txt",
      filename: "file.txt",
      content: Buffer.from("hello"),
      mimeType: "text/plain"
    });

    expect(uploaded.fileId).toBe("dbx:1");
    expect(uploaded.path).toBe("/projects/acme/uploads/file.txt");
  });
});
