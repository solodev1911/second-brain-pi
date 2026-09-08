import { MAX_ANSWER_CODEPOINTS, MAX_QUESTION_CODEPOINTS, MAX_SOURCE_IDS, MAX_SUMMARY_CODEPOINTS, codePoints } from "./constants.js";
import type { MemoryRecord } from "./types.js";
import { SecondBrainError } from "./types.js";

export function escapeYamlDoubleQuoted(value: string): string {
  let result = "";
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (character === "\\") result += "\\\\";
    else if (character === '"') result += '\\"';
    else if (character === "\n") result += "\\n";
    else if (character === "\r") result += "\\r";
    else if (character === "\t") result += "\\t";
    else if (character === "\0") result += "\\0";
    else if (point === 0x2028) result += "\\L";
    else if (point === 0x2029) result += "\\P";
    else if (point < 0x20 || point === 0x7f) result += `\\x${point.toString(16).padStart(2, "0").toUpperCase()}`;
    else result += character;
  }
  return result;
}

export function validateMemoryRecord(record: MemoryRecord): void {
  if (!record.question.trim() || !record.summary.trim() || !record.answer.trim()) {
    throw new SecondBrainError("MEMORY_INVALID", "Question, summary, and answer must be nonempty.");
  }
  if (codePoints(record.question) > MAX_QUESTION_CODEPOINTS) throw new SecondBrainError("MEMORY_INVALID", "Question is too long.");
  if (codePoints(record.summary) > MAX_SUMMARY_CODEPOINTS) throw new SecondBrainError("MEMORY_INVALID", "Summary is too long.");
  if (codePoints(record.answer) > MAX_ANSWER_CODEPOINTS) throw new SecondBrainError("MEMORY_INVALID", "Answer is too long.");
  if (record.sourceNodes.length > MAX_SOURCE_IDS) throw new SecondBrainError("MEMORY_INVALID", "Too many source nodes.");
  if (Number.isNaN(Date.parse(record.date))) throw new SecondBrainError("MEMORY_INVALID", "Memory date is invalid.");
}

export function serializeMemory(record: MemoryRecord): string {
  validateMemoryRecord(record);
  const lines = [
    "---",
    'type: "query"',
    `date: "${escapeYamlDoubleQuoted(record.date)}"`,
    `question: "${escapeYamlDoubleQuoted(record.question)}"`,
    `summary: "${escapeYamlDoubleQuoted(record.summary)}"`,
    'contributor: "pi"',
  ];
  if (record.sourceNodes.length) {
    lines.push(`source_nodes: [${record.sourceNodes.map((id) => `"${escapeYamlDoubleQuoted(id)}"`).join(", ")}]`);
  }
  lines.push(
    "---",
    "",
    `# Q: ${record.question}`,
    "",
    "## Answer",
    "",
    record.answer.replace(/\r\n?/g, "\n").trim(),
  );
  if (record.sourceNodes.length) {
    lines.push("", "## Source Nodes", "", ...record.sourceNodes.map((id) => `- ${id}`));
  }
  return `${lines.join("\n")}\n`;
}

function yamlUnescape(value: string): string {
  return value.replace(/\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|[\\"nrt0LP])/g, (_match, token: string) => {
    if (token === "\\") return "\\";
    if (token === '"') return '"';
    if (token === "n") return "\n";
    if (token === "r") return "\r";
    if (token === "t") return "\t";
    if (token === "0") return "\0";
    if (token === "L") return "\u2028";
    if (token === "P") return "\u2029";
    if (token.startsWith("x")) return String.fromCodePoint(Number.parseInt(token.slice(1), 16));
    return String.fromCodePoint(Number.parseInt(token.slice(1), 16));
  });
}

export function parseMemoryForDedupe(text: string): { question: string; answer: string } | undefined {
  const questionMatch = /^question:\s*"((?:\\.|[^"\\])*)"\s*$/m.exec(text);
  const answerMatch = /\n## Answer\n\n([\s\S]*?)(?:\n\n## Source Nodes\n|\s*$)/.exec(text.replace(/\r\n?/g, "\n"));
  if (!questionMatch?.[1] || !answerMatch?.[1]) return undefined;
  return { question: yamlUnescape(questionMatch[1]), answer: answerMatch[1].trim() };
}

export function parseSerializedMemory(text: string): Pick<MemoryRecord, "question" | "summary" | "answer" | "sourceNodes"> | undefined {
  const questionMatch = /^question:\s*"((?:\\.|[^"\\])*)"\s*$/m.exec(text);
  const summaryMatch = /^summary:\s*"((?:\\.|[^"\\])*)"\s*$/m.exec(text);
  const answerMatch = /\n## Answer\n\n([\s\S]*?)(?:\n\n## Source Nodes\n|\s*$)/.exec(text.replace(/\r\n?/g, "\n"));
  if (questionMatch?.[1] === undefined || summaryMatch?.[1] === undefined || answerMatch?.[1] === undefined) return undefined;
  const sourceLine = /^source_nodes:\s*\[(.*)\]\s*$/m.exec(text)?.[1];
  const sourceNodes = sourceLine
    ? [...sourceLine.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => yamlUnescape(match[1] ?? "")).filter(Boolean)
    : [];
  return {
    question: yamlUnescape(questionMatch[1]),
    summary: yamlUnescape(summaryMatch[1]),
    answer: answerMatch[1].trim(),
    sourceNodes,
  };
}
