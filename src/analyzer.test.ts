import { describe, it, expect } from 'vitest';
import { SessionAnalyzer } from './analyzer';

describe('SessionAnalyzer', () => {
  const createMessage = (type: string, content: string = "test") => 
    JSON.stringify({ type, content });

  const createCodeMessage = (type: string) => 
    JSON.stringify({ type, content: "Here is code:\n```javascript\nconsole.log('test');\n```" });

  const createErrorMessage = (type: string) => 
    JSON.stringify({ type, content: "Error: something went wrong" });

  const createToolMessage = (type: string) => 
    JSON.stringify({ type, tool_use: { name: "Edit" } });

  it('should identify work phases', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user", "Setup project"),
      createMessage("assistant", "Setting up"),
      createMessage("user", "Add feature"),
      createCodeMessage("assistant"),
      createToolMessage("assistant"),
      createErrorMessage("user"),
      createErrorMessage("assistant"),
      createMessage("user", "Fix it"),
      createCodeMessage("assistant"),
    ];

    const analyzer = new SessionAnalyzer(lines);
    const analysis = analyzer.getAnalysis();

    expect(analysis.workPhases).toBeDefined();
    expect(analysis.workPhases.length).toBeGreaterThan(0);
  });

  it('should detect key messages with code', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user"),
      createCodeMessage("assistant"),
      createMessage("user"),
      createMessage("assistant"),
    ];

    const analyzer = new SessionAnalyzer(lines);
    const keyMessages = analyzer.findKeyMessages();

    expect(keyMessages).toContain(2); // The code message should be marked as key
  });

  it('should detect key messages with errors', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user"),
      createMessage("assistant"),
      createErrorMessage("user"),
      createErrorMessage("assistant"),
    ];

    const analyzer = new SessionAnalyzer(lines);
    const keyMessages = analyzer.findKeyMessages();

    expect(keyMessages).toContain(3); // Error messages should be marked as key
    expect(keyMessages).toContain(4);
  });

  it('should detect tool usage', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user"),
      createToolMessage("assistant"),
      JSON.stringify({ type: "assistant", tool_uses: [{ name: "Read" }] }),
    ];

    const analyzer = new SessionAnalyzer(lines);
    const analysis = analyzer.getAnalysis();

    const toolMessages = analysis.messageDetails.filter(m => m.hasTool);
    expect(toolMessages).toHaveLength(2);
  });

  it('should estimate tokens', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user", "a".repeat(100)),
      createMessage("assistant", "b".repeat(100)),
    ];

    const analyzer = new SessionAnalyzer(lines);
    const analysis = analyzer.getAnalysis();

    expect(analysis.totalTokens).toBeGreaterThan(0);
    expect(analysis.totalTokens).toBeLessThan(1000); // Reasonable estimate
  });

  it('should handle empty session', () => {
    const lines = [JSON.stringify({ type: "metadata" })];

    const analyzer = new SessionAnalyzer(lines);
    const analysis = analyzer.getAnalysis();

    expect(analysis.totalMessages).toBe(0);
    expect(analysis.workPhases).toHaveLength(0);
    expect(analysis.keyMessages).toHaveLength(0);
  });

  it('should classify phases correctly', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      // Setup phase
      createMessage("user", "Create a new project"),
      createMessage("assistant", "Creating project"),
      // Error phase
      createErrorMessage("user"),
      createErrorMessage("assistant"),
      createErrorMessage("user"),
      createErrorMessage("assistant"),
      // Implementation phase
      createCodeMessage("assistant"),
      createToolMessage("assistant"),
      createCodeMessage("assistant"),
    ];

    const analyzer = new SessionAnalyzer(lines);
    const phases = analyzer.detectWorkPhases();

    const hasSetupPhase = phases.some(p => p.description.includes('setup') || p.description.includes('Discussion'));
    const hasErrorPhase = phases.some(p => p.description.includes('Debugging') || p.description.includes('error'));
    const hasImplPhase = phases.some(p => p.description.includes('Implementation') || p.description.includes('coding'));

    expect(hasSetupPhase || hasErrorPhase || hasImplPhase).toBe(true);
  });

  it('should return correct message indices', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user"),
      JSON.stringify({ type: "tool_result" }),
      createMessage("assistant"),
      "non-json line",
      createMessage("user"),
    ];

    const analyzer = new SessionAnalyzer(lines);
    const messageIndices = analyzer.getMessageIndices();
    const assistantIndices = analyzer.getAssistantIndices();

    expect(messageIndices).toEqual([1, 3, 5]);
    expect(assistantIndices).toEqual([3]);
  });
});