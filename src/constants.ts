export const CONFIG_SCHEMA_VERSION = 1;
export const EVIDENCE_SCHEMA_VERSION = 1;
export const RECEIPT_SCHEMA_VERSION = 1;
export const CONNECTION_TIMEOUT_MS = 10_000;
export const READ_TIMEOUT_MS = 60_000;
export const REFRESH_TIMEOUT_MS = 180_000;
export const COMPLETION_TIMEOUT_MS = 60_000;
export const IDLE_WAIT_MS = 5_000;
export const SHUTDOWN_GRACE_MS = 5_000;
export const PROJECT_LOCK_TIMEOUT_MS = 10_000;
export const MODEL_VISIBLE_RESULT_BYTES = 32 * 1024;
export const RETAINED_STDERR_BYTES = 8 * 1024;
export const MAX_QUESTION_CODEPOINTS = 500;
export const MAX_QUERY_CODEPOINTS = 2_000;
export const MAX_SUMMARY_CODEPOINTS = 220;
export const MAX_ANSWER_CODEPOINTS = 20_000;
export const MAX_SOURCE_IDS = 10;
export const MAX_SOURCE_ID_CODEPOINTS = 500;
export const DISTILLATION_INPUT_CODEPOINTS = 30_000;
export const REPAIR_RESPONSE_CODEPOINTS = 4_000;
export const REPAIR_ERROR_CODEPOINTS = 500;
export const MAX_DIAGNOSTIC_CODEPOINTS = 1_000;
export const MEMORY_DIRECTORY = "graphify-out/memory";
export const RECEIPT_CUSTOM_TYPE = "second-brain.capture.v1";
export const STATUS_KEY = "second-brain";

export function codePoints(value: string): number {
  return Array.from(value).length;
}

export function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}
