export const MSG_TYPES = new Set(["user", "assistant", "system"]);

export interface PruneStrategy {
  name: string;
  description: string;
  getIndicesToKeep(analyzer: any): number[];
}

export interface PruneOptions {
  keep?: number;
  first?: number;
  last?: number;
  strategy?: string;
  dryRun?: boolean;
  interactive?: boolean;
}