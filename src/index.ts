#!/usr/bin/env node
import { homedir } from "os";
import { join, basename } from "path";
import fs from "fs-extra";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { confirm } from "@clack/prompts";
import { SessionAnalyzer } from "./analyzer";
import { InteractiveUI } from "./interactive";
import { SmartPruner } from "./pruner";

// ---------- CLI Definition ----------
const program = new Command()
  .name("claude-prune")
  .description("Prune early messages from a Claude Code session.jsonl file")
  .version("2.0.0");

program
  .command("prune")
  .description("Intelligently prune messages from a Claude session")
  .argument("<sessionId>", "UUID of the session (without .jsonl)")
  .option("-k, --keep <number>", "number of messages to keep (legacy mode)", parseInt)
  .option("--dry-run", "show what would happen but don't write")
  .option("--non-interactive", "skip interactive mode, use auto strategy")
  .action(main);

program
  .command("restore")
  .description("Restore a session from the latest backup")
  .argument("<sessionId>", "UUID of the session to restore (without .jsonl)")
  .option("--dry-run", "show what would be restored but don't write")
  .action(restore);

// Default command - run prune interactively
program
  .argument("[sessionId]", "UUID of the session (without .jsonl)")
  .option("-k, --keep <number>", "number of messages to keep (legacy mode)", parseInt)
  .option("--dry-run", "show what would happen but don't write")
  .option("--non-interactive", "skip interactive mode, use auto strategy")
  .action((sessionId, opts) => {
    if (sessionId) {
      main(sessionId, opts);
    } else {
      program.help();
    }
  });

// Extract core logic for testing
export function pruneSessionLines(lines: string[], keepN: number): { outLines: string[], kept: number, dropped: number, assistantCount: number } {
  const MSG_TYPES = new Set(["user", "assistant", "system"]);
  const msgIndexes: number[] = [];
  const assistantIndexes: number[] = [];

  // Pass 1 – locate message objects (skip first line entirely)
  lines.forEach((ln, i) => {
    if (i === 0) return; // Always preserve first item
    try {
      const { type } = JSON.parse(ln);
      if (MSG_TYPES.has(type)) {
        msgIndexes.push(i);
        if (type === "assistant") {
          assistantIndexes.push(i);
        }
      }
    } catch { /* non-JSON diagnostic line – keep as-is */ }
  });

  const total = msgIndexes.length;
  const keepNSafe = Math.max(0, keepN);
  
  // Find the cutoff point based on last N assistant messages
  let cutFrom = 0;
  if (assistantIndexes.length > keepNSafe) {
    cutFrom = assistantIndexes[assistantIndexes.length - keepNSafe];
  }

  // Pass 2 – build pruned output
  const outLines: string[] = [];
  let kept = 0;
  let dropped = 0;

  // Always include first line
  if (lines.length > 0) {
    outLines.push(lines[0]);
  }

  // HACK: Zero out ONLY the last non-zero cache_read_input_tokens to trick UI percentage
  let lastNonZeroCacheLineIndex = -1;
  let lastNonZeroCacheValue = 0;
  
  // First pass: find the last non-zero cache line
  lines.forEach((ln, i) => {
    try {
      const obj = JSON.parse(ln);
      const usageObj = obj.usage || obj.message?.usage;
      if (usageObj?.cache_read_input_tokens && usageObj.cache_read_input_tokens > 0) {
        lastNonZeroCacheLineIndex = i;
        lastNonZeroCacheValue = usageObj.cache_read_input_tokens;
      }
    } catch { /* not JSON, skip */ }
  });

  // Second pass: process lines and zero out only the last non-zero cache line
  const processedLines = lines.map((ln, i) => {
    if (i === lastNonZeroCacheLineIndex) {
      try {
        const obj = JSON.parse(ln);
        const usageObj = obj.usage || obj.message?.usage;
        usageObj.cache_read_input_tokens = 0;
        return JSON.stringify(obj);
      } catch { /* should not happen since we found it in first pass */ }
    }
    return ln;
  });

  processedLines.forEach((ln, idx) => {
    if (idx === 0) return; // Already added above
    
    const isMsg = MSG_TYPES.has((() => { try { return JSON.parse(ln).type; } catch { return ""; } })());
    if (isMsg) {
      if (idx >= cutFrom) { 
        kept++; 
        outLines.push(ln); 
      } else { 
        dropped++; 
      }
    } else {
      outLines.push(ln); // always keep tool lines, etc.
    }
  });

  return { outLines, kept, dropped, assistantCount: assistantIndexes.length };
}

// Only run CLI if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  program.parse();
}

// ---------- Main ----------
async function main(sessionId: string, opts: { keep?: number; dryRun?: boolean; nonInteractive?: boolean }) {
  const cwdProject = process.cwd().replace(/\//g, '-');
  const file = join(homedir(), ".claude", "projects", cwdProject, `${sessionId}.jsonl`);

  if (!(await fs.pathExists(file))) {
    console.error(chalk.red(`❌ No transcript at ${file}`));
    process.exit(1);
  }

  // Cool glitch loading animation
  const spinner = ora({
    text: chalk.gray('⟨⟨ ANALYZING ⟩⟩'),
    spinner: {
      interval: 80,
      frames: [
        '[█▒▒▒▒▒▒▒▒▒]',
        '[██▒▒▒▒▒▒▒▒]',
        '[███▒▒▒▒▒▒▒]',
        '[████▒▒▒▒▒▒]',
        '[█████▒▒▒▒▒]',
        '[██████▒▒▒▒]',
        '[███████▒▒▒]',
        '[████████▒▒]',
        '[█████████▒]',
        '[██████████]'
      ]
    }
  }).start();
  
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  
  // Quick flash through the scan
  await new Promise(resolve => setTimeout(resolve, 600));
  spinner.succeed(chalk.gray('⟨⟨ ') + chalk.green('COMPLETE') + chalk.gray(' ⟩⟩'));

  let result: { outLines: string[]; kept: number; dropped: number; strategy: string };

  // Legacy mode: use -k flag
  if (opts.keep) {
    const legacyResult = pruneSessionLines(lines, opts.keep);
    result = {
      outLines: legacyResult.outLines,
      kept: legacyResult.kept,
      dropped: legacyResult.dropped,
      strategy: `Legacy: keep last ${opts.keep} assistant messages`
    };
    
    console.log(chalk.yellow("\nUsing legacy mode. Run without -k flag for interactive pruning.\n"));
    console.log(`${chalk.green("Scanned")} ${lines.length} lines`);
    console.log(`Will keep ${result.kept} messages, drop ${result.dropped}`);
    
    if (!opts.dryRun && process.stdin.isTTY) {
      const ok = await confirm({ message: chalk.yellow("Proceed?"), initialValue: true });
      if (!ok) process.exit(0);
    }
  } 
  // New interactive mode
  else {
    const analyzer = new SessionAnalyzer(lines);
    
    if (opts.nonInteractive) {
      // Auto mode: use smart default strategy
      const messageIndices = analyzer.getMessageIndices();
      const totalMessages = messageIndices.length;
      const recentStart = Math.floor(totalMessages * 0.4);
      const indicesToKeep = messageIndices.slice(recentStart);
      
      const pruner = new SmartPruner(lines);
      result = pruner.pruneWithIndices(indicesToKeep, "Auto: recent work");
      
      console.log(`\nAuto-pruning: keeping messages ${recentStart + 1}-${totalMessages}`);
      console.log(`Will keep ${result.kept} messages, drop ${result.dropped}\n`);
      
      if (!opts.dryRun && process.stdin.isTTY) {
        const ok = await confirm({ message: chalk.yellow("Proceed?"), initialValue: true });
        if (!ok) process.exit(0);
      }
    } else {
      // Interactive mode
      const ui = new InteractiveUI(analyzer);
      const selection = await ui.selectStrategy();
      
      if (!selection) {
        console.log(chalk.yellow("Cancelled"));
        process.exit(0);
      }
      
      const pruner = new SmartPruner(lines);
      result = pruner.pruneWithIndices(selection.indicesToKeep, selection.strategy);
      
      if (!opts.dryRun) {
        const proceed = await ui.confirmPrune(selection.indicesToKeep, selection.strategy);
        if (!proceed) {
          console.log(chalk.yellow("Cancelled"));
          process.exit(0);
        }
      }
    }
  }

  if (opts.dryRun) {
    console.log(chalk.cyan("\nDry-run mode - no files modified"));
    return;
  }

  // Apply pruning
  const backupDir = join(homedir(), ".claude", "projects", cwdProject, "prune-backup");
  await fs.ensureDir(backupDir);
  const backup = join(backupDir, `${sessionId}.jsonl.${Date.now()}`);
  
  const writeSpinner = ora({
    text: chalk.gray('⟨⟨ OPTIMIZING ⟩⟩'),
    spinner: {
      interval: 100,
      frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    }
  }).start();
  
  await fs.copyFile(file, backup);
  await fs.writeFile(file, result.outLines.join("\n") + "\n");
  
  const percentFreed = Math.round(((lines.length - result.outLines.length) / lines.length) * 100);
  const beforeTokens = Math.floor(lines.join('').length / 4);
  const afterTokens = Math.floor(result.outLines.join('').length / 4);
  
  writeSpinner.succeed(chalk.gray('⟨⟨ ') + chalk.green('OPTIMIZATION COMPLETE') + chalk.gray(' ⟩⟩'));
  
  console.log('');
  console.log(chalk.gray('╔═══════════════════════════════════════╗'));
  console.log(chalk.gray('║') + chalk.white('     Before: ') + chalk.white(`${Math.round(beforeTokens/1000)}k tokens`) + '         '.padEnd(26 - `${Math.round(beforeTokens/1000)}k tokens`.length) + chalk.gray('║'));
  console.log(chalk.gray('║') + chalk.white('     After:  ') + chalk.green(`${Math.round(afterTokens/1000)}k tokens`) + '         '.padEnd(26 - `${Math.round(afterTokens/1000)}k tokens`.length) + chalk.gray('║'));
  console.log(chalk.gray('║') + chalk.white('     Freed:  ') + chalk.green.bold(`${percentFreed}% context`) + '         '.padEnd(26 - `${percentFreed}% context`.length) + chalk.gray('║'));
  console.log(chalk.gray('╚═══════════════════════════════════════╝'));
  console.log(chalk.dim(`\nBackup: ${basename(backup)}`));
}

// Extract restore logic for testing
export function findLatestBackup(backupFiles: string[], sessionId: string): { name: string, timestamp: number } | null {
  const sessionBackups = backupFiles
    .filter(f => f.startsWith(`${sessionId}.jsonl.`))
    .map(f => ({
      name: f,
      timestamp: parseInt(f.split('.').pop() || '0')
    }))
    .filter(backup => !isNaN(backup.timestamp)) // Filter out invalid timestamps
    .sort((a, b) => b.timestamp - a.timestamp);

  return sessionBackups.length > 0 ? sessionBackups[0] : null;
}

// ---------- Restore ----------
async function restore(sessionId: string, opts: { dryRun?: boolean }) {
  const cwdProject = process.cwd().replace(/\//g, '-');
  const file = join(homedir(), ".claude", "projects", cwdProject, `${sessionId}.jsonl`);
  const backupDir = join(homedir(), ".claude", "projects", cwdProject, "prune-backup");

  if (!(await fs.pathExists(backupDir))) {
    console.error(chalk.red(`❌ No backup directory found at ${backupDir}`));
    process.exit(1);
  }

  const spinner = ora(`Finding latest backup for ${sessionId}`).start();
  
  try {
    const backupFiles = await fs.readdir(backupDir);
    const latestBackup = findLatestBackup(backupFiles, sessionId);

    if (!latestBackup) {
      spinner.fail(chalk.red(`No backups found for session ${sessionId}`));
      process.exit(1);
    }

    const backupPath = join(backupDir, latestBackup.name);
    const backupDate = new Date(latestBackup.timestamp).toLocaleString();
    
    spinner.succeed(`Found latest backup from ${backupDate}`);

    if (opts.dryRun) {
      console.log(chalk.cyan(`Would restore from: ${backupPath}`));
      console.log(chalk.cyan(`Would restore to: ${file}`));
      return;
    }

    // Confirm restoration
    if (process.stdin.isTTY) {
      const ok = await confirm({ 
        message: chalk.yellow(`Restore session from backup (${backupDate})?`), 
        initialValue: false 
      });
      if (!ok) process.exit(0);
    }

    await fs.copyFile(backupPath, file);
    
    console.log(chalk.bold.green("✅ Restored:"), chalk.white(`${file}`));
    console.log(chalk.dim(`From backup: ${backupPath}`));

  } catch (error) {
    spinner.fail(chalk.red(`Error: ${error}`));
    process.exit(1);
  }
}