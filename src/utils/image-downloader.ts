import * as fs from 'fs';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { logger } from './logger';

export class ImageDownloader {
  private apiKey: string;
  private tempDir: string = '/tmp';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Download an image from Linear uploads with authentication
   * @param imageUrl The Linear image URL
   * @param issueIdentifier The issue identifier for naming the file
   * @param index The index of the image in the issue
   * @returns The local file path of the downloaded image, or null if download failed
   */
  async downloadLinearImage(imageUrl: string, issueIdentifier: string, index: number): Promise<string | null> {
    try {
      const url = new URL(imageUrl);
      const extension = this.getFileExtension(imageUrl);
      const localFileName = `linear-image-${issueIdentifier}-${index}${extension}`;
      const localFilePath = path.join(this.tempDir, localFileName);

      // Check if file already exists
      try {
        await fsPromises.access(localFilePath);
        logger.debug({ localFilePath }, 'Image already exists locally');
        return localFilePath;
      } catch {
        // File doesn't exist, proceed with download
      }

      // Download the image with Linear authentication
      await this.downloadFile(url, localFilePath);
      
      logger.info({ imageUrl, localFilePath }, 'Successfully downloaded Linear image');
      return localFilePath;
    } catch (error) {
      logger.error({ error, imageUrl }, 'Failed to download Linear image');
      return null;
    }
  }

  /**
   * Extract file extension from URL or default to .png
   */
  private getFileExtension(url: string): string {
    const urlPath = new URL(url).pathname;
    const match = urlPath.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i);
    return match ? match[0] : '.png';
  }

  /**
   * Download a file from a URL with authentication
   */
  private async downloadFile(url: URL, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Authorization': this.apiKey,
          'User-Agent': 'linear-mcp/1.0',
        },
      };

      const file = fs.createWriteStream(destPath);
      
      const request = protocol.get(options, (response) => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (error) => {
        file.close();
        fs.unlinkSync(destPath);
        reject(error);
      });

      file.on('error', (error) => {
        file.close();
        fs.unlinkSync(destPath);
        reject(error);
      });
    });
  }

  /**
   * Process content to find and replace Linear image URLs
   * @param content The content containing potential image URLs
   * @param issueIdentifier The issue identifier for naming files
   * @returns The content with replaced URLs
   */
  async processContent(content: string, issueIdentifier: string): Promise<string> {
    if (!content) return content;

    // Match markdown image syntax with Linear uploads URL
    const imageRegex = /!\[([^\]]*)\]\((https:\/\/uploads\.linear\.app\/[^)]+)\)/g;
    
    let processedContent = content;
    let imageIndex = 1;
    const matches = Array.from(content.matchAll(imageRegex));

    for (const match of matches) {
      const [fullMatch, altText, imageUrl] = match;
      
      const localPath = await this.downloadLinearImage(imageUrl, issueIdentifier, imageIndex);
      
      if (localPath) {
        // Replace the URL with the local path
        const replacement = `![${altText}](${localPath})`;
        processedContent = processedContent.replace(fullMatch, replacement);
        imageIndex++;
      }
      // If download failed, keep the original URL
    }

    return processedContent;
  }

  /**
   * Clean up old temporary files (optional cleanup strategy)
   * @param olderThanHours Delete files older than this many hours
   */
  async cleanupOldFiles(olderThanHours: number = 24): Promise<void> {
    try {
      const files = await fsPromises.readdir(this.tempDir);
      const now = Date.now();
      const maxAge = olderThanHours * 60 * 60 * 1000;

      for (const file of files) {
        if (file.startsWith('linear-image-')) {
          const filePath = path.join(this.tempDir, file);
          const stats = await fsPromises.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fsPromises.unlink(filePath);
            logger.debug({ filePath }, 'Cleaned up old Linear image');
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error cleaning up old Linear images');
    }
  }
}