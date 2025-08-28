import { MSG_TYPES } from './types';

export interface PruneResult {
  outLines: string[];
  kept: number;
  dropped: number;
  strategy: string;
}

export class SmartPruner {
  private lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  public pruneWithIndices(indicesToKeep: number[], strategy: string): PruneResult {
    const keptSet = new Set(indicesToKeep);
    const outLines: string[] = [];
    let kept = 0;
    let dropped = 0;

    // Always include first line (metadata)
    if (this.lines.length > 0) {
      outLines.push(this.lines[0]);
    }

    // Apply cache token hack
    const processedLines = this.applyCacheTokenHack(this.lines);

    // Process each line
    processedLines.forEach((line, idx) => {
      if (idx === 0) return; // Already added

      const isMessage = this.isMessageLine(line);
      
      if (isMessage) {
        if (keptSet.has(idx)) {
          kept++;
          outLines.push(line);
        } else {
          dropped++;
        }
      } else {
        // Always keep non-message lines (tool results, diagnostics)
        outLines.push(line);
      }
    });

    return {
      outLines,
      kept,
      dropped,
      strategy
    };
  }

  private isMessageLine(line: string): boolean {
    try {
      const obj = JSON.parse(line);
      return MSG_TYPES.has(obj.type);
    } catch {
      return false;
    }
  }

  private applyCacheTokenHack(lines: string[]): string[] {
    let lastNonZeroCacheLineIndex = -1;
    
    // Find the last non-zero cache line
    lines.forEach((ln, i) => {
      try {
        const obj = JSON.parse(ln);
        const usageObj = obj.usage || obj.message?.usage;
        if (usageObj?.cache_read_input_tokens && usageObj.cache_read_input_tokens > 0) {
          lastNonZeroCacheLineIndex = i;
        }
      } catch {
        // Not JSON, skip
      }
    });

    // Zero out only the last non-zero cache line
    return lines.map((ln, i) => {
      if (i === lastNonZeroCacheLineIndex) {
        try {
          const obj = JSON.parse(ln);
          const usageObj = obj.usage || obj.message?.usage;
          if (usageObj) {
            usageObj.cache_read_input_tokens = 0;
          }
          return JSON.stringify(obj);
        } catch {
          // Should not happen
        }
      }
      return ln;
    });
  }

  // Legacy method for backward compatibility
  public static pruneSessionLines(
    lines: string[], 
    keepN: number
  ): { outLines: string[]; kept: number; dropped: number; assistantCount: number } {
    const pruner = new SmartPruner(lines);
    const msgIndices: number[] = [];
    const assistantIndices: number[] = [];

    // Find all message indices
    lines.forEach((ln, i) => {
      if (i === 0) return;
      try {
        const { type } = JSON.parse(ln);
        if (MSG_TYPES.has(type)) {
          msgIndices.push(i);
          if (type === 'assistant') {
            assistantIndices.push(i);
          }
        }
      } catch {
        // Not JSON
      }
    });

    // Find cutoff based on last N assistant messages
    let indicesToKeep: number[] = [];
    if (assistantIndices.length > keepN) {
      const cutFrom = assistantIndices[assistantIndices.length - keepN];
      indicesToKeep = msgIndices.filter(idx => idx >= cutFrom);
    } else {
      indicesToKeep = msgIndices;
    }

    const result = pruner.pruneWithIndices(indicesToKeep, `Keep last ${keepN} assistant messages`);
    
    return {
      ...result,
      assistantCount: assistantIndices.length
    };
  }
}