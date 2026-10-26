// 隔离压缩与解压计算；取消任务时主页面直接终止本 worker。
importScripts("/vendor/fflate.js");
const MB = 1000000,
  MAX_INPUT = 100 * MB,
  MAX_OUTPUT = 500 * MB;
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}
const crcStep = (crc, data) => {
  for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return crc;
};
let archive, entries;
const send = (type, data = {}) => postMessage({ type, ...data });
const fail = (message) => {
  throw new Error(message);
};
function safeName(name) {
  const value = name.replaceAll("\\", "/");
  if (
    !value ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.split("/").some((p) => p === ".." || p === ".") ||
    /[\x00-\x1f]/.test(value)
  )
    fail("The ZIP contains an unsafe file path.");
  return value;
}
function directory(bytes) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    n = bytes.length;
  const u16 = (p) => d.getUint16(p, true),
    u32 = (p) => d.getUint32(p, true);
  let end = -1;
  for (let p = n - 22; p >= Math.max(0, n - 65557); p--)
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === n) {
      end = p;
      break;
    }
  if (end < 0) fail("This ZIP is damaged or unsupported.");
  const count = u16(end + 10),
    length = u32(end + 12),
    offset = u32(end + 16);
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== count ||
    count === 65535 ||
    offset === 0xffffffff
  )
    fail("Multi-volume and ZIP64 archives are not supported.");
  if (count > 2000) fail("This ZIP has more than 2,000 entries.");
  if (offset + length !== end) fail("The ZIP directory is damaged.");
  let p = offset,
    total = 0;
  const list = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50)
      fail("The ZIP directory is damaged.");
    const flags = u16(p + 8),
      method = u16(p + 10),
      crc = u32(p + 16),
      compressed = u32(p + 20),
      expanded = u32(p + 24),
      nameLength = u16(p + 28),
      extra = u16(p + 30),
      comment = u16(p + 32),
      local = u32(p + 42);
    if (flags & 1) fail("Encrypted ZIP archives are not supported.");
    if (method !== 0 && method !== 8)
      fail("This ZIP uses an unsupported compression method.");
    if (
      compressed === 0xffffffff ||
      expanded === 0xffffffff ||
      u16(p + 34) ||
      local === 0xffffffff
    )
      fail("ZIP64 and multi-volume archives are not supported.");
    const next = p + 46 + nameLength + extra + comment;
    if (next > end) fail("The ZIP directory is damaged.");
    const rawName = bytes.subarray(p + 46, p + 46 + nameLength);
    const name = safeName(
      flags & 2048
        ? new TextDecoder("utf-8", { fatal: true }).decode(rawName)
        : fflate.strFromU8(rawName, true),
    );
    if (
      local + 30 > offset ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method
    )
      fail("A ZIP file header is damaged.");
    const localName = u16(local + 26),
      localExtra = u16(local + 28),
      start = local + 30 + localName + localExtra;
    if (
      start + compressed > offset ||
      localName !== rawName.length ||
      rawName.some((b, j) => b !== bytes[local + 30 + j])
    )
      fail("A ZIP file is truncated or damaged.");
    if (
      !(flags & 8) &&
      (u32(local + 14) !== crc ||
        u32(local + 18) !== compressed ||
        u32(local + 22) !== expanded)
    )
      fail("A ZIP file size or checksum is inconsistent.");
    total += expanded;
    if (total > MAX_OUTPUT) fail("Expanded ZIP content exceeds 500 MB.");
    if (method === 0 && compressed !== expanded)
      fail("A stored ZIP entry has an invalid size.");
    if (name.endsWith("/") && expanded)
      fail("A folder entry contains unexpected content.");
    list.push({ name, method, crc, compressed, expanded, start, index: i });
    p = next;
  }
  if (p !== end) fail("The ZIP directory is damaged.");
  return list;
}
async function decode(entry, collect, onBytes) {
  let actual = 0,
    crc = 0xffffffff;
  const chunks = [];
  const accept = (chunk) => {
    actual += chunk.length;
    // 每个输出块都校验，不能只信任中央目录里的展开大小。
    if (actual > entry.expanded || actual > MAX_OUTPUT)
      fail(
        "Actual decompressed content exceeds the declared size or 500 MB limit.",
      );
    onBytes(chunk.length);
    crc = crcStep(crc, chunk);
    if (collect) chunks.push(chunk);
  };
  const data = archive.subarray(entry.start, entry.start + entry.compressed);
  if (entry.method === 0) {
    for (let p = 0; p < data.length; p += 65536) {
      accept(data.subarray(p, p + 65536));
      await new Promise((r) => setTimeout(r, 0));
    }
  } else {
    // 每次只交付一小块压缩输入，解码完成后再继续，限制峰值内存。
    const stream = new fflate.AsyncInflate();
    try {
      for (let p = 0; p < Math.max(1, data.length); p += 32768) {
        const final = p + 32768 >= data.length;
        await new Promise((resolve, reject) => {
          stream.ondata = (error, chunk) => {
            try {
              if (error) throw error;
              accept(chunk);
              resolve();
            } catch (e) {
              reject(e);
            }
          };
          stream.push(data.slice(p, p + 32768), final);
        });
      }
    } finally {
      stream.terminate();
    }
  }
  if (actual !== entry.expanded || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
    fail("A ZIP entry is damaged (size or checksum mismatch).");
  return collect ? new Blob(chunks) : null;
}
onmessage = async (event) => {
  try {
    const { action, file, files, index } = event.data;
    if (action === "pack") {
      if (
        !files.length ||
        files.length > 100 ||
        files.reduce((n, f) => n + f.size, 0) > MAX_INPUT
      )
        fail("Choose 1–100 files totaling at most 100 MB.");
      const chunks = [],
        used = new Set(),
        total = files.reduce((n, f) => n + f.size, 0);
      let done = 0,
        error;
      const zip = new fflate.Zip((e, data, final) => {
        if (e) {
          error = e;
          return;
        }
        chunks.push(data);
        if (final)
          send("packed", {
            blob: new Blob(chunks, { type: "application/zip" }),
          });
      });
      for (const source of files) {
        let name = safeName(source.webkitRelativePath || source.name),
          base = name,
          suffix = 2;
        while (used.has(name))
          name = base.replace(
            /(\.[^./]+)?$/,
            (match) => " (" + suffix++ + ")" + match,
          );
        used.add(name);
        const entry = new fflate.ZipDeflate(name, { level: 6 });
        zip.add(entry);
        for (
          let offset = 0;
          offset < Math.max(1, source.size);
          offset += 262144
        ) {
          const data = new Uint8Array(
            await source.slice(offset, offset + 262144).arrayBuffer(),
          );
          entry.push(data, offset + 262144 >= source.size);
          if (error) throw error;
          done += data.length;
          send("progress", {
            value: total ? (done / total) * 100 : 100,
            message: "Packing " + name,
          });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      zip.end();
    } else if (action === "open") {
      if (file.size > MAX_INPUT)
        fail("Choose a ZIP archive no larger than 100 MB.");
      archive = new Uint8Array(await file.arrayBuffer());
      entries = directory(archive);
      let actual = 0;
      for (const entry of entries) {
        await decode(entry, false, (n) => {
          actual += n;
          if (actual > MAX_OUTPUT)
            fail("Actual expanded ZIP content exceeds 500 MB.");
        });
        send("progress", {
          value: ((entry.index + 1) / Math.max(1, entries.length)) * 100,
          message: "Checking " + entry.name,
        });
      }
      send("opened", {
        entries: entries.map(({ name, expanded, index }) => ({
          name,
          expanded,
          index,
        })),
      });
    } else if (action === "extract-many") {
      const chosen = event.data.indices;
      if (
        !Array.isArray(chosen) ||
        !chosen.length ||
        chosen.length > 100 ||
        new Set(chosen).size !== chosen.length
      )
        fail("Select 1–100 archive files.");
      const selected = chosen.map((i) => entries?.[i]);
      if (
        selected.some((e) => !e || e.name.endsWith("/")) ||
        selected.reduce((n, e) => n + e.expanded, 0) > MAX_INPUT
      )
        fail("Select files totaling at most 100 MB.");
      const outputs = [];
      let actual = 0;
      for (const e of selected) {
        const blob = await decode(e, true, (n) => {
          actual += n;
          if (actual > MAX_INPUT)
            fail("Selected expanded content exceeds 100 MB.");
        });
        outputs.push({ name: e.name, blob });
        send("progress", {
          value: (outputs.length / selected.length) * 100,
          message: "Extracting " + e.name,
        });
      }
      send("selected", { files: outputs });
    } else if (action === "extract") {
      const entry = entries?.[index];
      if (!entry || entry.name.endsWith("/"))
        fail("Select a file from the opened archive.");
      const blob = await decode(entry, true, () => {});
      send("extracted", { blob, name: entry.name.split("/").pop() });
    }
  } catch (e) {
    send("error", {
      message: e.message || "This archive could not be processed.",
    });
  }
};
