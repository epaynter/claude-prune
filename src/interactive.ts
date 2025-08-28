import { select, text, confirm } from '@clack/prompts';
import chalk from 'chalk';
import { SessionAnalyzer, WorkPhase } from './analyzer';

export interface PruneSelection {
  indicesToKeep: number[];
  strategy: string;
}

export class InteractiveUI {
  private analyzer: SessionAnalyzer;
  private analysis: ReturnType<SessionAnalyzer['getAnalysis']>;

  constructor(analyzer: SessionAnalyzer) {
    this.analyzer = analyzer;
    this.analysis = analyzer.getAnalysis();
  }

  public async selectStrategy(): Promise<PruneSelection | null> {
    this.displayHeader();

    const strategies = this.buildStrategies();
    
    const choice = await select({
      message: chalk.gray('Select strategy'),
      options: strategies.map((s, i) => ({
        value: i,
        label: s.menuLabel || s.label,
        hint: s.menuHint
      }))
    });

    if (typeof choice !== 'number') {
      return null;
    }

    const selected = strategies[choice];

    if (selected.action === 'custom') {
      return await this.customRangeSelection();
    }

    if (selected.action === 'details') {
      await this.showMessageDetails();
      return await this.selectStrategy(); // Recurse to show menu again
    }

    return {
      indicesToKeep: selected.indices!,
      strategy: selected.label
    };
  }

  private displayHeader(): void {
    const { totalMessages, totalTokens } = this.analysis;
    
    console.log('');
    console.log(chalk.cyan('╔═╗╦  ╔═╗╦ ╦╔╦╗╔═╗') + chalk.gray(' ') + chalk.magenta('╔═╗╦═╗╦ ╦╔╗╔╔═╗'));
    console.log(chalk.cyan('║  ║  ╠═╣║ ║ ║║║╣ ') + chalk.gray(' ') + chalk.magenta('╠═╝╠╦╝║ ║║║║║╣ '));
    console.log(chalk.cyan('╚═╝╩═╝╩ ╩╚═╝═╩╝╚═╝') + chalk.gray(' ') + chalk.magenta('╩  ╩╚═╚═╝╝╚╝╚═╝'));
    console.log(chalk.gray('    ⟨⟨ ') + chalk.white('CONTEXT OPTIMIZER v2.0') + chalk.gray(' ⟩⟩'));
    console.log('');
    console.log(chalk.gray('    ') + chalk.white(`${totalMessages} messages`) + chalk.gray(' • ') + chalk.white(`${this.formatNumber(totalTokens)} tokens`));
    console.log('');
  }

  private displayPhases(): void {
    if (this.analysis.workPhases.length === 0) return;
    
    console.log(chalk.gray('Phases: ') + 
      this.analysis.workPhases.map((phase, i) => {
        const icon = phase.characteristics.errors > 0 ? chalk.red('●') : 
                    phase.characteristics.fileEdits > 0 ? chalk.yellow('◆') : chalk.blue('■');
        return chalk.white(`[${phase.start + 1}-${phase.end + 1}: `) + 
               this.getShortPhaseDesc(phase.description) + 
               ' ' + icon + chalk.white(']');
      }).join(chalk.gray(' → '))
    );
    
    console.log('');
  }

  private getShortPhaseDesc(description: string): string {
    if (description.includes('setup') || description.includes('requirements')) return 'Setup';
    if (description.includes('Implementation') || description.includes('coding')) return 'Build';
    if (description.includes('Debugging') || description.includes('error')) return 'Debug';
    if (description.includes('Discussion') || description.includes('planning')) return 'Plan';
    if (description.includes('Exploration')) return 'Explore';
    return 'Work';
  }

  private getPhaseIcon(description: string): string {
    if (description.includes('setup') || description.includes('requirements')) return '┌';
    if (description.includes('Implementation') || description.includes('coding')) return '├';
    if (description.includes('Debugging') || description.includes('error')) return '├';
    if (description.includes('Discussion') || description.includes('planning')) return '├';
    return '├';
  }

  private buildStrategies(): Array<{
    label: string;
    hint: string;
    menuLabel?: string;
    menuHint?: string;
    action?: string;
    indices?: number[];
  }> {
    const strategies = [];
    const messageIndices = this.analyzer.getMessageIndices();
    const totalMessages = messageIndices.length;

    // Strategy 1: Keep recent work only - default to last 40% of messages
    const recentStart = Math.floor(totalMessages * 0.6);
    const recentIndices = messageIndices.slice(recentStart);
    const recentFreed = Math.round(((totalMessages - recentIndices.length) / totalMessages) * 100);
    
    strategies.push({
      label: `Keep last ${totalMessages - recentStart} messages`,
      hint: this.createProgressBar(recentFreed),
      menuLabel: `Keep last ${totalMessages - recentStart} messages only`,
      menuHint: `${this.createCyberpunkBar(recentFreed)} ${chalk.green(recentFreed + '%')}`,
      indices: recentIndices
    });

    // Strategy 2: Bookends
    const firstCount = Math.min(10, Math.floor(totalMessages * 0.1));
    const lastCount = Math.min(30, Math.floor(totalMessages * 0.3));
    const bookendIndices = [
      ...messageIndices.slice(0, firstCount),
      ...messageIndices.slice(-lastCount)
    ];
    const bookendFreed = Math.round(((totalMessages - bookendIndices.length) / totalMessages) * 100);
    
    strategies.push({
      label: `Bookends (first ${firstCount} + last ${lastCount})`,
      hint: this.createProgressBar(bookendFreed),
      menuLabel: `Keep first ${firstCount} + last ${lastCount} messages`,
      menuHint: `${this.createCyberpunkBar(bookendFreed)} ${chalk.green(bookendFreed + '%')}`,
      indices: bookendIndices
    });

    // Strategy 3: Keep key messages
    const keyMessages = this.analysis.keyMessages;
    const keyFreed = Math.round(((totalMessages - keyMessages.length) / totalMessages) * 100);
    
    strategies.push({
      label: `Smart selection (${keyMessages.length} important messages)`,
      hint: this.createProgressBar(keyFreed),
      menuLabel: `Keep ${keyMessages.length} important messages (code/errors)`,
      menuHint: `${this.createCyberpunkBar(keyFreed)} ${chalk.green(keyFreed + '%')}`,
      indices: keyMessages
    });

    // Strategy 4: Custom range
    strategies.push({
      label: 'Custom range',
      hint: chalk.dim('specify exact ranges'),
      menuLabel: 'Custom range selection',
      menuHint: chalk.gray('specify ranges manually'),
      action: 'custom'
    });

    // Strategy 5: View details
    strategies.push({
      label: 'View details',
      hint: chalk.dim('see all messages'),
      action: 'details'
    });

    return strategies;
  }

  private async customRangeSelection(): Promise<PruneSelection | null> {
    console.log('\n' + chalk.bold('Custom Range Selection'));
    console.log(chalk.dim('Enter ranges to keep (e.g., "1-5,90-147" or "1-10,50-*" for end)'));
    console.log('');

    const input = await text({
      message: 'Enter ranges to keep',
      placeholder: '1-10,50-100',
      validate: (value) => {
        if (!value) return 'Please enter at least one range';
        if (!/^(\d+(-(\d+|\*))?,?)+$/.test(value.replace(/\s/g, ''))) {
          return 'Invalid format. Use "1-10,20-30" or "1-10,50-*"';
        }
      }
    });

    if (!input || typeof input !== 'string') {
      return null;
    }

    const indices = this.parseRanges(input);
    
    if (indices.length === 0) {
      console.log(chalk.red('No valid indices found'));
      return null;
    }

    return {
      indicesToKeep: indices,
      strategy: `Custom (${input})`
    };
  }

  private parseRanges(input: string): number[] {
    const messageIndices = this.analyzer.getMessageIndices();
    const totalMessages = messageIndices.length;
    const indices = new Set<number>();

    const ranges = input.split(',').map(r => r.trim());
    
    for (const range of ranges) {
      if (range.includes('-')) {
        const [startStr, endStr] = range.split('-');
        const start = parseInt(startStr) - 1; // Convert to 0-based
        const end = endStr === '*' ? totalMessages - 1 : parseInt(endStr) - 1;
        
        if (!isNaN(start) && (endStr === '*' || !isNaN(end))) {
          const actualEnd = Math.min(end, totalMessages - 1);
          for (let i = Math.max(0, start); i <= actualEnd; i++) {
            if (messageIndices[i]) {
              indices.add(messageIndices[i]);
            }
          }
        }
      } else {
        const idx = parseInt(range) - 1;
        if (!isNaN(idx) && messageIndices[idx]) {
          indices.add(messageIndices[idx]);
        }
      }
    }

    return Array.from(indices).sort((a, b) => a - b);
  }

  private async showMessageDetails(): Promise<void> {
    console.log('\n' + chalk.bold('Message Details:'));
    console.log(chalk.cyan('─'.repeat(60)) + '\n');

    let currentRange: { start: number; end: number; description: string } | null = null;
    
    this.analysis.messageDetails.forEach((msg, i) => {
      const description = this.describeMessage(msg);
      
      if (currentRange && currentRange.description === description) {
        currentRange.end = i;
      } else {
        if (currentRange) {
          this.printRange(currentRange);
        }
        currentRange = { start: i, end: i, description };
      }
    });

    if (currentRange) {
      this.printRange(currentRange);
    }

    console.log('\n' + chalk.dim('Press Enter to return to menu...'));
    await text({ message: '', defaultValue: '' });
  }

  private printRange(range: { start: number; end: number; description: string }): void {
    const rangeStr = range.start === range.end 
      ? `Message ${range.start + 1}`
      : `Message ${range.start + 1}-${range.end + 1}`;
    
    console.log(`${rangeStr.padEnd(20)} ${range.description}`);
  }

  private describeMessage(msg: any): string {
    const parts = [];
    
    if (msg.hasFileEdit) {
      parts.push('File modifications');
    } else if (msg.hasCode) {
      parts.push('Code implementation');
    } else if (msg.hasError) {
      parts.push('Error handling/debugging');
    } else if (msg.hasTool) {
      parts.push('Tool usage');
    } else {
      parts.push('Discussion');
    }

    return parts.join(', ');
  }

  private formatNumber(num: number): string {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }
    return num.toString();
  }

  private createProgressBar(percent: number): string {
    const width = 10;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    return `[${bar}] ${chalk.green(percent + '% freed')}`;
  }

  private createCyberpunkBar(percent: number): string {
    const width = 10;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return chalk.green('▓'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  }

  public async confirmPrune(indicesToKeep: number[], strategy: string): Promise<boolean> {
    const messageIndices = this.analyzer.getMessageIndices();
    const percentFreed = Math.round(((messageIndices.length - indicesToKeep.length) / messageIndices.length) * 100);
    
    console.log('');
    console.log(chalk.yellow(`Will keep ${indicesToKeep.length} of ${messageIndices.length} messages (frees ~${percentFreed}% context)`));
    
    return await confirm({
      message: chalk.yellow('Proceed with pruning?'),
      initialValue: true
    }) as boolean;
  }
}