import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function resolveTempFilePath(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, `.${base}.${process.pid}.${randomUUID()}.tmp`);
}

export async function writeUtf8FileAtomic(filePath, text) {
  const tempFilePath = resolveTempFilePath(filePath);
  await fs.writeFile(tempFilePath, text, "utf8");
  await fs.rename(tempFilePath, filePath);
}
