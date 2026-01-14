import * as fs from 'fs';
import * as path from 'path';

export interface DeleteResult {
  success: boolean;
  path: string;
  error?: string;
  freedBytes: number;
}

function getDirectorySize(dirPath: string): number {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          size += getDirectorySize(filePath);
        } else {
          size += stats.size;
        }
      } catch {
        // Skip files we can't access
      }
    }
  } catch {
    // Skip directories we can't access
  }
  return size;
}

export async function deleteDirectory(dirPath: string): Promise<DeleteResult> {
  try {
    // Check if path exists
    if (!fs.existsSync(dirPath)) {
      return {
        success: false,
        path: dirPath,
        error: 'Path does not exist',
        freedBytes: 0,
      };
    }

    // Calculate size before deletion
    const stats = fs.statSync(dirPath);
    let freedBytes = 0;

    if (stats.isDirectory()) {
      freedBytes = getDirectorySize(dirPath);
      fs.rmSync(dirPath, { recursive: true, force: true });
    } else {
      freedBytes = stats.size;
      fs.unlinkSync(dirPath);
    }

    return {
      success: true,
      path: dirPath,
      freedBytes,
    };
  } catch (error) {
    return {
      success: false,
      path: dirPath,
      error: error instanceof Error ? error.message : 'Unknown error',
      freedBytes: 0,
    };
  }
}

export async function deleteMultiple(paths: string[]): Promise<{
  results: DeleteResult[];
  totalFreed: number;
  successCount: number;
  failCount: number;
}> {
  const results: DeleteResult[] = [];
  let totalFreed = 0;
  let successCount = 0;
  let failCount = 0;

  for (const p of paths) {
    const result = await deleteDirectory(p);
    results.push(result);

    if (result.success) {
      totalFreed += result.freedBytes;
      successCount++;
    } else {
      failCount++;
    }
  }

  return {
    results,
    totalFreed,
    successCount,
    failCount,
  };
}

export function formatSize(bytes: number): string {
  if (bytes === 0) {return '0 B';}
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
