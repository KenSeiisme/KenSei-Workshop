import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, ".."),
  sourceRoot = path.join(root, "src"),
  manifest = JSON.parse(
    await fs.readFile(
      path.join(sourceRoot, "vendor/fairy-stockfish/manifest.json"),
      "utf8",
    ),
  ),
  digest = (data) => createHash("sha256").update(data).digest("hex");

function verify(data, item) {
  if (data.length !== item.bytes || digest(data) !== item.sha256) {
    throw Error(`Dependency checksum mismatch: ${item.path || item.source}`);
  }
}

function targetPath(item) {
  const target = path.resolve(sourceRoot, item.path.replace(/^\//, "")),
    relative = path.relative(sourceRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw Error(`Invalid dependency path: ${item.path}`);
  }
  return target;
}

async function download(item) {
  const response = await fetch(item.source, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw Error(
      `Dependency download failed: ${response.status} ${item.source}`,
    );
  }
  const data = Buffer.from(await response.arrayBuffer());
  verify(data, item);
  return data;
}

// 僅讀取固定 tar 成員到記憶體，不把套件封存中的任意路徑解壓到磁碟。
function readPackageFiles(compressed, wanted) {
  const archive = gunzipSync(compressed, { maxOutputLength: 8 * 1024 * 1024 }),
    files = new Map(),
    stringAt = (offset, length) =>
      archive
        .subarray(offset, offset + length)
        .toString("utf8")
        .split("\0", 1)[0];
  for (let offset = 0; offset + 512 <= archive.length;) {
    if (archive.subarray(offset, offset + 512).every((byte) => byte === 0))
      break;
    const name = stringAt(offset, 100),
      prefix = stringAt(offset + 345, 155),
      entry = prefix ? `${prefix}/${name}` : name,
      size = Number.parseInt(stringAt(offset + 124, 12).trim(), 8),
      type = stringAt(offset + 156, 1),
      start = offset + 512;
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      start + size > archive.length
    ) {
      throw Error("Invalid pinned package archive");
    }
    if (wanted.has(entry)) {
      if ((type !== "" && type !== "0") || files.has(entry)) {
        throw Error(`Invalid or duplicate package member: ${entry}`);
      }
      files.set(entry, archive.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  for (const entry of wanted) {
    if (!files.has(entry)) throw Error(`Missing package member: ${entry}`);
  }
  return files;
}

const missing = [];
for (const item of manifest.files) {
  const data = await fs.readFile(targetPath(item)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (!data || data.length !== item.bytes || digest(data) !== item.sha256) {
    missing.push(item);
  }
}

let packageFiles;
const packageEntries = missing.filter((item) => item.archiveEntry);
if (packageEntries.length) {
  const data = await download(manifest.packageArchive);
  packageFiles = readPackageFiles(
    data,
    new Set(packageEntries.map((item) => item.archiveEntry)),
  );
}

for (const item of missing) {
  const data = item.archiveEntry
    ? packageFiles.get(item.archiveEntry)
    : await download(item);
  verify(data, item);
  const target = targetPath(item);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}

for (const item of manifest.files) {
  verify(await fs.readFile(targetPath(item)), item);
  console.log(`Verified ${item.path}`);
}
