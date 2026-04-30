export interface StorageAdapter {
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
    /** Client code only, uppercase (Dropbox segment under projects root). */
    clientCodeUpper: string;
    projectFolderBaseName: string;
  }): Promise<{ projectDir: string; uploadsDir: string }>;
  moveProjectFolder(args: { fromPath: string; toPath: string }): Promise<{ projectDir: string }>;
}
