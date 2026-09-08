import path from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { MAX_ANSWER_CODEPOINTS, RECEIPT_CUSTOM_TYPE, RECEIPT_SCHEMA_VERSION, codePoints } from "./constants.js";
import { canonicalizeProposedSourceIds, readGraph, verifyIndexedMemory } from "./graph.js";
import { distill, redactObviousCredentials, type CompletionAdapter } from "./distillation.js";
import type { GraphifyService } from "./graphify-service.js";
import { parseSerializedMemory } from "./memory-format.js";
import { publishMemory, receiptTargetValid } from "./memory-store.js";
import { captureIdentity, selectCaptureSnapshot } from "./turn-selection.js";
import type { CaptureReceipt, CaptureSnapshot, MemoryRecord, PublicationResult } from "./types.js";
import { SecondBrainError } from "./types.js";

export interface CaptureOutcome {
  receipt: CaptureReceipt;
  publication: PublicationResult;
}

function isReceipt(value: unknown): value is CaptureReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<CaptureReceipt>;
  return receipt.schemaVersion === RECEIPT_SCHEMA_VERSION
    && typeof receipt.projectRoot === "string"
    && typeof receipt.sessionId === "string"
    && typeof receipt.answerEntryId === "string"
    && typeof receipt.sourceAnswerSha256 === "string"
    && typeof receipt.memoryFileSha256 === "string"
    && typeof receipt.savedFile === "string";
}

async function reusableReceipt(entries: SessionEntry[], snapshot: CaptureSnapshot): Promise<CaptureReceipt | undefined> {
  for (const entry of [...entries].reverse()) {
    if (entry.type !== "custom" || entry.customType !== RECEIPT_CUSTOM_TYPE || !isReceipt(entry.data)) continue;
    const receipt = entry.data;
    if (receipt.projectRoot !== snapshot.projectRoot || receipt.sessionId !== snapshot.sessionId
      || receipt.answerEntryId !== snapshot.answerEntryId || receipt.sourceAnswerSha256 !== snapshot.sourceAnswerSha256) continue;
    if (await receiptTargetValid(snapshot.projectRoot, receipt.savedFile, receipt.memoryFileSha256)) return receipt;
  }
  return undefined;
}

export class RememberCoordinator {
  private readonly inFlight = new Map<string, Promise<CaptureOutcome>>();

  capture(
    snapshot: CaptureSnapshot,
    entries: SessionEntry[],
    complete: CompletionAdapter,
    service: GraphifyService,
    validateCurrent: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<CaptureOutcome> {
    const key = captureIdentity(snapshot);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operation = this.run(snapshot, entries, complete, service, validateCurrent, signal)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  private async run(
    snapshot: CaptureSnapshot,
    entries: SessionEntry[],
    complete: CompletionAdapter,
    service: GraphifyService,
    validateCurrent: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<CaptureOutcome> {
    const prior = await reusableReceipt(entries, snapshot);
    let publication: PublicationResult;
    let record: MemoryRecord;
    let usedFallback = false;
    let redacted = false;
    let truncated = codePoints(snapshot.answer) > MAX_ANSWER_CODEPOINTS;
    let warning: string | undefined;

    if (prior) {
      publication = {
        absolutePath: path.join(snapshot.projectRoot, prior.savedFile),
        relativePath: prior.savedFile,
        sha256: prior.memoryFileSha256,
        deduplicated: true,
      };
      const text = await import("node:fs/promises").then((fs) => fs.readFile(publication.absolutePath, "utf8"));
      const parsed = parseSerializedMemory(text);
      if (!parsed) throw new SecondBrainError("MEMORY_INVALID", `Cannot parse prior receipt target ${prior.savedFile}.`);
      record = { ...parsed, date: snapshot.capturedAt, contributor: "pi" };
      usedFallback = prior.usedFallback;
      redacted = prior.redacted;
      truncated = prior.truncated;
    } else {
      const distilled = await distill(snapshot, complete, signal);
      usedFallback = distilled.usedFallback;
      warning = distilled.reason;
      truncated ||= distilled.promptTruncated;
      const [questionRedaction, summaryRedaction, answerRedaction] = await Promise.all([
        redactObviousCredentials(distilled.memory.question),
        redactObviousCredentials(distilled.memory.summary),
        redactObviousCredentials(distilled.memory.answer),
      ]);
      redacted = questionRedaction.redacted || summaryRedaction.redacted || answerRedaction.redacted;
      if (!answerRedaction.value.trim()) throw new SecondBrainError("REDACTION_EMPTY", "Credential redaction left no usable answer.");
      const { document } = await readGraph(snapshot.projectRoot).catch(() => ({ document: { nodes: [], links: [] } }));
      const sourceNodes = canonicalizeProposedSourceIds(distilled.memory.sourceNodes, new Set(snapshot.allowedNodeIds), document);
      record = {
        question: questionRedaction.value,
        summary: summaryRedaction.value,
        answer: answerRedaction.value,
        sourceNodes,
        date: snapshot.capturedAt,
        contributor: "pi",
      };
      publication = await publishMemory(snapshot.projectRoot, record, validateCurrent);
    }

    const generation = publication.deduplicated ? 0 : service.markPublished();
    let refreshStatus: CaptureReceipt["refreshStatus"] = "failed";
    let memoryLinks: number | undefined;
    try {
      await service.refreshAfter(generation, signal);
      const verified = await verifyIndexedMemory(snapshot.projectRoot, publication.absolutePath, record);
      refreshStatus = verified.status;
      memoryLinks = verified.memoryLinks;
      warning = verified.warning ?? warning;
    } catch (error) {
      refreshStatus = "failed";
      warning = `Saved but indexing failed: ${(error as Error).message}`;
    }

    const receipt: CaptureReceipt = {
      schemaVersion: 1,
      projectRoot: snapshot.projectRoot,
      sessionId: snapshot.sessionId,
      userEntryId: snapshot.userEntryId,
      answerEntryId: snapshot.answerEntryId,
      sourceAnswerSha256: snapshot.sourceAnswerSha256,
      memoryFileSha256: publication.sha256,
      savedFile: publication.relativePath,
      capturedAt: snapshot.capturedAt,
      deduplicated: publication.deduplicated,
      usedFallback,
      truncated,
      redacted,
      refreshStatus,
      ...(memoryLinks !== undefined ? { memoryLinks } : {}),
      ...(warning ? { warning: warning.slice(0, 1_000) } : {}),
    };
    return { receipt, publication };
  }
}

export function validateSnapshotStillCurrent(
  approved: CaptureSnapshot,
  entries: SessionEntry[],
  sessionId: string,
  generation: number,
): void {
  if (approved.sessionId !== sessionId || approved.sessionGeneration !== generation) {
    throw new SecondBrainError("CAPTURE_INVALIDATED", "The Pi session changed before the memory could be published.");
  }
  const current = selectCaptureSnapshot({
    entries,
    sessionId,
    sessionGeneration: generation,
    projectRoot: approved.projectRoot,
    capturedAt: approved.capturedAt,
  });
  if (current.userEntryId !== approved.userEntryId || current.answerEntryId !== approved.answerEntryId
    || current.sourceAnswerSha256 !== approved.sourceAnswerSha256) {
    throw new SecondBrainError("CAPTURE_INVALIDATED", "A new turn or branch selection replaced the answer approved for capture.");
  }
}
