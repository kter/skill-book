import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ObjectNotFoundError, type PresignedUpload, type Storage } from "./index.js";

export class S3Storage implements Storage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
  ) {
    this.client = new S3Client({ region });
  }

  async createStagingUploadUrl(key: string): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: "application/zip",
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: 900 });
    return { key, url, method: "PUT", expiresInSeconds: 900 };
  }

  async getObject(key: string): Promise<Uint8Array> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return await result.Body!.transformToByteArray();
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === "NoSuchKey") {
        throw new ObjectNotFoundError(key);
      }
      throw err;
    }
  }

  async getObjectSize(key: string): Promise<number> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return result.ContentLength ?? 0;
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") {
        throw new ObjectNotFoundError(key);
      }
      throw err;
    }
  }

  async putObject(key: string, data: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async createDownloadUrl(key: string, fileName: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\w.-]/g, "_")}"`,
    });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }
}
