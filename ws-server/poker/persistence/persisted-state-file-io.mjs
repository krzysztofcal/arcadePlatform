import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function writeJsonFileAtomic(filePath, value) {
  const normalizedFilePath = typeof filePath === "string" ? filePath.trim() : "";
  if (!normalizedFilePath) {
    throw new Error("Persisted state file path is required");
  }

  const tempFilePath = path.join(
    path.dirname(normalizedFilePath),
    `.${path.basename(normalizedFilePath)}.${process.pid}.${randomUUID()}.tmp`
  );

  await fs.writeFile(tempFilePath, `${JSON.stringify(value)}\n`, "utf8");
  await fs.rename(tempFilePath, normalizedFilePath);
}
