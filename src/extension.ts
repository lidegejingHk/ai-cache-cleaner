import * as vscode from 'vscode';
import { scanAllCaches, ScanResult, updateScanOptions } from './cacheScanner';
import { deleteMultiple, formatSize } from './cacheDeleter';
import { detectKnownAITools, searchDirectoriesSync, SearchResult } from './aiToolSignatures';
import { SAFETY_DEFINITIONS, SafetyLevel, getSafetyTooltip, getLevelChangeWarning } from './safetyLevels';

let panel: vscode.WebviewPanel | undefined;
let isSearching = false;
let extensionContext: vscode.ExtensionContext;

// Storage key for user safety level overrides
const SAFETY_OVERRIDES_KEY = 'safetyLevelOverrides';

// Get configuration and update scanner options
function syncConfigToScanner() {
    const config = vscode.workspace.getConfiguration('aiCacheCleaner');
    updateScanOptions({
        defaultSafetyLevel: config.get<'safe' | 'caution' | 'danger'>('defaultSafetyLevel', 'caution'),
        excludePatterns: config.get<string[]>('excludePatterns', [])
    });
}

// Check if notifications are enabled
function shouldShowNotifications(): boolean {
    const config = vscode.workspace.getConfiguration('aiCacheCleaner');
    return config.get<boolean>('showNotifications', true);
}

export function activate(context: vscode.ExtensionContext) {
    console.log('AI Cache Cleaner is now active!');
    extensionContext = context;

    // Initialize scanner with user config
    syncConfigToScanner();

    // Listen for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aiCacheCleaner')) {
                syncConfigToScanner();
            }
        })
    );

    const command = vscode.commands.registerCommand('ai-cache-cleaner.open', () => {
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
        } else {
            panel = vscode.window.createWebviewPanel(
                'aiCacheCleaner',
                'AI Cache Cleaner',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(context.extensionUri, 'media'),
                        vscode.Uri.joinPath(context.extensionUri, 'webview')
                    ]
                }
            );

            panel.webview.html = getWebviewContent(context, panel.webview);

            // Send initial data
            sendScanData(panel.webview);
            sendDetectedTools(panel.webview);
            sendSafetyDefinitions(panel.webview);
            sendSafetyOverrides(panel.webview);

            // Handle messages from webview
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'refresh':
                            sendScanData(panel!.webview);
                            sendDetectedTools(panel!.webview);
                            sendSafetyOverrides(panel!.webview);
                            return;
                        case 'delete':
                            await handleDelete(message.paths, message.safetyLevels || {}, panel!.webview);
                            return;
                        case 'search':
                            await handleSearch(message.query, panel!.webview);
                            return;
                        case 'cancelSearch':
                            isSearching = false;
                            return;
                        case 'changeSafetyLevel':
                            await handleSafetyLevelChange(
                                message.path,
                                message.dirName,
                                message.currentLevel,
                                message.newLevel,
                                panel!.webview
                            );
                            return;
                        case 'resetSafetyLevel':
                            await handleResetSafetyLevel(message.path, panel!.webview);
                            return;
                        case 'resetAllSafetyLevels':
                            await handleResetAllSafetyLevels(panel!.webview);
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );

            panel.onDidDispose(
                () => {
                    panel = undefined;
                    isSearching = false;
                },
                null,
                context.subscriptions
            );
        }
    });

    context.subscriptions.push(command);

    // Register the sidebar webview provider
    const sidebarProvider = new AICacheCleanerViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('aiCacheCleanerView', sidebarProvider)
    );
}

// Sidebar WebviewViewProvider
class AICacheCleanerViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };

        webviewView.webview.html = this._getWelcomeHtml();

        webviewView.webview.onDidReceiveMessage(message => {
            if (message.command === 'openDashboard') {
                vscode.commands.executeCommand('ai-cache-cleaner.open');
            }
        });
    }

    private _getWelcomeHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 16px;
            background: transparent;
            color: var(--vscode-foreground);
        }
        .container {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }
        h3 {
            margin: 0 0 8px 0;
            font-size: 14px;
        }
        p {
            margin: 0 0 16px 0;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            width: 100%;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .icon {
            font-size: 32px;
            margin-bottom: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🧹</div>
        <h3>AI Cache Cleaner</h3>
        <p>Visualize and clean cache from AI coding tools</p>
        <button onclick="openDashboard()">Open Dashboard</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        function openDashboard() {
            vscode.postMessage({ command: 'openDashboard' });
        }
    </script>
</body>
</html>`;
    }
}

function getSafetyOverrides(): Record<string, SafetyLevel> {
    return extensionContext.globalState.get<Record<string, SafetyLevel>>(SAFETY_OVERRIDES_KEY, {});
}

async function setSafetyOverride(path: string, level: SafetyLevel): Promise<void> {
    const overrides = getSafetyOverrides();
    overrides[path] = level;
    await extensionContext.globalState.update(SAFETY_OVERRIDES_KEY, overrides);
}

async function removeSafetyOverride(path: string): Promise<void> {
    const overrides = getSafetyOverrides();
    delete overrides[path];
    await extensionContext.globalState.update(SAFETY_OVERRIDES_KEY, overrides);
}

async function clearAllSafetyOverrides(): Promise<void> {
    await extensionContext.globalState.update(SAFETY_OVERRIDES_KEY, {});
}

function sendSafetyDefinitions(webview: vscode.Webview) {
    webview.postMessage({
        command: 'safetyDefinitions',
        data: SAFETY_DEFINITIONS
    });
}

function sendSafetyOverrides(webview: vscode.Webview) {
    webview.postMessage({
        command: 'safetyOverrides',
        data: getSafetyOverrides()
    });
}

function sendScanData(webview: vscode.Webview) {
    const scanResult = scanAllCaches();
    webview.postMessage({
        command: 'scanResult',
        data: scanResult
    });
}

function sendDetectedTools(webview: vscode.Webview) {
    const detectedTools = detectKnownAITools();
    webview.postMessage({
        command: 'detectedTools',
        data: detectedTools
    });
}

async function handleSafetyLevelChange(
    path: string,
    dirName: string,
    currentLevel: SafetyLevel,
    newLevel: SafetyLevel,
    webview: vscode.Webview
) {
    // Get warning message if needed
    const warning = getLevelChangeWarning(currentLevel, newLevel, dirName);

    if (warning) {
        // Determine if this is making it more deletable
        const riskOrder: SafetyLevel[] = ['danger', 'caution', 'safe'];
        const isMoreDeletable = riskOrder.indexOf(newLevel) > riskOrder.indexOf(currentLevel);

        if (isMoreDeletable) {
            // Show warning dialog for risky changes
            const confirm = await vscode.window.showWarningMessage(
                warning.message,
                { modal: true, detail: warning.title },
                'Yes, Change Level',
                'Cancel'
            );

            if (confirm !== 'Yes, Change Level') {
                webview.postMessage({ command: 'safetyLevelChangeCancelled' });
                return;
            }
        }
    }

    // Save the override
    await setSafetyOverride(path, newLevel);

    // Notify webview
    webview.postMessage({
        command: 'safetyLevelChanged',
        data: { path, newLevel }
    });

    // Send updated overrides
    sendSafetyOverrides(webview);

    vscode.window.showInformationMessage(
        `Safety level for "${dirName}" changed to ${SAFETY_DEFINITIONS[newLevel].label}`
    );
}

async function handleResetSafetyLevel(path: string, webview: vscode.Webview) {
    await removeSafetyOverride(path);
    sendSafetyOverrides(webview);
    vscode.window.showInformationMessage('Safety level reset to default');
}

async function handleResetAllSafetyLevels(webview: vscode.Webview) {
    const confirm = await vscode.window.showWarningMessage(
        'Reset all custom safety levels to default?',
        { modal: true },
        'Reset All'
    );

    if (confirm === 'Reset All') {
        await clearAllSafetyOverrides();
        sendSafetyOverrides(webview);
        vscode.window.showInformationMessage('All safety levels reset to default');
    }
}

async function handleSearch(query: string, webview: vscode.Webview) {
    if (isSearching) {
        webview.postMessage({
            command: 'searchError',
            error: 'Search already in progress'
        });
        return;
    }

    if (!query || query.trim().length < 2) {
        webview.postMessage({
            command: 'searchError',
            error: 'Please enter at least 2 characters'
        });
        return;
    }

    isSearching = true;

    try {
        webview.postMessage({
            command: 'searchProgress',
            data: { percentage: 0, currentPath: 'Starting search...' }
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        if (!isSearching) return;

        webview.postMessage({
            command: 'searchProgress',
            data: { percentage: 30, currentPath: 'Scanning home directory...' }
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        if (!isSearching) return;

        webview.postMessage({
            command: 'searchProgress',
            data: { percentage: 60, currentPath: 'Scanning Application Support...' }
        });

        const results = searchDirectoriesSync(query);

        await new Promise(resolve => setTimeout(resolve, 300));

        webview.postMessage({
            command: 'searchProgress',
            data: { percentage: 100, currentPath: 'Complete!' }
        });

        webview.postMessage({
            command: 'searchComplete',
            data: {
                query,
                results,
                totalSize: results.reduce((sum, r) => sum + r.size, 0),
                totalSizeFormatted: formatSize(results.reduce((sum, r) => sum + r.size, 0))
            }
        });

    } catch (error) {
        webview.postMessage({
            command: 'searchError',
            error: error instanceof Error ? error.message : 'Search failed'
        });
    } finally {
        isSearching = false;
    }
}

async function handleDelete(paths: string[], safetyLevels: Record<string, SafetyLevel>, webview: vscode.Webview) {
    const totalPaths = paths.length;

    // Count items by safety level
    const overrides = getSafetyOverrides();
    let safeCount = 0;
    let cautionCount = 0;
    let dangerCount = 0;

    for (const path of paths) {
        const level = overrides[path] || safetyLevels[path] || 'safe';
        if (level === 'safe') safeCount++;
        else if (level === 'caution') cautionCount++;
        else if (level === 'danger') dangerCount++;
    }

    // Build confirmation message based on safety levels
    let confirmMessage = `Are you sure you want to delete ${totalPaths} item(s)?`;
    let warningDetails = '';

    if (dangerCount > 0) {
        warningDetails = `⚠️ WARNING: You selected ${dangerCount} DANGER-level item(s)!\n\nThese items are critical for AI tool functionality and may cause issues if deleted.\n\n`;
    } else if (cautionCount > 0) {
        warningDetails = `⚠️ CAUTION: You selected ${cautionCount} CAUTION-level item(s).\n\nThese items may contain user preferences or history that cannot be easily recovered.\n\n`;
    }

    if (warningDetails) {
        confirmMessage = warningDetails + `Summary:\n🟢 Safe: ${safeCount}\n🟡 Caution: ${cautionCount}\n🔴 Danger: ${dangerCount}\n\nContinue with deletion?`;
    }

    const buttons = dangerCount > 0
        ? ['Delete Anyway', 'Cancel']
        : (cautionCount > 0 ? ['Delete', 'Cancel'] : ['Delete']);

    const confirm = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        ...buttons
    );

    if (confirm !== 'Delete' && confirm !== 'Delete Anyway') {
        webview.postMessage({ command: 'deleteCancelled' });
        return;
    }

    const result = await deleteMultiple(paths);

    webview.postMessage({
        command: 'deleteResult',
        data: {
            ...result,
            totalFreedFormatted: formatSize(result.totalFreed)
        }
    });

    if (result.failCount === 0) {
        vscode.window.showInformationMessage(
            `Successfully deleted ${result.successCount} item(s), freed ${formatSize(result.totalFreed)}`
        );
    } else {
        vscode.window.showWarningMessage(
            `Deleted ${result.successCount} item(s), ${result.failCount} failed`
        );
    }


    sendScanData(webview);
}

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline'; font-src https://fonts.gstatic.com;">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <title>AI Cache Cleaner</title>
    <link href="${cssUri}" rel="stylesheet">
</head>
<body>
    <div class="container">
        <!-- Toast Notification -->
        <div id="toast" class="toast hidden">
            <div class="toast-content">
                <span class="toast-icon">🔔</span>
                <span id="toastMessage" class="toast-message"></span>
            </div>
            <div class="toast-actions">
                <button id="toastViewBtn" class="btn btn-primary btn-sm">View Results</button>
                <button id="toastDismissBtn" class="btn btn-secondary btn-sm">Dismiss</button>
            </div>
        </div>

        <!-- Search Results Modal -->
        <div id="searchResultsModal" class="modal hidden">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🔍 Search Results for "<span id="searchQueryDisplay"></span>"</h3>
                    <button id="closeModalBtn" class="btn-close">✕</button>
                </div>
                <div class="modal-body">
                    <div id="searchResultsList" class="search-results-list"></div>
                </div>
                <div class="modal-footer">
                    <span id="modalSelectedInfo">0 selected (0 B)</span>
                    <button id="addToListBtn" class="btn btn-primary" disabled>Add Selected to List</button>
                </div>
            </div>
        </div>

        <!-- Safety Level Change Modal -->
        <div id="safetyModal" class="modal hidden">
            <div class="modal-content modal-sm">
                <div class="modal-header">
                    <h3>🛡️ Change Safety Level</h3>
                    <button id="closeSafetyModalBtn" class="btn-close">✕</button>
                </div>
                <div class="modal-body">
                    <p id="safetyModalDirName" class="safety-modal-dir"></p>
                    <div class="safety-options">
                        <label class="safety-option">
                            <input type="radio" name="safetyLevel" value="safe">
                            <span class="safety-option-content safe">
                                <span class="safety-option-label">✓ Safe</span>
                                <span class="safety-option-desc">Can be deleted without impact</span>
                            </span>
                        </label>
                        <label class="safety-option">
                            <input type="radio" name="safetyLevel" value="caution">
                            <span class="safety-option-content caution">
                                <span class="safety-option-label">⚠ Caution</span>
                                <span class="safety-option-desc">May contain valuable data</span>
                            </span>
                        </label>
                        <label class="safety-option">
                            <input type="radio" name="safetyLevel" value="danger">
                            <span class="safety-option-content danger">
                                <span class="safety-option-label">✕ Danger</span>
                                <span class="safety-option-desc">Critical for functionality</span>
                            </span>
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="resetSafetyBtn" class="btn btn-secondary btn-sm">Reset to Default</button>
                    <button id="saveSafetyBtn" class="btn btn-primary">Save</button>
                </div>
            </div>
        </div>

        <header class="header">
            <div class="header-left">
                <h1>🧹 AI Cache Cleaner</h1>
            </div>
            <div class="header-right">
                <button id="resetAllBtn" class="btn btn-secondary btn-sm" title="Reset all safety levels">
                    Reset All Levels
                </button>
                <button id="refreshBtn" class="btn btn-secondary" title="Refresh">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M23 4v6h-6M1 20v-6h6"/>
                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                    </svg>
                    Refresh
                </button>
                <div class="total-size">
                    <span class="total-label">Total:</span>
                    <span id="totalSize" class="total-value">--</span>
                </div>
            </div>
        </header>

        <div class="content">
            <!-- Search Section -->
            <div class="search-section">
                <div class="search-box">
                    <input type="text" id="searchInput" placeholder="Search AI tools (e.g., cursor, copilot...)" />
                    <button id="searchBtn" class="btn btn-primary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/>
                            <path d="M21 21l-4.35-4.35"/>
                        </svg>
                        Search
                    </button>
                    <button id="cancelSearchBtn" class="btn btn-secondary hidden">Cancel</button>
                </div>
                <div id="searchProgress" class="search-progress hidden">
                    <div class="progress-bar">
                        <div id="progressFill" class="progress-fill"></div>
                    </div>
                    <span id="progressText" class="progress-text">Searching...</span>
                </div>
            </div>

            <!-- Detected Tools -->
            <div id="detectedToolsSection" class="detected-tools-section hidden">
                <h3>🤖 Detected AI Tools</h3>
                <div id="detectedToolsList" class="detected-tools-list"></div>
            </div>

            <!-- Summary Cards -->
            <div id="summaryCards" class="summary-cards"></div>

            <!-- Safety Legend -->
            <div class="safety-legend-section">
                <h3>🛡️ Safety Levels</h3>
                <div class="safety-legend-grid">
                    <div class="safety-legend-item" data-level="safe">
                        <span class="dot safe"></span>
                        <div class="legend-info">
                            <strong>Safe</strong>
                            <p>Temporary data that can be safely deleted without functional impact.</p>
                        </div>
                    </div>
                    <div class="safety-legend-item" data-level="caution">
                        <span class="dot caution"></span>
                        <div class="legend-info">
                            <strong>Caution</strong>
                            <p>Data with potential user value that may be difficult to recover.</p>
                        </div>
                    </div>
                    <div class="safety-legend-item" data-level="danger">
                        <span class="dot danger"></span>
                        <div class="legend-info">
                            <strong>Danger</strong>
                            <p>Critical data essential for application functionality.</p>
                        </div>
                    </div>
                </div>
                <p class="safety-note">💡 Click on any safety badge to customize the level for that directory.</p>
            </div>

            <!-- Directory Tree -->
            <div class="tree-container">
                <div class="tree-header">
                    <h2>Cache Directories</h2>
                    <div class="tree-legend">
                        <span class="legend-item"><span class="dot safe"></span> Safe</span>
                        <span class="legend-item"><span class="dot caution"></span> Caution</span>
                        <span class="legend-item"><span class="dot danger"></span> Danger</span>
                    </div>
                </div>
                <div id="directoryTree" class="directory-tree">
                    <div class="loading">Scanning...</div>
                </div>
            </div>

            <!-- Action Bar -->
            <div class="action-bar">
                <div class="selected-info">
                    <span id="selectedCount">0</span> items selected
                    (<span id="selectedSize">0 B</span>)
                </div>
                <button id="deleteBtn" class="btn btn-danger" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                    Delete Selected
                </button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let scanData = null;
        let selectedPaths = new Set();
        let searchResults = null;
        let modalSelectedPaths = new Set();
        let detectedTools = [];
        let customDirectories = [];
        let safetyDefinitions = {};
        let safetyOverrides = {};
        let currentSafetyEditPath = null;
        let currentSafetyEditDirName = null;
        let currentSafetyOriginalLevel = null;

        // DOM Elements
        const totalSizeEl = document.getElementById('totalSize');
        const summaryCardsEl = document.getElementById('summaryCards');
        const directoryTreeEl = document.getElementById('directoryTree');
        const selectedCountEl = document.getElementById('selectedCount');
        const selectedSizeEl = document.getElementById('selectedSize');
        const deleteBtnEl = document.getElementById('deleteBtn');
        const refreshBtnEl = document.getElementById('refreshBtn');
        const resetAllBtnEl = document.getElementById('resetAllBtn');
        const searchInputEl = document.getElementById('searchInput');
        const searchBtnEl = document.getElementById('searchBtn');
        const cancelSearchBtnEl = document.getElementById('cancelSearchBtn');
        const searchProgressEl = document.getElementById('searchProgress');
        const progressFillEl = document.getElementById('progressFill');
        const progressTextEl = document.getElementById('progressText');
        const toastEl = document.getElementById('toast');
        const toastMessageEl = document.getElementById('toastMessage');
        const toastViewBtnEl = document.getElementById('toastViewBtn');
        const toastDismissBtnEl = document.getElementById('toastDismissBtn');
        const searchResultsModalEl = document.getElementById('searchResultsModal');
        const searchQueryDisplayEl = document.getElementById('searchQueryDisplay');
        const searchResultsListEl = document.getElementById('searchResultsList');
        const closeModalBtnEl = document.getElementById('closeModalBtn');
        const addToListBtnEl = document.getElementById('addToListBtn');
        const modalSelectedInfoEl = document.getElementById('modalSelectedInfo');
        const detectedToolsSectionEl = document.getElementById('detectedToolsSection');
        const detectedToolsListEl = document.getElementById('detectedToolsList');
        const safetyModalEl = document.getElementById('safetyModal');
        const safetyModalDirNameEl = document.getElementById('safetyModalDirName');
        const closeSafetyModalBtnEl = document.getElementById('closeSafetyModalBtn');
        const resetSafetyBtnEl = document.getElementById('resetSafetyBtn');
        const saveSafetyBtnEl = document.getElementById('saveSafetyBtn');

        // Event Listeners
        refreshBtnEl.addEventListener('click', () => {
            directoryTreeEl.innerHTML = '<div class="loading">Scanning...</div>';
            vscode.postMessage({ command: 'refresh' });
        });

        resetAllBtnEl.addEventListener('click', () => {
            vscode.postMessage({ command: 'resetAllSafetyLevels' });
        });

        deleteBtnEl.addEventListener('click', () => {
            if (selectedPaths.size > 0) {
                // Collect safety levels for selected paths
                const safetyLevels = {};
                const collectLevels = (dirs) => {
                    if (!dirs) return;
                    for (const dir of dirs) {
                        if (selectedPaths.has(dir.path)) {
                            // Check if there's a user override first
                            safetyLevels[dir.path] = userSafetyOverrides[dir.path] || dir.safetyLevel || 'safe';
                        }
                        if (dir.children) collectLevels(dir.children);
                    }
                };
                if (scanData && scanData.directories) {
                    collectLevels(scanData.directories);
                }
                // Also check custom directories
                for (const path of selectedPaths) {
                    if (!safetyLevels[path]) {
                        safetyLevels[path] = userSafetyOverrides[path] || 'safe';
                    }
                }
                
                vscode.postMessage({ 
                    command: 'delete', 
                    paths: Array.from(selectedPaths),
                    safetyLevels: safetyLevels
                });
            }
        });

        searchBtnEl.addEventListener('click', startSearch);
        searchInputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') startSearch();
        });

        cancelSearchBtnEl.addEventListener('click', () => {
            vscode.postMessage({ command: 'cancelSearch' });
            hideSearchProgress();
        });

        toastViewBtnEl.addEventListener('click', showSearchResultsModal);
        toastDismissBtnEl.addEventListener('click', hideToast);
        closeModalBtnEl.addEventListener('click', hideModal);
        addToListBtnEl.addEventListener('click', addSelectedToList);
        
        closeSafetyModalBtnEl.addEventListener('click', hideSafetyModal);
        resetSafetyBtnEl.addEventListener('click', () => {
            if (currentSafetyEditPath) {
                vscode.postMessage({ 
                    command: 'resetSafetyLevel', 
                    path: currentSafetyEditPath 
                });
                hideSafetyModal();
            }
        });
        saveSafetyBtnEl.addEventListener('click', () => {
            const selected = document.querySelector('input[name="safetyLevel"]:checked');
            if (selected && currentSafetyEditPath) {
                vscode.postMessage({
                    command: 'changeSafetyLevel',
                    path: currentSafetyEditPath,
                    dirName: currentSafetyEditDirName,
                    currentLevel: currentSafetyOriginalLevel,
                    newLevel: selected.value
                });
                hideSafetyModal();
            }
        });

        function startSearch() {
            const query = searchInputEl.value.trim();
            if (query.length < 2) {
                alert('Please enter at least 2 characters');
                return;
            }
            showSearchProgress();
            vscode.postMessage({ command: 'search', query });
        }

        function showSearchProgress() {
            searchProgressEl.classList.remove('hidden');
            searchBtnEl.classList.add('hidden');
            cancelSearchBtnEl.classList.remove('hidden');
            progressFillEl.style.width = '0%';
        }

        function hideSearchProgress() {
            searchProgressEl.classList.add('hidden');
            searchBtnEl.classList.remove('hidden');
            cancelSearchBtnEl.classList.add('hidden');
        }

        function showToast(message) {
            toastMessageEl.textContent = message;
            toastEl.classList.remove('hidden');
            setTimeout(() => {
                if (!toastEl.classList.contains('hidden')) {
                    hideToast();
                }
            }, 10000);
        }

        function hideToast() {
            toastEl.classList.add('hidden');
        }

        function showSearchResultsModal() {
            hideToast();
            if (!searchResults || !searchResults.results) return;
            
            searchQueryDisplayEl.textContent = searchResults.query;
            renderSearchResults();
            searchResultsModalEl.classList.remove('hidden');
        }

        function hideModal() {
            searchResultsModalEl.classList.add('hidden');
            modalSelectedPaths.clear();
        }

        function showSafetyModal(path, dirName, currentLevel) {
            currentSafetyEditPath = path;
            currentSafetyEditDirName = dirName;
            currentSafetyOriginalLevel = currentLevel;
            safetyModalDirNameEl.textContent = dirName;
            
            // Set current level
            const radios = document.querySelectorAll('input[name="safetyLevel"]');
            radios.forEach(r => {
                r.checked = r.value === currentLevel;
            });
            
            // Show if this is custom
            const isCustom = safetyOverrides[path] !== undefined;
            resetSafetyBtnEl.style.display = isCustom ? 'inline-flex' : 'none';
            
            safetyModalEl.classList.remove('hidden');
        }

        function hideSafetyModal() {
            safetyModalEl.classList.add('hidden');
            currentSafetyEditPath = null;
            currentSafetyEditDirName = null;
            currentSafetyOriginalLevel = null;
        }

        function renderSearchResults() {
            searchResultsListEl.innerHTML = '';
            
            if (searchResults.results.length === 0) {
                searchResultsListEl.innerHTML = '<div class="no-results">No directories found matching your search.</div>';
                return;
            }
            
            searchResults.results.forEach(result => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.innerHTML = \`
                    <input type="checkbox" class="result-checkbox" data-path="\${result.path}" data-size="\${result.size}">
                    <div class="result-info">
                        <span class="result-name">\${result.matchedPattern}</span>
                        <span class="result-path">\${result.path}</span>
                        <span class="result-tool">\${result.toolName}</span>
                    </div>
                    <span class="result-size">\${result.sizeFormatted}</span>
                \`;
                
                const checkbox = item.querySelector('.result-checkbox');
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        modalSelectedPaths.add(result.path);
                    } else {
                        modalSelectedPaths.delete(result.path);
                    }
                    updateModalSelection();
                });
                
                searchResultsListEl.appendChild(item);
            });
        }

        function updateModalSelection() {
            let totalSize = 0;
            document.querySelectorAll('.result-checkbox:checked').forEach(cb => {
                totalSize += parseInt(cb.dataset.size) || 0;
            });
            
            modalSelectedInfoEl.textContent = \`\${modalSelectedPaths.size} selected (\${formatBytes(totalSize)})\`;
            addToListBtnEl.disabled = modalSelectedPaths.size === 0;
        }

        function addSelectedToList() {
            modalSelectedPaths.forEach(path => {
                const result = searchResults.results.find(r => r.path === path);
                if (result && !customDirectories.find(d => d.path === path)) {
                    customDirectories.push({
                        path: result.path,
                        name: result.matchedPattern,
                        size: result.size,
                        sizeFormatted: result.sizeFormatted,
                        safetyLevel: 'caution',
                        description: \`\${result.toolName} - Added from search\`,
                        toolName: result.toolName
                    });
                }
            });
            
            hideModal();
            renderDirectoryTree();
            showToast(\`Added \${modalSelectedPaths.size} directories to the list\`);
            modalSelectedPaths.clear();
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'scanResult':
                    scanData = message.data;
                    renderUI();
                    break;
                case 'detectedTools':
                    detectedTools = message.data;
                    renderDetectedTools();
                    break;
                case 'safetyDefinitions':
                    safetyDefinitions = message.data;
                    break;
                case 'safetyOverrides':
                    safetyOverrides = message.data;
                    renderDirectoryTree(); // Re-render with updated levels
                    break;
                case 'safetyLevelChanged':
                case 'safetyLevelChangeCancelled':
                    break;
                case 'deleteResult':
                    selectedPaths.clear();
                    customDirectories = customDirectories.filter(d => !message.data.results.find(r => r.path === d.path && r.success));
                    updateSelection();
                    break;
                case 'deleteCancelled':
                    break;
                case 'searchProgress':
                    progressFillEl.style.width = message.data.percentage + '%';
                    progressTextEl.textContent = message.data.currentPath;
                    break;
                case 'searchComplete':
                    hideSearchProgress();
                    searchResults = message.data;
                    if (message.data.results.length > 0) {
                        showToast(\`Found \${message.data.results.length} directories matching "\${message.data.query}" (\${message.data.totalSizeFormatted} total)\`);
                    } else {
                        showToast(\`No directories found matching "\${message.data.query}"\`);
                    }
                    break;
                case 'searchError':
                    hideSearchProgress();
                    alert(message.error);
                    break;
            }
        });

        function getEffectiveSafetyLevel(dir) {
            // Check for user override first
            if (safetyOverrides[dir.path]) {
                return safetyOverrides[dir.path];
            }
            return dir.safetyLevel || 'caution';
        }

        function renderUI() {
            if (!scanData) return;
            totalSizeEl.textContent = scanData.totalSizeFormatted;
            renderSummaryCards();
            renderDirectoryTree();
        }

        function renderDetectedTools() {
            if (detectedTools.length === 0) {
                detectedToolsSectionEl.classList.add('hidden');
                return;
            }
            
            detectedToolsSectionEl.classList.remove('hidden');
            detectedToolsListEl.innerHTML = '';
            
            detectedTools.forEach(tool => {
                const badge = document.createElement('span');
                badge.className = 'tool-badge';
                badge.innerHTML = \`\${tool.toolName} <small>(\${tool.sizeFormatted})</small>\`;
                detectedToolsListEl.appendChild(badge);
            });
        }

        function renderSummaryCards() {
            summaryCardsEl.innerHTML = '';
            
            const allDirs = [...(scanData?.directories || []), ...customDirectories];
            
            const toolMap = new Map();
            allDirs.forEach(dir => {
                const toolName = dir.toolName || dir.name;
                if (!toolMap.has(toolName)) {
                    toolMap.set(toolName, { name: toolName, size: 0, description: dir.description });
                }
                toolMap.get(toolName).size += dir.size;
            });
            
            toolMap.forEach((tool, name) => {
                const card = document.createElement('div');
                card.className = 'summary-card';
                card.innerHTML = \`
                    <div class="card-name">\${name}</div>
                    <div class="card-size">\${formatBytes(tool.size)}</div>
                    <div class="card-desc">\${tool.description || ''}</div>
                \`;
                summaryCardsEl.appendChild(card);
            });
        }

        function renderDirectoryTree() {
            directoryTreeEl.innerHTML = '';
            
            if (scanData && scanData.directories) {
                scanData.directories.forEach(dir => {
                    const node = createTreeNode(dir, 0);
                    directoryTreeEl.appendChild(node);
                });
            }
            
            if (customDirectories.length > 0) {
                const customHeader = document.createElement('div');
                customHeader.className = 'custom-dirs-header';
                customHeader.innerHTML = '<h4>📌 Added from Search</h4>';
                directoryTreeEl.appendChild(customHeader);
                
                customDirectories.forEach(dir => {
                    const node = createTreeNode(dir, 0);
                    directoryTreeEl.appendChild(node);
                });
            }
            
            const totalSize = (scanData?.totalSize || 0) + customDirectories.reduce((sum, d) => sum + d.size, 0);
            totalSizeEl.textContent = formatBytes(totalSize);
        }

        function createTreeNode(dir, level) {
            const node = document.createElement('div');
            node.className = 'tree-node';
            node.style.paddingLeft = (level * 20) + 'px';

            const hasChildren = dir.children && dir.children.length > 0;
            const isExpanded = dir.isExpanded !== false;
            const effectiveLevel = getEffectiveSafetyLevel(dir);
            const isCustomLevel = safetyOverrides[dir.path] !== undefined;
            const tooltip = getSafetyTooltip(effectiveLevel);

            node.innerHTML = \`
                <div class="tree-item" data-path="\${dir.path}">
                    <span class="tree-toggle \${hasChildren ? '' : 'hidden'}">\${isExpanded ? '▼' : '▶'}</span>
                    <input type="checkbox" class="tree-checkbox" data-path="\${dir.path}" data-size="\${dir.size}" 
                           \${effectiveLevel === 'danger' ? 'disabled' : ''}>
                    <span class="tree-icon">📂</span>
                    <span class="tree-name">\${dir.name}</span>
                    <span class="tree-size">\${dir.sizeFormatted}</span>
                    <span class="safety-badge \${effectiveLevel} \${isCustomLevel ? 'custom' : ''}" 
                          data-path="\${dir.path}" 
                          data-name="\${dir.name}"
                          data-level="\${effectiveLevel}"
                          title="\${tooltip}">
                        \${getSafetyLabel(effectiveLevel)}\${isCustomLevel ? ' ⚙' : ''}
                    </span>
                </div>
            \`;

            const toggle = node.querySelector('.tree-toggle');
            const checkbox = node.querySelector('.tree-checkbox');
            const safetyBadge = node.querySelector('.safety-badge');

            // Create children container
            if (hasChildren) {
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'tree-children';
                childrenContainer.style.display = isExpanded ? 'block' : 'none';
                
                dir.children.forEach(child => {
                    const childNode = createTreeNode(child, level + 1);
                    childrenContainer.appendChild(childNode);
                });
                
                node.appendChild(childrenContainer);

                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = childrenContainer.style.display !== 'none';
                    childrenContainer.style.display = isOpen ? 'none' : 'block';
                    toggle.textContent = isOpen ? '▶' : '▼';
                });
            }

            // Checkbox handler
            checkbox.addEventListener('change', (e) => {
                const path = e.target.dataset.path;
                
                if (e.target.checked) {
                    selectedPaths.add(path);
                } else {
                    selectedPaths.delete(path);
                }
                
                updateSelection();
            });

            // Safety badge click handler
            safetyBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                const path = e.target.dataset.path;
                const name = e.target.dataset.name;
                const level = e.target.dataset.level;
                showSafetyModal(path, name, level);
            });

            return node;
        }

        function getSafetyLabel(level) {
            switch(level) {
                case 'safe': return '✓ Safe';
                case 'caution': return '⚠ Caution';
                case 'danger': return '✕ Danger';
                default: return '';
            }
        }

        function getSafetyTooltip(level) {
            const defs = {
                safe: "SAFE: Temporary data that can be safely deleted.\\n\\nCriteria:\\n• Auto-generated by the system\\n• Can be regenerated on next use\\n• No user-created content\\n• Deletion does not affect core functionality\\n\\nExamples: cache/, debug/, logs/, telemetry/",
                caution: "CAUTION: Data with potential user value.\\n\\nCriteria:\\n• May contain user preferences or history\\n• Could include work-in-progress items\\n• Not critical for functionality\\n• Recovery may require manual effort\\n\\nExamples: history/, conversations/, projects/",
                danger: "DANGER: Critical data for functionality.\\n\\nCriteria:\\n• Required for the application to function\\n• Contains installed extensions or plugins\\n• Stores authentication or configuration\\n• Cannot be automatically regenerated\\n\\nExamples: plugins/, extensions/, config/"
            };
            return defs[level] || '';
        }

        function updateSelection() {
            let totalSize = 0;
            
            document.querySelectorAll('.tree-checkbox:checked').forEach(cb => {
                totalSize += parseInt(cb.dataset.size) || 0;
            });

            selectedCountEl.textContent = selectedPaths.size;
            selectedSizeEl.textContent = formatBytes(totalSize);
            deleteBtnEl.disabled = selectedPaths.size === 0;
        }

        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }
    </script>
</body>
</html>`;
}

export function deactivate() { }
