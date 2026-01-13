import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Mock VSCode module for testing
const vscode = {
  window: {
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
  }
};

// Import modules to test
import { scanAllCaches, CacheDirectory } from '../../cacheScanner';
import { deleteDirectory, deleteMultiple, formatSize } from '../../cacheDeleter';
import {
  AI_TOOL_SIGNATURES,
  detectKnownAITools,
  searchDirectoriesSync,
  AIToolSignature
} from '../../aiToolSignatures';
import {
  SAFETY_DEFINITIONS,
  getSafetyTooltip,
  getLevelChangeWarning
} from '../../safetyLevels';

suite('Cache Scanner Tests', () => {
  test('scanAllCaches returns valid structure', () => {
    const result = scanAllCaches();

    assert.ok(result, 'Result should not be null');
    assert.ok(typeof result.totalSize === 'number', 'totalSize should be a number');
    assert.ok(typeof result.totalSizeFormatted === 'string', 'totalSizeFormatted should be a string');
    assert.ok(Array.isArray(result.directories), 'directories should be an array');
  });

  test('scanAllCaches detects .claude directory if exists', () => {
    const claudeDir = path.join(os.homedir(), '.claude');
    const result = scanAllCaches();

    if (fs.existsSync(claudeDir)) {
      const found = result.directories.some((d: CacheDirectory) => d.name === '.claude');
      assert.ok(found, '.claude directory should be detected');
    }
  });

  test('scanAllCaches detects .gemini directory if exists', () => {
    const geminiDir = path.join(os.homedir(), '.gemini');
    const result = scanAllCaches();

    if (fs.existsSync(geminiDir)) {
      const found = result.directories.some((d: CacheDirectory) => d.name === '.gemini');
      assert.ok(found, '.gemini directory should be detected');
    }
  });
});

suite('Cache Deleter Tests', () => {
  const testDir = path.join(os.tmpdir(), 'ai-cache-cleaner-test');

  setup(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  teardown(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('formatSize formats bytes correctly', () => {
    assert.strictEqual(formatSize(0), '0 B');
    assert.strictEqual(formatSize(1024), '1 KB');
    assert.strictEqual(formatSize(1048576), '1 MB');
    assert.strictEqual(formatSize(1073741824), '1 GB');
  });

  test('deleteDirectory handles non-existent path', async () => {
    const result = await deleteDirectory('/non/existent/path');

    assert.strictEqual(result.success, false);
    assert.ok(result.error, 'Should have error message');
  });

  test('deleteDirectory deletes existing directory', async () => {
    const subDir = path.join(testDir, 'to-delete');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'test.txt'), 'test content');

    const result = await deleteDirectory(subDir);

    assert.strictEqual(result.success, true);
    assert.ok(!fs.existsSync(subDir), 'Directory should be deleted');
  });

  test('deleteMultiple returns correct counts', async () => {
    const dir1 = path.join(testDir, 'dir1');
    const dir2 = path.join(testDir, 'dir2');
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });

    const result = await deleteMultiple([dir1, dir2, '/non/existent']);

    assert.strictEqual(result.successCount, 2);
    assert.strictEqual(result.failCount, 1);
  });
});

suite('AI Tool Signatures Tests', () => {
  test('AI_TOOL_SIGNATURES contains expected tools', () => {
    const toolNames = AI_TOOL_SIGNATURES.map((s: AIToolSignature) => s.name);

    assert.ok(toolNames.includes('Claude Code'), 'Should include Claude Code');
    assert.ok(toolNames.includes('Gemini/Antigravity'), 'Should include Gemini');
    assert.ok(toolNames.includes('Cursor'), 'Should include Cursor');
    assert.ok(toolNames.includes('GitHub Copilot'), 'Should include GitHub Copilot');
  });

  test('Each signature has required fields', () => {
    for (const sig of AI_TOOL_SIGNATURES) {
      assert.ok(sig.name, `${sig.name} should have name`);
      assert.ok(sig.patterns.length > 0, `${sig.name} should have patterns`);
      assert.ok(sig.locations.length > 0, `${sig.name} should have locations`);
      assert.ok(Array.isArray(sig.safeDirectories), `${sig.name} should have safeDirectories`);
    }
  });

  test('detectKnownAITools returns array', () => {
    const result = detectKnownAITools();
    assert.ok(Array.isArray(result), 'Should return an array');
  });

  test('searchDirectoriesSync returns array for valid query', () => {
    const result = searchDirectoriesSync('test');
    assert.ok(Array.isArray(result), 'Should return an array');
  });

  test('searchDirectoriesSync returns empty for unlikely query', () => {
    const result = searchDirectoriesSync('xxxxxxxxxxxunlikelyxxxxxxxxxx');
    assert.ok(Array.isArray(result), 'Should return an array');
    assert.strictEqual(result.length, 0, 'Should be empty for unlikely query');
  });
});

suite('Safety Levels Tests', () => {
  test('SAFETY_DEFINITIONS has all three levels', () => {
    assert.ok(SAFETY_DEFINITIONS.safe, 'Should have safe level');
    assert.ok(SAFETY_DEFINITIONS.caution, 'Should have caution level');
    assert.ok(SAFETY_DEFINITIONS.danger, 'Should have danger level');
  });

  test('Each safety level has required fields', () => {
    for (const level of ['safe', 'caution', 'danger'] as const) {
      const def = SAFETY_DEFINITIONS[level];
      assert.ok(def.level, `${level} should have level`);
      assert.ok(def.label, `${level} should have label`);
      assert.ok(def.definition, `${level} should have definition`);
      assert.ok(def.criteria.length > 0, `${level} should have criteria`);
      assert.ok(def.examples.length > 0, `${level} should have examples`);
      assert.ok(def.consequence, `${level} should have consequence`);
    }
  });

  test('getSafetyTooltip returns string for each level', () => {
    assert.ok(typeof getSafetyTooltip('safe') === 'string');
    assert.ok(typeof getSafetyTooltip('caution') === 'string');
    assert.ok(typeof getSafetyTooltip('danger') === 'string');
  });

  test('getLevelChangeWarning warns for risky changes', () => {
    // Danger to Safe should warn
    const warning = getLevelChangeWarning('danger', 'safe', 'testDir');
    assert.ok(warning, 'Should warn when changing from danger to safe');
    assert.ok(warning.title, 'Warning should have title');
    assert.ok(warning.message, 'Warning should have message');
  });

  test('getLevelChangeWarning allows safe level increases', () => {
    // Safe to Danger - actually making it safer, but still returns info
    const warning = getLevelChangeWarning('safe', 'danger', 'testDir');
    assert.ok(warning, 'Should return info for level change');
  });

  test('getLevelChangeWarning returns null for same level', () => {
    const warning = getLevelChangeWarning('safe', 'safe', 'testDir');
    assert.strictEqual(warning, null, 'Should return null for same level');
  });
});
