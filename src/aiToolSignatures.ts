import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AIToolSignature {
  name: string;
  patterns: string[];
  locations: string[];
  safeDirectories: string[];
  cautionDirectories: string[];
  dangerDirectories: string[];
}

export interface SearchResult {
  toolName: string;
  path: string;
  size: number;
  sizeFormatted: string;
  matchedPattern: string;
}

export interface SearchProgress {
  current: number;
  total: number;
  currentPath: string;
  percentage: number;
}

// Known AI Tool Signatures
export const AI_TOOL_SIGNATURES: AIToolSignature[] = [
  {
    name: "Claude Code",
    patterns: [".claude", "claude-cli"],
    locations: ["~", "~/Library/Caches"],
    safeDirectories: ["debug", "cache", "telemetry", "shell-snapshots", "image-cache", "paste-cache", "session-env", "statsig"],
    cautionDirectories: ["projects", "todos", "file-history", "plans"],
    dangerDirectories: ["plugins", "skills", "ide"]
  },
  {
    name: "Gemini/Antigravity",
    patterns: [".gemini", "antigravity"],
    locations: ["~"],
    safeDirectories: ["browser_recordings", "implicit", "context_state", "playground", "antigravity-browser-profile"],
    cautionDirectories: ["conversations", "brain", "code_tracker"],
    dangerDirectories: []
  },
  {
    name: "Cursor",
    patterns: [".cursor", "Cursor"],
    locations: ["~", "~/Library/Application Support", "~/Library/Caches"],
    safeDirectories: ["Cache", "CachedData", "logs", "CachedExtensions"],
    cautionDirectories: ["User", "Backups"],
    dangerDirectories: ["extensions"]
  },
  {
    name: "GitHub Copilot",
    patterns: ["github-copilot", "copilot"],
    locations: ["~/.config", "~/Library/Application Support"],
    safeDirectories: ["cache", "logs"],
    cautionDirectories: ["hosts"],
    dangerDirectories: []
  },
  {
    name: "Codeium",
    patterns: [".codeium", "codeium"],
    locations: ["~", "~/Library/Application Support"],
    safeDirectories: ["cache", "logs"],
    cautionDirectories: [],
    dangerDirectories: ["config"]
  },
  {
    name: "Continue",
    patterns: [".continue"],
    locations: ["~"],
    safeDirectories: ["logs", "index"],
    cautionDirectories: ["sessions"],
    dangerDirectories: ["config"]
  },
  {
    name: "Tabnine",
    patterns: [".tabnine", "tabnine"],
    locations: ["~", "~/Library/Application Support", "~/Library/Caches"],
    safeDirectories: ["cache", "logs"],
    cautionDirectories: [],
    dangerDirectories: ["config"]
  },
  {
    name: "Amazon CodeWhisperer",
    patterns: ["codewhisperer", "aws-toolkit"],
    locations: ["~/.aws", "~/Library/Application Support"],
    safeDirectories: ["cache", "logs"],
    cautionDirectories: [],
    dangerDirectories: []
  },
  {
    name: "Sourcegraph Cody",
    patterns: [".cody", "sourcegraph"],
    locations: ["~", "~/Library/Application Support"],
    safeDirectories: ["cache", "logs"],
    cautionDirectories: ["conversations"],
    dangerDirectories: []
  },
  {
    name: "Windsurf",
    patterns: [".windsurf", "windsurf"],
    locations: ["~", "~/Library/Application Support"],
    safeDirectories: ["cache", "logs"],
    cautionDirectories: [],
    dangerDirectories: []
  }
];

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

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

// Detect AI tools based on known signatures
export function detectKnownAITools(): SearchResult[] {
  const results: SearchResult[] = [];

  for (const signature of AI_TOOL_SIGNATURES) {
    for (const location of signature.locations) {
      const expandedLocation = expandPath(location);

      for (const pattern of signature.patterns) {
        const targetPath = path.join(expandedLocation, pattern);

        if (fs.existsSync(targetPath)) {
          try {
            const stats = fs.statSync(targetPath);
            if (stats.isDirectory()) {
              const size = getDirectorySize(targetPath);
              results.push({
                toolName: signature.name,
                path: targetPath,
                size,
                sizeFormatted: formatSize(size),
                matchedPattern: pattern
              });
            }
          } catch {
            // Skip if we can't access
          }
        }
      }
    }
  }

  return results;
}

// Get safety level for a directory based on AI tool signatures
export function getSafetyLevelFromSignature(
  toolName: string,
  dirName: string
): 'safe' | 'caution' | 'danger' {
  const signature = AI_TOOL_SIGNATURES.find(s => s.name === toolName);
  if (!signature) {return 'caution';}

  if (signature.safeDirectories.includes(dirName)) {return 'safe';}
  if (signature.dangerDirectories.includes(dirName)) {return 'danger';}
  if (signature.cautionDirectories.includes(dirName)) {return 'caution';}

  return 'caution';
}

// Search directories matching a query
export async function* searchDirectories(
  query: string,
  onProgress?: (progress: SearchProgress) => void
): AsyncGenerator<SearchResult> {
  const searchLocations = [
    "~",
    "~/Library/Application Support",
    "~/Library/Caches",
    "~/.config"
  ];

  const normalizedQuery = query.toLowerCase();
  const excludeDirs = new Set(['node_modules', '.git', '.npm', '.yarn', 'Library/Caches/Homebrew']);

  let totalDirs = 0;
  let processedDirs = 0;

  // First pass: count directories for progress
  for (const location of searchLocations) {
    const expandedLocation = expandPath(location);
    if (fs.existsSync(expandedLocation)) {
      try {
        const items = fs.readdirSync(expandedLocation);
        totalDirs += items.length;
      } catch {
        // Skip if can't access
      }
    }
  }

  // Second pass: search
  for (const location of searchLocations) {
    const expandedLocation = expandPath(location);

    if (!fs.existsSync(expandedLocation)) {continue;}

    try {
      const items = fs.readdirSync(expandedLocation);

      for (const item of items) {
        processedDirs++;

        // Skip excluded directories
        if (excludeDirs.has(item)) {continue;}

        const itemPath = path.join(expandedLocation, item);

        // Report progress
        if (onProgress) {
          onProgress({
            current: processedDirs,
            total: totalDirs,
            currentPath: itemPath,
            percentage: Math.round((processedDirs / totalDirs) * 100)
          });
        }

        // Check if directory name matches query
        if (item.toLowerCase().includes(normalizedQuery)) {
          try {
            const stats = fs.statSync(itemPath);
            if (stats.isDirectory()) {
              const size = getDirectorySize(itemPath);

              // Try to identify which tool this belongs to
              let toolName = "Unknown";
              for (const sig of AI_TOOL_SIGNATURES) {
                if (sig.patterns.some(p => item.toLowerCase().includes(p.toLowerCase()))) {
                  toolName = sig.name;
                  break;
                }
              }

              yield {
                toolName,
                path: itemPath,
                size,
                sizeFormatted: formatSize(size),
                matchedPattern: item
              };
            }
          } catch {
            // Skip if can't access
          }
        }

        // Allow other operations to run
        await new Promise(resolve => setImmediate(resolve));
      }
    } catch {
      // Skip if can't access
    }
  }
}

// Synchronous search (for simpler use cases)
export function searchDirectoriesSync(query: string): SearchResult[] {
  const results: SearchResult[] = [];
  const searchLocations = [
    "~",
    "~/Library/Application Support",
    "~/Library/Caches",
    "~/.config"
  ];

  const normalizedQuery = query.toLowerCase();
  const excludeDirs = new Set(['node_modules', '.git', '.npm', '.yarn']);

  for (const location of searchLocations) {
    const expandedLocation = expandPath(location);

    if (!fs.existsSync(expandedLocation)) {continue;}

    try {
      const items = fs.readdirSync(expandedLocation);

      for (const item of items) {
        if (excludeDirs.has(item)) {continue;}

        const itemPath = path.join(expandedLocation, item);

        if (item.toLowerCase().includes(normalizedQuery)) {
          try {
            const stats = fs.statSync(itemPath);
            if (stats.isDirectory()) {
              const size = getDirectorySize(itemPath);

              let toolName = "Unknown";
              for (const sig of AI_TOOL_SIGNATURES) {
                if (sig.patterns.some(p => item.toLowerCase().includes(p.toLowerCase()))) {
                  toolName = sig.name;
                  break;
                }
              }

              results.push({
                toolName,
                path: itemPath,
                size,
                sizeFormatted: formatSize(size),
                matchedPattern: item
              });
            }
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // Skip
    }
  }

  return results;
}
