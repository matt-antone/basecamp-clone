import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectFilesPanel } from "@/components/projects/project-files-panel";

describe("ProjectFilesPanel", () => {
  it("renders dropzone and empty-state messaging", () => {
    const markup = renderToStaticMarkup(
      <ProjectFilesPanel
        projectId="project-1"
        token={null}
        onToken={vi.fn()}
        files={[]}
        selectedFile={null}
        isUploading={false}
        isFileDragActive={false}
        fileInputRef={createRef<HTMLInputElement>()}
        onFileInputSelection={vi.fn()}
        onSetFileDragActive={vi.fn()}
        onOpenProjectFolder={vi.fn()}
        onUploadSelectedFile={vi.fn()}
        onClearSelectedFile={vi.fn()}
        onDownloadFile={vi.fn()}
        getFileBadgeLabel={() => "FILE"}
      />
    );

    expect(markup).toContain(">Open Dropbox folder<");
    expect(markup).toContain(">Drop a file here<");
    expect(markup).toContain(">No files yet. Upload one to start your project workspace.<");
  });

  it("renders selected file queue details", () => {
    const selectedFile = new File(["demo"], "demo.pdf", { type: "application/pdf" });

    const markup = renderToStaticMarkup(
      <ProjectFilesPanel
        projectId="project-1"
        token={null}
        onToken={vi.fn()}
        files={[]}
        selectedFile={selectedFile}
        isUploading={false}
        isFileDragActive={false}
        fileInputRef={createRef<HTMLInputElement>()}
        onFileInputSelection={vi.fn()}
        onSetFileDragActive={vi.fn()}
        onOpenProjectFolder={vi.fn()}
        onUploadSelectedFile={vi.fn()}
        onClearSelectedFile={vi.fn()}
        onDownloadFile={vi.fn()}
        getFileBadgeLabel={() => "PDF"}
      />
    );

    expect(markup).toContain(">demo.pdf<");
    expect(markup).toContain("ready to upload");
    expect(markup).toContain(">Upload File<");
  });
});
