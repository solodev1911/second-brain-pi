import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, mkdir, open, readFile, readdir, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { MEMORY_DIRECTORY, PROJECT_LOCK_TIMEOUT_MS, truncateCodePoints } from "./constants.js";
import { parseMemoryForDedupe, serializeMemory } from "./memory-format.js";
import { assertContainedExistingAncestor, projectRelative } from "./project-root.js";
import type { MemoryRecord, PublicationResult } from "./types.js";
import { SecondBrainError } from "./types.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withProjectLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const output = path.join(root, "graphify-out");
  assertContainedExistingAncestor(root, output);
  await mkdir(output, { recursive: true });
  assertContainedExistingAncestor(root, output);
  const lockPath = path.join(output, ".second-brain.lock");
  const deadline = Date.now() + PROJECT_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new SecondBrainError("PROJECT_BUSY", `Another Second Brain writer holds ${projectRelative(root, lockPath)}. The lock was not stolen.`);
      }
      await sleep(50);
    }
  }
  try { return await operation(); }
  finally { await rmdir(lockPath).catch(() => undefined); }
}

function normalizeQuestion(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function normalizeAnswer(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

function slug(question: string): string {
  const normalized = question.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const safe = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return truncateCodePoints(safe || "memory", 50);
}

function timestamp(date: string): string {
  return new Date(date).toISOString().replace(/[-:]/g, "").replace("T", "_").replace("Z", "").replace(".", "_");
}

async function findExactDuplicate(memoryDir: string, record: MemoryRecord): Promise<string | undefined> {
  let entries: string[];
  try { entries = await readdir(memoryDir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  for (const name of entries.sort()) {
    if (!name.endsWith(".md")) continue;
    const file = path.join(memoryDir, name);
    const parsed = parseMemoryForDedupe(await readFile(file, "utf8"));
    if (parsed && normalizeQuestion(parsed.question) === normalizeQuestion(record.question)
      && normalizeAnswer(parsed.answer) === normalizeAnswer(record.answer)) return file;
  }
  return undefined;
}

async function hashFile(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export async function publishMemory(
  projectRoot: string,
  record: MemoryRecord,
  revalidate: () => Promise<void>,
): Promise<PublicationResult> {
  return withProjectLock(projectRoot, async () => {
    const memoryDir = path.join(projectRoot, MEMORY_DIRECTORY);
    assertContainedExistingAncestor(projectRoot, memoryDir);
    await mkdir(memoryDir, { recursive: true });
    assertContainedExistingAncestor(projectRoot, memoryDir);
    const duplicate = await findExactDuplicate(memoryDir, record);
    if (duplicate) {
      return {
        absolutePath: duplicate,
        relativePath: projectRelative(projectRoot, duplicate),
        sha256: await hashFile(duplicate),
        deduplicated: true,
      };
    }

    await revalidate();
    const serialized = serializeMemory(record);
    const base = `query_${timestamp(record.date)}_${slug(record.question)}`;
    const temp = path.join(memoryDir, `.${base}.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await revalidate();

      let suffix = 0;
      while (suffix < 1_000) {
        const filename = `${base}${suffix ? `_${suffix}` : ""}.md`;
        const finalPath = path.join(memoryDir, filename);
        try {
          await link(temp, finalPath);
          await unlink(temp);
          return {
            absolutePath: finalPath,
            relativePath: projectRelative(projectRoot, finalPath),
            sha256: createHash("sha256").update(serialized).digest("hex"),
            deduplicated: false,
          };
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EEXIST") { suffix += 1; continue; }
          if (code === "EPERM" || code === "ENOTSUP" || code === "EXDEV") {
            throw new SecondBrainError("UNSUPPORTED_PUBLICATION", "This filesystem does not support exclusive hard-link publication.", { cause: error });
          }
          throw error;
        }
      }
      throw new SecondBrainError("FILENAME_EXHAUSTED", "Could not allocate a unique memory filename.");
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
    }
  });
}

export async function receiptTargetValid(projectRoot: string, relativePath: string, expectedHash: string): Promise<boolean> {
  const absolute = path.join(projectRoot, relativePath);
  try {
    assertContainedExistingAncestor(projectRoot, absolute);
    const info = await stat(absolute);
    return info.isFile() && await hashFile(absolute) === expectedHash;
  } catch { return false; }
}
