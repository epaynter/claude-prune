# claude-prune

Intelligent context management for Claude Code sessions. This CLI tool analyzes and prunes Claude Code session transcript files to reduce context usage while preserving the most important parts of your conversation.

> **Fork of [DannyAziz/claude-prune](https://github.com/DannyAziz/claude-prune)** with enhanced selection strategies and visual interface.

## Features

### Smart Interactive Pruning
- **Work Phase Detection**: Automatically identifies distinct phases in your session (setup, debugging, implementation)
- **Multiple Pruning Strategies**:
  - Keep recent work only
  - Keep bookends (beginning + end)
  - Keep all code/errors/file edits
  - Custom range selection
- **Visual Session Analysis**: See exactly what's in your session before pruning
- **Context Usage Prediction**: Know exactly how much context you'll free up

### Safety Features
- **Safe by Default**: Always preserves session summaries and metadata
- **Auto Backup**: Creates timestamped backups before modifying files
- **Restore Command**: Easy rollback to previous versions

## Installation

### Run directly (recommended)

```bash
# Using npx (Node.js)
npx claude-prune <sessionId> --keep 50

# Using bunx (Bun)
bunx claude-prune <sessionId> --keep 50
```

### Install globally

```bash
# Using npm
npm install -g claude-prune

# Using bun
bun install -g claude-prune
```

## Usage

### Interactive Mode (Recommended)

Simply provide your session ID for an interactive experience:

```bash
claude-prune abc-123-def
```

This will:
1. Analyze your session to detect work phases
2. Present you with smart pruning options
3. Show exactly how much context each option will free
4. Let you preview or customize the selection

### Quick Non-Interactive Mode

For automation or quick pruning without prompts:

```bash
claude-prune abc-123-def --non-interactive
```

### Legacy Mode

For backward compatibility with the original simple pruning:

```bash
claude-prune abc-123-def -k 10  # Keep last 10 assistant messages
```

### Restore from Backup

Every prune operation creates a backup. To restore:

```bash
claude-prune restore abc-123-def
```

### Options

- `-k, --keep <number>`: Use legacy mode - keep last N assistant messages
- `--non-interactive`: Skip interactive mode, use auto strategy
- `--dry-run`: Preview changes without modifying files
- `-h, --help`: Show help information
- `-V, --version`: Show version number

## Example Session

```
$ claude-prune abc-123-def

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Session Analysis
  147 messages | ~42k tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Work Phases Detected:

  ┌ Phase 1 (msg 1-23)     Initial setup and requirements
  ├ Phase 2 (msg 24-89)    Debugging and error resolution
     └─ 31 errors
  ├ Phase 3 (msg 90-147)   Implementation and coding
     └─ 12 file edits

Choose pruning strategy:
  [1] Keep recent work only (msg 90-147, frees 71% context)
  [2] Keep bookends (msg 1-10 + 120-147, frees 65% context)
  [3] Keep all code/errors (23 key messages, frees 58% context)
  [4] Custom range selection
  [5] View message details

Selection [1]: _
```

## How It Works

1. **Session Analysis**: Analyzes your conversation to identify work phases and important messages
2. **Smart Detection**: Identifies code blocks, errors, file edits, and tool usage
3. **Pruning Strategies**: Offers multiple strategies based on your session's structure
4. **Safe Backup**: Creates timestamped backups in `prune-backup/` before modifying
5. **Cache Optimization**: Automatically optimizes cache tokens to reduce UI context display

## Technical Details

### File Locations

Claude Code stores sessions in:
```
~/.claude/projects/{project-path-with-hyphens}/{sessionId}.jsonl
```

For example, a project at `/Users/alice/my-app` becomes:
```
~/.claude/projects/-Users-alice-my-app/{sessionId}.jsonl
```

Backups are stored in:
```
~/.claude/projects/{project}/prune-backup/{sessionId}.jsonl.{timestamp}
```

### Architecture

The tool is built with a modular architecture:
- `src/analyzer.ts` - Session analysis and phase detection
- `src/interactive.ts` - Interactive UI components  
- `src/pruner.ts` - Core pruning logic
- `src/index.ts` - CLI interface

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test          # Run all tests
bun test --watch  # Run tests in watch mode

# Build for distribution
bun run build

# Test locally
bun run src/index.ts prune <sessionId>  # Test prune command
bun run src/index.ts restore <sessionId> # Test restore command
./dist/index.js --help                   # Test built CLI
```

## Credits

- Original concept and implementation by [Danny Aziz](https://github.com/DannyAziz/claude-prune)
- Enhanced selection strategies and UI by [Eliot Paynter](https://github.com/epaynter)

## Contributing

Contributions welcome! The codebase is well-tested and documented. Please ensure:
- All tests pass (`bun test`)
- New features include tests
- Code follows existing patterns

## License

MIT © Eliot Paynter
