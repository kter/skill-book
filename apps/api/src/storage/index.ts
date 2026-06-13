export interface PresignedUpload {
  key: string;
  url: string;
  method: "PUT";
  expiresInSeconds: number;
}

export interface Storage {
  /** Presigned (or local) URL the client PUTs the staged zip to. */
  createStagingUploadUrl(key: string): Promise<PresignedUpload>;
  getObject(key: string): Promise<Uint8Array>;
  getObjectSize(key: string): Promise<number>;
  putObject(key: string, data: Uint8Array, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  /** Presigned (or local) URL serving the object as a download. */
  createDownloadUrl(key: string, fileName: string): Promise<string>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}
