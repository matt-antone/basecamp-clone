import { describe, expect, it } from "vitest";
import { mapDropboxMetadata } from "@/lib/storage/dropbox-adapter";

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
});
