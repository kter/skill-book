// Filesystem-backed storage used when ENVIRONMENT=local and in API tests.
// "Presigned" URLs point back at the API's /v1/local-storage routes so the
// whole upload/download flow works without AWS.

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectNotFoundError, type PresignedUpload, type Storage } from "./index.js";

export class LocalStorage implements Storage {
  constructor(
    private readonly rootDir: string,
    private readonly baseUrl: string,
  ) {}

  private resolve(key: string): string {
    const target = path.resolve(this.rootDir, key);
    if (!target.startsWith(path.resolve(this.rootDir) + path.sep)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return target;
  }

  async createStagingUploadUrl(key: string): Promise<PresignedUpload> {
    return {
      key,
      url: `${this.baseUrl}/v1/local-storage/${key}`,
      method: "PUT",
      expiresInSeconds: 900,
    };
  }

  async getObject(key: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new ObjectNotFoundError(key);
      throw err;
    }
  }

  async getObjectSize(key: string): Promise<number> {
    try {
      return (await stat(this.resolve(key))).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new ObjectNotFoundError(key);
      throw err;
    }
  }

  async putObject(key: string, data: Uint8Array): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async createDownloadUrl(key: string, fileName: string): Promise<string> {
    const encoded = encodeURIComponent(fileName);
    return `${this.baseUrl}/v1/local-storage/${key}?download=${encoded}`;
  }
}
