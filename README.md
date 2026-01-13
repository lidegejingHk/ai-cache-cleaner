# AI Cache Cleaner

<p align="center">
  <img src="images/icon.png" alt="AI Cache Cleaner" width="128">
</p>

<p align="center">
  <strong>A VSCode extension to visualize and clean cache from AI coding tools</strong>
</p>

<p align="center">
  <a href="https://github.com/lidegejingHk/ai-cache-cleaner/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Platform">
</p>

---

## 🎯 Features

- **🔍 Auto-detect AI Tools** - Automatically finds Claude, Gemini, Cursor, Copilot, and more
- **🔎 Dynamic Search** - Search for any AI tool by name with progress indicator
- **🛡️ Safety Levels** - Scientific classification (Safe/Caution/Danger) with hover tooltips
- **⚙️ Customizable** - Click to change safety levels, persisted across sessions
- **🌙 Dark Mode** - Beautiful OLED-friendly dark theme
- **📊 Size Visualization** - See storage usage at a glance

## 📸 Screenshots

![AI Cache Cleaner Dashboard](images/screenshot-dashboard.png)

## 🚀 Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/lidegejingHk/ai-cache-cleaner.git
cd ai-cache-cleaner

# Install dependencies
npm install

# Compile
npm run compile

# Launch in VSCode (press F5)
```

### From VSIX (Coming Soon)

```bash
code --install-extension ai-cache-cleaner-0.0.1.vsix
```

## 📖 Usage

1. Open VSCode
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type **"AI Cache Cleaner: Open Dashboard"**
4. Select directories to clean and click **Delete Selected**

### Safety Levels

| Level | Meaning | Action |
|-------|---------|--------|
| 🟢 **Safe** | Temporary data, auto-regenerates | Can delete freely |
| 🟡 **Caution** | May contain user data | Review before deleting |
| 🔴 **Danger** | Critical for functionality | Deletion blocked |

### Customizing Safety Levels

- **Hover** on a safety badge to see the scientific criteria
- **Click** on a badge to change its level
- Custom levels are **persisted** across sessions
- Use **Reset to Default** to restore original levels

## 🤖 Supported AI Tools

| Tool | Detected Locations |
|------|-------------------|
| Claude Code | `~/.claude/`, `~/Library/Caches/claude-cli-nodejs` |
| Gemini/Antigravity | `~/.gemini/` |
| Cursor | `~/.cursor/`, `~/Library/Application Support/Cursor` |
| GitHub Copilot | `~/.config/github-copilot` |
| Codeium | `~/.codeium/` |
| Continue | `~/.continue/` |
| Tabnine | `~/.tabnine/` |
| Amazon CodeWhisperer | `~/.aws/codewhisperer` |
| Sourcegraph Cody | `~/.cody/` |
| Windsurf | `~/.windsurf/` |

## 🏗️ Project Structure

```
ai-cache-cleaner/
├── src/
│   ├── extension.ts        # Entry point + Webview UI
│   ├── cacheScanner.ts     # Directory scanner
│   ├── cacheDeleter.ts     # Deletion service
│   ├── aiToolSignatures.ts # AI tool database
│   └── safetyLevels.ts     # Safety definitions
├── media/
│   └── webview.css         # Dark theme styles
├── images/
│   └── icon.png            # Extension icon
└── package.json
```

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Adding New AI Tools

Edit `src/aiToolSignatures.ts` and add:

```typescript
{
    name: "Your AI Tool",
    patterns: [".your-tool"],
    locations: ["~", "~/Library/Application Support"],
    safeDirectories: ["cache", "logs"],
    cautionDirectories: ["history"],
    dangerDirectories: ["config"]
}
```

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Inspired by the need to manage growing AI tool caches
- Dark theme based on Developer Tool color palette
- Icons from [Heroicons](https://heroicons.com/)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/lidegejingHk">lidegejingHk</a>
</p>
