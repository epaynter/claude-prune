import { describe, it, expect } from 'vitest';
import { SmartPruner } from './pruner';

describe('SmartPruner', () => {
  const createMessage = (type: string, content: string = "test") => 
    JSON.stringify({ type, content });

  it('should prune based on provided indices', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
      createMessage("user", "3"),
      createMessage("assistant", "4"),
      createMessage("user", "5"),
    ];

    const pruner = new SmartPruner(lines);
    const result = pruner.pruneWithIndices([1, 4, 5], "test strategy");

    expect(result.kept).toBe(3);
    expect(result.dropped).toBe(2);
    expect(result.strategy).toBe("test strategy");
    expect(result.outLines).toHaveLength(4); // metadata + 3 kept messages
  });

  it('should preserve non-message lines', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user", "1"),
      JSON.stringify({ type: "tool_result", content: "result" }),
      createMessage("assistant", "2"),
      "non-json diagnostic",
      createMessage("user", "3"),
    ];

    const pruner = new SmartPruner(lines);
    const result = pruner.pruneWithIndices([1, 3], "test");

    expect(result.kept).toBe(2);
    expect(result.dropped).toBe(1);
    expect(result.outLines).toHaveLength(5); // metadata + 2 messages + 2 non-message lines
  });

  it('should apply cache token hack', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      JSON.stringify({ type: "user", content: "test", usage: { cache_read_input_tokens: 100 } }),
      JSON.stringify({ type: "assistant", content: "test", message: { usage: { cache_read_input_tokens: 200 } } }),
      JSON.stringify({ type: "user", content: "test" }),
    ];

    const pruner = new SmartPruner(lines);
    const result = pruner.pruneWithIndices([1, 2, 3], "test");

    // Check that the last non-zero cache token was zeroed
    const parsedLine = JSON.parse(result.outLines[2]);
    expect(parsedLine.message.usage.cache_read_input_tokens).toBe(0);
  });

  it('should handle empty indices', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
    ];

    const pruner = new SmartPruner(lines);
    const result = pruner.pruneWithIndices([], "empty");

    expect(result.kept).toBe(0);
    expect(result.dropped).toBe(2);
    expect(result.outLines).toHaveLength(1); // only metadata
  });

  it('should handle legacy pruneSessionLines', () => {
    const lines = [
      JSON.stringify({ type: "metadata" }),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
      createMessage("user", "3"),
      createMessage("assistant", "4"),
      createMessage("user", "5"),
      createMessage("assistant", "6"),
    ];

    const result = SmartPruner.pruneSessionLines(lines, 2);

    expect(result.kept).toBe(3); // Last 2 assistant messages + user messages between
    expect(result.dropped).toBe(3);
    expect(result.assistantCount).toBe(3);
  });

  it('should preserve metadata line', () => {
    const lines = [
      JSON.stringify({ type: "session_summary", content: "important" }),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
    ];

    const pruner = new SmartPruner(lines);
    const result = pruner.pruneWithIndices([], "test");

    expect(result.outLines[0]).toBe(lines[0]);
    expect(result.outLines).toHaveLength(1);
  });
});