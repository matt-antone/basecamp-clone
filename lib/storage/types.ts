export interface StorageAdapter {
  uploadInit(args: { projectStorageDir: string; filename: string; sizeBytes: number }): Promise<{
    sessionId: string;
    targetPath: string;
  }>;
  uploadComplete(args: {
    sessionId: string;
    targetPath: string;
    filename: string;
    content: Buffer;
    mimeType: string;
  }): Promise<{ fileId: string; path: string; rev: string }>;
  createTemporaryDownloadLink(path: string): Promise<string>;
  createFolderLink(path: string): Promise<string>;
  ensureProjectFolders(args: {
    clientSlug: string;
    projectFolderBaseName: string;
  }): Promise<{ projectDir: string; uploadsDir: string }>;
  moveProjectFolder(args: { fromPath: string; toPath: string }): Promise<{ projectDir: string }>;
}
