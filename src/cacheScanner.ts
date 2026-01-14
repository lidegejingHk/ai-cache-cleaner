import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CacheDirectory {
  path: string;
  name: string;
  size: number;
  sizeFormatted: string;
  safetyLevel: 'safe' | 'caution' | 'danger';
  description: string;
  children?: CacheDirectory[];
  isExpanded?: boolean;
  isSelected?: boolean;
}

export interface ScanResult {
  totalSize: number;
  totalSizeFormatted: string;
  directories: CacheDirectory[];
}

export interface ScanOptions {
  defaultSafetyLevel?: 'safe' | 'caution' | 'danger';
  excludePatterns?: string[];
}

// Default scan options
const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  defaultSafetyLevel: 'caution',
  excludePatterns: []
};

// Current options (can be updated by extension)
let currentOptions: ScanOptions = { ...DEFAULT_SCAN_OPTIONS };

// Update options from extension
export function updateScanOptions(options: Partial<ScanOptions>): void {
  currentOptions = { ...DEFAULT_SCAN_OPTIONS, ...options };
}

// Get current default safety level
function getDefaultSafetyLevel(): 'safe' | 'caution' | 'danger' {
  return currentOptions.defaultSafetyLevel || 'caution';
}

// Directory safety classifications
const SAFETY_MAP: Record<string, { level: 'safe' | 'caution' | 'danger'; description: string }> = {
  // ~/.claude/
  'debug': { level: 'safe', description: 'Debug logs - safe to delete' },
  'shell-snapshots': { level: 'safe', description: 'Shell state snapshots' },
  'telemetry': { level: 'safe', description: 'Usage telemetry data' },
  'cache': { level: 'safe', description: 'Temporary cache files' },
  'image-cache': { level: 'safe', description: 'Cached images' },
  'paste-cache': { level: 'safe', description: 'Paste history cache' },
  'session-env': { level: 'safe', description: 'Session environment data' },
  'statsig': { level: 'safe', description: 'Feature flag cache' },
  'file-history': { level: 'caution', description: 'File edit history - may want to keep' },
  'projects': { level: 'caution', description: 'Project configurations' },
  'todos': { level: 'caution', description: 'Todo items - may contain important notes' },
  'plugins': { level: 'danger', description: 'Installed plugins - do not delete' },
  'ide': { level: 'danger', description: 'IDE integration settings' },
  'plans': { level: 'caution', description: 'Saved plans' },
  'skills': { level: 'danger', description: 'Custom skills - do not delete' },

  // ~/.gemini/antigravity/
  'browser_recordings': { level: 'safe', description: 'Browser recording videos - usually large' },
  'conversations': { level: 'caution', description: 'Conversation history' },
  'brain': { level: 'caution', description: 'AI task artifacts and plans' },
  'implicit': { level: 'safe', description: 'Implicit context cache' },
  'code_tracker': { level: 'caution', description: 'Code tracking data' },
  'context_state': { level: 'safe', description: 'Context state cache' },
  'playground': { level: 'safe', description: 'Playground files' },
  'antigravity-browser-profile': { level: 'safe', description: 'Browser profile cache' },
};

function formatSize(bytes: number): string {
  if (bytes === 0) {return '0 B';}
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

function getSafetyInfo(name: string): { level: 'safe' | 'caution' | 'danger'; description: string } {
  const defaultLevel = getDefaultSafetyLevel();
  return SAFETY_MAP[name] || { level: defaultLevel, description: 'Unknown directory' };
}

function scanDirectory(dirPath: string, depth: number = 1): CacheDirectory[] {
  const result: CacheDirectory[] = [];

  try {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      // Skip hidden files except specific ones
      if (item.startsWith('.') && item !== '.DS_Store') {
        continue;
      }
      if (item === '.DS_Store') {
        continue;
      }

      const itemPath = path.join(dirPath, item);

      try {
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          const size = getDirectorySize(itemPath);
          const safetyInfo = getSafetyInfo(item);

          const dir: CacheDirectory = {
            path: itemPath,
            name: item,
            size,
            sizeFormatted: formatSize(size),
            safetyLevel: safetyInfo.level,
            description: safetyInfo.description,
            isExpanded: false,
            isSelected: false,
          };

          // Scan children for first level
          if (depth > 0) {
            dir.children = scanDirectory(itemPath, depth - 1);
          }

          result.push(dir);
        }
      } catch {
        // Skip items we can't access
      }
    }
  } catch {
    // Skip directories we can't access
  }

  // Sort by size descending
  result.sort((a, b) => b.size - a.size);

  return result;
}

export function scanAllCaches(): ScanResult {
  const homeDir = os.homedir();
  const directories: CacheDirectory[] = [];
  let totalSize = 0;

  // Scan ~/.claude/
  const claudeDir = path.join(homeDir, '.claude');
  if (fs.existsSync(claudeDir)) {
    const claudeSize = getDirectorySize(claudeDir);
    const safetyInfo = { level: 'caution' as const, description: 'Claude Code CLI data' };

    directories.push({
      path: claudeDir,
      name: '.claude',
      size: claudeSize,
      sizeFormatted: formatSize(claudeSize),
      safetyLevel: safetyInfo.level,
      description: safetyInfo.description,
      children: scanDirectory(claudeDir, 1),
      isExpanded: true,
      isSelected: false,
    });
    totalSize += claudeSize;
  }

  // Scan ~/.gemini/
  const geminiDir = path.join(homeDir, '.gemini');
  if (fs.existsSync(geminiDir)) {
    const geminiSize = getDirectorySize(geminiDir);
    const safetyInfo = { level: 'caution' as const, description: 'Gemini/Antigravity data' };

    // Scan antigravity subdirectory specifically
    const antigravityDir = path.join(geminiDir, 'antigravity');
    let children: CacheDirectory[] = [];

    if (fs.existsSync(antigravityDir)) {
      children = scanDirectory(antigravityDir, 1);
    }

    // Also add browser profile
    const browserProfileDir = path.join(geminiDir, 'antigravity-browser-profile');
    if (fs.existsSync(browserProfileDir)) {
      const bpSize = getDirectorySize(browserProfileDir);
      const bpInfo = getSafetyInfo('antigravity-browser-profile');
      children.push({
        path: browserProfileDir,
        name: 'antigravity-browser-profile',
        size: bpSize,
        sizeFormatted: formatSize(bpSize),
        safetyLevel: bpInfo.level,
        description: bpInfo.description,
        isExpanded: false,
        isSelected: false,
      });
    }

    // Sort children by size
    children.sort((a, b) => b.size - a.size);

    directories.push({
      path: geminiDir,
      name: '.gemini',
      size: geminiSize,
      sizeFormatted: formatSize(geminiSize),
      safetyLevel: safetyInfo.level,
      description: safetyInfo.description,
      children,
      isExpanded: true,
      isSelected: false,
    });
    totalSize += geminiSize;
  }

  // Scan ~/Library/Caches/claude-cli-nodejs (macOS)
  if (process.platform === 'darwin') {
    const cacheDir = path.join(homeDir, 'Library', 'Caches', 'claude-cli-nodejs');
    if (fs.existsSync(cacheDir)) {
      const cacheSize = getDirectorySize(cacheDir);

      directories.push({
        path: cacheDir,
        name: 'claude-cli-nodejs',
        size: cacheSize,
        sizeFormatted: formatSize(cacheSize),
        safetyLevel: 'safe',
        description: 'Claude CLI cache - safe to delete',
        isExpanded: false,
        isSelected: false,
      });
      totalSize += cacheSize;
    }
  }

  return {
    totalSize,
    totalSizeFormatted: formatSize(totalSize),
    directories,
  };
}
