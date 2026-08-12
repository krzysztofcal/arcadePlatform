import fs from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(message);
}

function fsyncDirectory(directoryPath) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function writeExclusive(filePath, data) {
  let descriptor = null;
  let created = false;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    created = true;
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (created) {
      try { fs.unlinkSync(filePath); } catch { /* cleanup only the partial file created here */ }
    }
    throw error;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

export function ensurePrivateDirectory(directoryPath) {
  const resolved = path.resolve(directoryPath);
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { mode: 0o700 });
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("recovery directory must be a real directory");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) fail("recovery directory must belong to the current user");
  if ((stat.mode & 0o777) !== 0o700) fail("recovery directory permissions must be 0700");
  return resolved;
}

export function writeExclusiveFiles(files, { createDirectories = true } = {}) {
  if (!Array.isArray(files) || files.length === 0) fail("at least one output file is required");
  const normalized = files.map((file) => ({
    path: path.resolve(file.path),
    data: file.data,
  }));
  if (new Set(normalized.map((file) => file.path)).size !== normalized.length) fail("output file paths must be unique");
  const directories = [...new Set(normalized.map((file) => path.dirname(file.path)))];
  if (createDirectories) {
    for (const directory of directories) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const created = [];
  try {
    for (const file of normalized) {
      writeExclusive(file.path, file.data);
      created.push(file.path);
    }
    for (const directory of directories) fsyncDirectory(directory);
  } catch (error) {
    for (const filePath of created.reverse()) {
      try { fs.unlinkSync(filePath); } catch { /* cleanup only files created by this call */ }
    }
    for (const directory of directories) {
      try { fsyncDirectory(directory); } catch { /* preserve the original write error */ }
    }
    throw error;
  }
  return normalized.map((file) => file.path);
}

export function assertPrivateRegularFile(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("recovery bundle members must be regular files");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) fail("recovery bundle members must belong to the current user");
  if ((stat.mode & 0o777) !== 0o600) fail("recovery bundle member permissions must be 0600");
  return resolved;
}
