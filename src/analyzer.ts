import { MSG_TYPES } from './types';

export interface MessageInfo {
  index: number;
  type: string;
  content?: string;
  hasCode: boolean;
  hasError: boolean;
  hasFileEdit: boolean;
  hasTool: boolean;
  length: number;
  timestamp?: string;
}

export interface WorkPhase {
  start: number;
  end: number;
  description: string;
  messageCount: number;
  characteristics: {
    codeBlocks: number;
    errors: number;
    fileEdits: number;
    toolUses: number;
  };
}

export interface SessionAnalysis {
  totalMessages: number;
  totalTokens: number;
  workPhases: WorkPhase[];
  keyMessages: number[]; // Indices of important messages
  messageDetails: MessageInfo[];
}

export class SessionAnalyzer {
  private lines: string[];
  private messageIndices: number[] = [];
  private assistantIndices: number[] = [];
  private messageDetails: MessageInfo[] = [];

  constructor(lines: string[]) {
    this.lines = lines;
    this.analyze();
  }

  private analyze(): void {
    // First pass: identify all messages and their characteristics
    this.lines.forEach((line, index) => {
      if (index === 0) return; // Skip metadata line
      
      try {
        const obj = JSON.parse(line);
        if (MSG_TYPES.has(obj.type)) {
          this.messageIndices.push(index);
          
          if (obj.type === 'assistant') {
            this.assistantIndices.push(index);
          }

          const info: MessageInfo = {
            index,
            type: obj.type,
            content: obj.content || obj.message?.content || '',
            hasCode: this.detectCode(obj),
            hasError: this.detectError(obj),
            hasFileEdit: this.detectFileEdit(obj),
            hasTool: this.detectToolUse(obj),
            length: JSON.stringify(obj).length,
            timestamp: obj.timestamp
          };
          
          this.messageDetails.push(info);
        }
      } catch {
        // Not JSON or not a message, skip
      }
    });
  }

  private detectCode(obj: any): boolean {
    const content = obj.content || obj.message?.content || '';
    return /```[\s\S]*?```/.test(content) || 
           /^\s*(import|export|function|class|const|let|var)\s+/m.test(content);
  }

  private detectError(obj: any): boolean {
    const content = (obj.content || obj.message?.content || '').toLowerCase();
    return /error|exception|failed|failure|bug|issue|problem/.test(content) ||
           (obj.error && obj.error.length > 0);
  }

  private detectFileEdit(obj: any): boolean {
    return obj.tool_use?.name === 'Edit' || 
           obj.tool_use?.name === 'Write' ||
           obj.tool_use?.name === 'MultiEdit';
  }

  private detectToolUse(obj: any): boolean {
    return !!obj.tool_use || !!obj.tool_uses;
  }

  public detectWorkPhases(): WorkPhase[] {
    if (this.messageDetails.length === 0) return [];

    const phases: WorkPhase[] = [];
    const windowSize = 10; // Analyze in windows of 10 messages
    
    let currentPhase: WorkPhase | null = null;
    let lastCharacteristics = { codeBlocks: 0, errors: 0, fileEdits: 0, toolUses: 0 };

    for (let i = 0; i < this.messageDetails.length; i += windowSize) {
      const window = this.messageDetails.slice(i, Math.min(i + windowSize, this.messageDetails.length));
      
      const characteristics = {
        codeBlocks: window.filter(m => m.hasCode).length,
        errors: window.filter(m => m.hasError).length,
        fileEdits: window.filter(m => m.hasFileEdit).length,
        toolUses: window.filter(m => m.hasTool).length
      };

      const phaseType = this.classifyPhase(characteristics, window);
      
      // Detect phase changes
      if (!currentPhase || phaseType !== currentPhase.description) {
        if (currentPhase) {
          phases.push(currentPhase);
        }
        
        currentPhase = {
          start: this.messageIndices.indexOf(window[0].index),
          end: this.messageIndices.indexOf(window[window.length - 1].index),
          description: phaseType,
          messageCount: window.length,
          characteristics
        };
      } else {
        // Extend current phase
        currentPhase.end = this.messageIndices.indexOf(window[window.length - 1].index);
        currentPhase.messageCount += window.length;
        currentPhase.characteristics.codeBlocks += characteristics.codeBlocks;
        currentPhase.characteristics.errors += characteristics.errors;
        currentPhase.characteristics.fileEdits += characteristics.fileEdits;
        currentPhase.characteristics.toolUses += characteristics.toolUses;
      }
    }

    if (currentPhase) {
      phases.push(currentPhase);
    }

    // Merge small adjacent phases of the same type
    return this.mergePhases(phases);
  }

  private classifyPhase(characteristics: any, messages: MessageInfo[]): string {
    const { codeBlocks, errors, fileEdits, toolUses } = characteristics;
    const total = messages.length;
    
    if (errors > total * 0.3) {
      return 'Debugging and error resolution';
    }
    
    if (fileEdits > total * 0.3 || codeBlocks > total * 0.4) {
      return 'Implementation and coding';
    }
    
    if (toolUses > total * 0.4 && fileEdits === 0) {
      return 'Exploration and file reading';
    }
    
    if (messages.every(m => m.type === 'user' || m.type === 'assistant') && toolUses === 0) {
      if (messages[0].index < this.messageIndices[5]) {
        return 'Initial setup and requirements';
      }
      return 'Discussion and planning';
    }
    
    return 'General development';
  }

  private mergePhases(phases: WorkPhase[]): WorkPhase[] {
    if (phases.length <= 1) return phases;
    
    const merged: WorkPhase[] = [];
    let current = phases[0];
    
    for (let i = 1; i < phases.length; i++) {
      if (phases[i].description === current.description && 
          phases[i].start - current.end <= 3) {
        // Merge adjacent similar phases
        current.end = phases[i].end;
        current.messageCount += phases[i].messageCount;
        current.characteristics.codeBlocks += phases[i].characteristics.codeBlocks;
        current.characteristics.errors += phases[i].characteristics.errors;
        current.characteristics.fileEdits += phases[i].characteristics.fileEdits;
        current.characteristics.toolUses += phases[i].characteristics.toolUses;
      } else {
        merged.push(current);
        current = phases[i];
      }
    }
    merged.push(current);
    
    return merged;
  }

  public findKeyMessages(): number[] {
    // Score each message based on importance
    const scored = this.messageDetails.map(msg => ({
      index: msg.index,
      score: this.scoreMessage(msg)
    }));

    // Sort by score and return top messages
    scored.sort((a, b) => b.score - a.score);
    
    // Take top 20% or at least 10 messages
    const keepCount = Math.max(10, Math.floor(this.messageDetails.length * 0.2));
    
    return scored.slice(0, keepCount).map(s => s.index).sort((a, b) => a - b);
  }

  private scoreMessage(msg: MessageInfo): number {
    let score = 0;
    
    if (msg.hasFileEdit) score += 10;  // File edits are very important
    if (msg.hasCode) score += 5;       // Code blocks are important
    if (msg.hasError) score += 7;      // Errors and their context matter
    if (msg.hasTool) score += 3;       // Tool usage shows action
    
    // Longer messages often contain more substantial content
    if (msg.length > 1000) score += 2;
    if (msg.length > 2000) score += 3;
    
    // Recent messages are slightly more important
    const position = this.messageIndices.indexOf(msg.index);
    const recencyBonus = (position / this.messageIndices.length) * 3;
    score += recencyBonus;
    
    return score;
  }

  public estimateTokens(): number {
    // Rough estimation: ~4 characters per token
    const totalChars = this.lines.join('').length;
    return Math.floor(totalChars / 4);
  }

  public getAnalysis(): SessionAnalysis {
    return {
      totalMessages: this.messageIndices.length,
      totalTokens: this.estimateTokens(),
      workPhases: this.detectWorkPhases(),
      keyMessages: this.findKeyMessages(),
      messageDetails: this.messageDetails
    };
  }

  public getMessageIndices(): number[] {
    return this.messageIndices;
  }

  public getAssistantIndices(): number[] {
    return this.assistantIndices;
  }
}