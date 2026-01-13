# Contributing to AI Cache Cleaner

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## 🚀 Getting Started

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ai-cache-cleaner.git
   ```
3. **Install** dependencies:
   ```bash
   npm install
   ```
4. **Create** a branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 🛠️ Development

### Build

```bash
npm run compile
```

### Watch Mode

```bash
npm run watch
```

### Test in VSCode

Press `F5` to launch the Extension Development Host.

## 📝 Code Style

- Use **TypeScript** for all source files
- Follow existing code formatting
- Use meaningful variable/function names
- Add comments for complex logic

## 🎯 What to Contribute

### Adding New AI Tools

1. Edit `src/aiToolSignatures.ts`
2. Add a new entry to `AI_TOOL_SIGNATURES`:

```typescript
{
    name: "Your AI Tool",
    patterns: [".your-tool", "your-tool-cache"],
    locations: ["~", "~/Library/Application Support"],
    safeDirectories: ["cache", "logs", "temp"],
    cautionDirectories: ["history", "sessions"],
    dangerDirectories: ["config", "plugins"]
}
```

3. Test that the tool is detected correctly

### Improving Safety Classifications

1. Edit `src/safetyLevels.ts` or `src/aiToolSignatures.ts`
2. Ensure classifications follow the scientific criteria:
   - **Safe**: Auto-generated, can regenerate, no user content
   - **Caution**: May contain user data, recovery needs effort
   - **Danger**: Required for functionality, cannot regenerate

### UI Improvements

1. Edit `src/extension.ts` for HTML/JS changes
2. Edit `media/webview.css` for styling

## 📦 Submitting Changes

1. **Commit** your changes:
   ```bash
   git commit -m "feat: add support for XYZ AI tool"
   ```

2. **Push** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Open a Pull Request** with:
   - Clear title describing the change
   - Description of what was changed and why
   - Screenshots if UI changes

## 🐛 Reporting Bugs

Please include:
- VSCode version
- OS and version
- Steps to reproduce
- Expected vs actual behavior
- Error messages (if any)

## 💡 Feature Requests

Open an issue with:
- Clear description of the feature
- Use case / why it's needed
- Possible implementation approach

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.
