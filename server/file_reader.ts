import fs from 'fs/promises';
import { Logger } from 'src/core/server';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const PDF_MAGIC = Buffer.from('%PDF');

export class FileReaderService {
  private fileCache = new Map<string, { mtime: Date; data: string }>();

  constructor(private readonly logger: Logger) {}

  async readFileAsBase64(path: string, expectedType: 'png' | 'pdf'): Promise<string> {
    try {
      const stats = await fs.stat(path);
      const cached = this.fileCache.get(path);

      if (cached && stats.mtime <= cached.mtime) {
        return cached.data;
      }

      const buffer = await fs.readFile(path);
      this.validateFile(buffer, path, expectedType);

      const base64Data = buffer.toString('base64');
      this.fileCache.set(path, { mtime: stats.mtime, data: base64Data });
      
      return base64Data;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`File read error: ${errMsg}`);
      throw new Error(`Failed to read ${path}: ${errMsg}`);
    }
  }

  private validateFile(buffer: Buffer, path: string, expectedType: 'png' | 'pdf') {
    if (expectedType === 'png') {
      if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) {
        throw new Error(`Invalid PNG file: ${path}`);
      }
    } else {
      if (!buffer.subarray(0, 4).equals(PDF_MAGIC)) {
        throw new Error(`Invalid PDF file: ${path}`);
      }
    }
  }
}