import { createHash } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { CaptureSnapshot, GraphifyEvidenceDetails } from "./types.js";
import { SecondBrainError } from "./types.js";

type ContentBlock = { type?: string; text?: string; id?: string; name?: string; arguments?: unknown };

function textContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is ContentBlock => Boolean(block && typeof block === "object"))
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function messageEntry(entry: SessionEntry): entry is Extract<SessionEntry, { type: "message" }> {
  return entry.type === "message";
}

function validEvidence(value: unknown): value is GraphifyEvidenceDetails {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<GraphifyEvidenceDetails>;
  return detail.kind === "second-brain.graphify"
    && detail.schemaVersion === 1
    && typeof detail.projectRoot === "string"
    && typeof detail.backendTool === "string"
    && typeof detail.toolCallId === "string"
    && Array.isArray(detail.emittedNodeIds)
    && detail.emittedNodeIds.every((id) => typeof id === "string")
    && detail.success === true;
}

export interface SelectionInput {
  entries: SessionEntry[];
  sessionId: string;
  sessionGeneration: number;
  projectRoot: string;
  capturedAt?: string;
}

export function selectCaptureSnapshot(input: SelectionInput): CaptureSnapshot {
  let userIndex = -1;
  for (let index = input.entries.length - 1; index >= 0; index -= 1) {
    const entry = input.entries[index];
    if (entry && messageEntry(entry) && entry.message.role === "user") {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) throw new SecondBrainError("NO_ELIGIBLE_TURN", "No completed user turn is available to remember.");
  const userEntry = input.entries[userIndex]! as Extract<SessionEntry, { type: "message" }>;
  const after = input.entries.slice(userIndex + 1).filter(messageEntry);
  const terminal = after.at(-1);
  if (!terminal || terminal.message.role !== "assistant") {
    throw new SecondBrainError("NO_ELIGIBLE_TURN", "The latest user turn has no completed assistant answer.");
  }
  const assistant = terminal.message;
  if (assistant.stopReason !== "stop") {
    throw new SecondBrainError("NO_ELIGIBLE_TURN", `The latest assistant result is ${assistant.stopReason}, not a completed answer.`);
  }
  if (assistant.content.some((block) => block.type === "toolCall")) {
    throw new SecondBrainError("NO_ELIGIBLE_TURN", "The latest assistant result still contains a tool request.");
  }
  const question = textContent((userEntry.message as { content: unknown }).content);
  const answer = textContent(assistant.content);
  if (!answer) throw new SecondBrainError("NO_ELIGIBLE_TURN", "The latest assistant answer has no finalized text.");

  const calls = new Map<string, string>();
  for (const entry of after) {
    if (entry.message.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content as ContentBlock[]) {
      if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
        calls.set(block.id, block.name);
      }
    }
  }
  const allowed = new Set<string>();
  const evidence: string[] = [];
  const supplementary: string[] = [];
  for (const entry of after) {
    if (entry.message.role !== "toolResult") continue;
    const result = entry.message;
    const text = textContent(result.content);
    const details = result.details;
    if (
      !result.isError
      && validEvidence(details)
      && details.projectRoot === input.projectRoot
      && details.toolCallId === result.toolCallId
      && details.backendTool === result.toolName
      && calls.get(result.toolCallId) === result.toolName
      && details.evidenceEligible
    ) {
      for (const id of details.emittedNodeIds) allowed.add(id);
      if (text) evidence.push(`[${result.toolName} ${result.toolCallId}]\n${text}`);
    } else if (text) {
      supplementary.push(`[${result.toolName}]\n${text}`);
    }
  }

  return {
    sessionId: input.sessionId,
    sessionGeneration: input.sessionGeneration,
    projectRoot: input.projectRoot,
    userEntryId: userEntry.id,
    answerEntryId: terminal.id,
    sourceAnswerSha256: createHash("sha256").update(answer).digest("hex"),
    question,
    answer,
    allowedNodeIds: [...allowed],
    evidenceText: evidence.join("\n\n"),
    supplementaryText: supplementary.join("\n\n"),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

export function captureIdentity(snapshot: CaptureSnapshot): string {
  return `${snapshot.projectRoot}\u0000${snapshot.sessionId}\u0000${snapshot.answerEntryId}\u0000${snapshot.sourceAnswerSha256}`;
}
