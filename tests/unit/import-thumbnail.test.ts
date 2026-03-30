import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  ImportThumbnailService,
  classifyImportThumbnailSource,
  ensureImportedFileThumbnail,
  getImportedThumbnailPath,
  isSupportedImportThumbnailSource
} from "@/lib/import-thumbnail";

describe("import thumbnail helpers", () => {
  it("builds the deterministic thumbnail path", () => {
    expect(getImportedThumbnailPath("/projects/brgs/BRGS-0001-site-refresh", "file-123")).toBe(
      "/projects/brgs/BRGS-0001-site-refresh/uploads/.thumbnails/file-123.jpg"
    );
  });

  it("classifies supported thumbnail sources", () => {
    expect(classifyImportThumbnailSource({ filename: "photo.png", mimeType: "image/png" })).toBe("image");
    expect(classifyImportThumbnailSource({ filename: "report.pdf", mimeType: "application/octet-stream" })).toBe("pdf");
    expect(classifyImportThumbnailSource({ filename: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe(
      "office"
    );
    expect(isSupportedImportThumbnailSource({ filename: "notes.txt", mimeType: "text/plain" })).toBe(false);
  });
});

describe("ImportThumbnailService", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "import-thumbnail-test-"));
  });

  it("generates an image thumbnail once and reuses the saved thumbnail on rerun", async () => {
    const uploadedPaths: string[] = [];
    const createdFolders: string[] = [];
    const sourceDownloads: string[] = [];
    const thumbnailPath = "/projects/brgs/BRGS-0001-site-refresh/uploads/.thumbnails/file-1.jpg";
    const existingPaths = new Set<string>();
    const client = {
      filesCreateFolderV2: vi.fn(async ({ path }: { path: string }) => {
        if (createdFolders.includes(path)) {
          throw new Error("path/conflict/folder");
        }
        createdFolders.push(path);
      }),
      filesGetMetadata: vi.fn(async ({ path }: { path: string }) => {
        if (!existingPaths.has(path)) {
          throw new Error("not_found");
        }
        return { result: { path } };
      }),
      filesUpload: vi.fn(async ({ path, contents }: { path: string; contents: Buffer }) => {
        uploadedPaths.push(path);
        existingPaths.add(path);
        expect(contents.byteLength).toBeGreaterThan(0);
        return { result: { id: "uploaded-thumbnail" } };
      })
    };

    const commandRunner = vi.fn(async (command: string, args: string[]) => {
      expect(command).toBe("magick");
      const outputPath = args.at(-1);
      if (!outputPath) {
        throw new Error("missing output path");
      }
      await writeFile(outputPath, Buffer.from("thumbnail-bytes"));
    });

    const service = new ImportThumbnailService({
      tempRoot,
      commandRunner,
      storageAdapter: {
        downloadFile: vi.fn(async (path: string) => {
          sourceDownloads.push(path);
          return { bytes: Buffer.from("source-bytes"), contentType: "image/png" };
        }),
        getClient: async () => client
      }
    });

    const first = await service.ensureImportedThumbnail({
      projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
      projectFileId: "file-1",
      filename: "photo.png",
      mimeType: "image/png",
      dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/photo.png"
    });

    expect(first.action).toBe("generated");
    expect((first as { thumbnailPath: string }).thumbnailPath).toBe(thumbnailPath);
    expect(sourceDownloads).toEqual(["/projects/brgs/BRGS-0001-site-refresh/uploads/photo.png"]);
    expect(uploadedPaths).toEqual([thumbnailPath]);

    const second = await service.ensureImportedThumbnail({
      projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
      projectFileId: "file-1",
      filename: "photo.png",
      mimeType: "image/png",
      dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/photo.png"
    });

    expect(second.action).toBe("reused");
    expect(commandRunner).toHaveBeenCalledTimes(1);
    expect(sourceDownloads).toHaveLength(1);
    expect(uploadedPaths).toHaveLength(1);
  });

  it("runs soffice then pdftoppm for office files", async () => {
    const commands: Array<{ command: string; args: string[] }> = [];
    const client = {
      filesCreateFolderV2: vi.fn(async () => ({})),
      filesGetMetadata: vi.fn(async () => {
        throw new Error("not_found");
      }),
      filesUpload: vi.fn(async () => ({ result: { id: "uploaded-thumbnail" } }))
    };

    const commandRunner = vi.fn(async (command: string, args: string[]) => {
      commands.push({ command, args });
      if (command === "soffice") {
        const outDirIndex = args.indexOf("--outdir");
        const outDir = args[outDirIndex + 1];
        const inputPath = args.at(-1);
        if (!outDir || !inputPath) {
          throw new Error("missing soffice args");
        }
        const pdfPath = join(outDir, `${basename(inputPath, extname(inputPath))}.pdf`);
        await writeFile(pdfPath, Buffer.from("converted-pdf"));
        return;
      }
      if (command === "pdftoppm") {
        const outputBase = args.at(-1);
        if (!outputBase) {
          throw new Error("missing pdftoppm output base");
        }
        await writeFile(`${outputBase}.jpg`, Buffer.from("rasterized-jpg"));
      }
    });

    const service = new ImportThumbnailService({
      tempRoot,
      commandRunner,
      storageAdapter: {
        downloadFile: vi.fn(async () => ({ bytes: Buffer.from("office-bytes"), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })),
        getClient: async () => client
      }
    });

    const result = await service.ensureImportedThumbnail({
      projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
      projectFileId: "file-2",
      filename: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.docx"
    });

    expect(result.action).toBe("generated");
    expect(commands.map((entry) => entry.command)).toEqual(["soffice", "pdftoppm"]);
    expect(commands[0].args).toContain("--convert-to");
    expect(commands[1].args).toContain("-singlefile");
  });

  it("skips unsupported mime types without shell work", async () => {
    const commandRunner = vi.fn();
    const downloadFile = vi.fn();
    const service = new ImportThumbnailService({
      tempRoot,
      commandRunner,
      storageAdapter: {
        downloadFile,
        getClient: async () => ({
          filesCreateFolderV2: vi.fn(),
          filesGetMetadata: vi.fn(),
          filesUpload: vi.fn()
        })
      }
    });

    const result = await service.ensureImportedThumbnail({
      projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
      projectFileId: "file-3",
      filename: "notes.txt",
      mimeType: "text/plain",
      dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/notes.txt"
    });

    expect(result.action).toBe("skipped");
    expect(downloadFile).not.toHaveBeenCalled();
    expect(commandRunner).not.toHaveBeenCalled();
  });
});

describe("ensureImportedFileThumbnail worker integration", () => {
  it("uses external worker when configured and returns worker action", async () => {
    const downloadFile = vi.fn(async () => ({
      bytes: Buffer.from("worker-source-bytes"),
      contentType: "application/pdf"
    }));
    const fetchFnMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          action: "generated",
          thumbnailPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/.thumbnails/file-99.jpg",
          thumbnailUrl: "https://thumbs.example.internal/thumbnails/file-99.jpg",
          message: "generated by worker"
        })
    }));
    const fetchFn = fetchFnMock as unknown as typeof fetch;

    const result = await ensureImportedFileThumbnail(
      {
        projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
        projectFileId: "file-99",
        filename: "report.pdf",
        mimeType: "application/pdf",
        dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
      },
      {
        workerUrl: "https://thumbs.example.internal/",
        workerToken: "secret-token",
        fetchFn,
        storageAdapter: {
          downloadFile
        }
      }
    );

    expect(result).toMatchObject({
      action: "generated",
      thumbnailPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/.thumbnails/file-99.jpg",
      thumbnailUrl: "https://thumbs.example.internal/thumbnails/file-99.jpg"
    });
    expect(downloadFile).toHaveBeenCalledWith("/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFnMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://thumbs.example.internal/thumbnails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer secret-token"
    });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    const formData = init.body as FormData;
    expect(formData.get("projectFileId")).toBe("file-99");
    expect(formData.get("filename")).toBe("report.pdf");
    expect(formData.get("mimeType")).toBe("application/pdf");
    const file = formData.get("file");
    expect(file).toBeInstanceOf(File);
    const uploadedFile = file as File;
    expect(uploadedFile.name).toBe("report.pdf");
    expect(uploadedFile.type).toBe("application/pdf");
    expect(Buffer.from(await uploadedFile.arrayBuffer())).toEqual(Buffer.from("worker-source-bytes"));
  });

  it("normalizes bearer-prefixed worker tokens before sending Authorization header", async () => {
    const downloadFile = vi.fn(async () => ({
      bytes: Buffer.from("worker-source-bytes"),
      contentType: "application/pdf"
    }));
    const fetchFnMock2 = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ action: "generated" })
    }));
    const fetchFn = fetchFnMock2 as unknown as typeof fetch;

    await ensureImportedFileThumbnail(
      {
        projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
        projectFileId: "file-99",
        filename: "report.pdf",
        mimeType: "application/pdf",
        dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
      },
      {
        workerUrl: "https://thumbs.example.internal",
        workerToken: "Bearer secret-token",
        fetchFn,
        storageAdapter: {
          downloadFile
        }
      }
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFnMock2.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({
      Authorization: "Bearer secret-token"
    });
  });

  it("throws when worker url is configured without token", async () => {
    await expect(
      ensureImportedFileThumbnail(
        {
          projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
          projectFileId: "file-99",
          filename: "report.pdf",
          mimeType: "application/pdf",
          dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
        },
        {
          workerUrl: "https://thumbs.example.internal",
          workerToken: null
        }
      )
    ).rejects.toThrow("THUMBNAIL_WORKER_TOKEN is required");
  });

  it("throws when worker token only contains bearer prefix", async () => {
    await expect(
      ensureImportedFileThumbnail(
        {
          projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
          projectFileId: "file-99",
          filename: "report.pdf",
          mimeType: "application/pdf",
          dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
        },
        {
          workerUrl: "https://thumbs.example.internal",
          workerToken: "Bearer   "
        }
      )
    ).rejects.toThrow("THUMBNAIL_WORKER_TOKEN is required");
  });

  it("rejects path-bearing worker URLs before issuing the request", async () => {
    const downloadFile = vi.fn();
    const fetchFn = vi.fn();

    await expect(
      ensureImportedFileThumbnail(
        {
          projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
          projectFileId: "file-99",
          filename: "report.pdf",
          mimeType: "application/pdf",
          dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
        },
        {
          workerUrl: "https://thumbs.example.internal/thumbnails/",
          workerToken: "secret-token",
          fetchFn,
          storageAdapter: {
            downloadFile
          }
        }
      )
    ).rejects.toThrow(
      "thumbnail worker URL must be origin-only, for example https://thumbs.example.internal. Remove any path such as /thumbnails."
    );

    expect(downloadFile).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws clear error when worker responds non-200", async () => {
    const downloadFile = vi.fn(async () => ({
      bytes: Buffer.from("worker-source-bytes"),
      contentType: "application/pdf"
    }));
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "worker failed"
    })) as unknown as typeof fetch;

    await expect(
      ensureImportedFileThumbnail(
        {
          projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
          projectFileId: "file-99",
          filename: "report.pdf",
          mimeType: "application/pdf",
          dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
        },
        {
          workerUrl: "https://thumbs.example.internal",
          workerToken: "secret-token",
          fetchFn,
          storageAdapter: {
            downloadFile
          }
        }
      )
    ).rejects.toThrow("Thumbnail worker request failed (500): worker failed");
    expect(downloadFile).toHaveBeenCalledWith("/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf");
  });

  it("classifies worker 404 responses as likely URL misconfiguration", async () => {
    const downloadFile = vi.fn(async () => ({
      bytes: Buffer.from("worker-source-bytes"),
      contentType: "application/pdf"
    }));
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "not found"
    })) as unknown as typeof fetch;

    await expect(
      ensureImportedFileThumbnail(
        {
          projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
          projectFileId: "file-99",
          filename: "report.pdf",
          mimeType: "application/pdf",
          dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
        },
        {
          workerUrl: "https://thumbs.example.internal",
          workerToken: "secret-token",
          fetchFn,
          storageAdapter: {
            downloadFile
          }
        }
      )
    ).rejects.toThrow(
      "Thumbnail worker request failed (404): not found. This usually means THUMBNAIL_WORKER_URL is misconfigured. Set it to the worker origin only, without /thumbnails or any other path."
    );
  });
});
