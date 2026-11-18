export const checksumFilename = "SHA256SUMS";
export const packageLimits = Object.freeze({
  count: 100,
  bytes: 100_000_000,
  manifest: 1_000_000,
});
export function archivePath(raw) {
  if (typeof raw !== "string") throw Error("Choose a valid archive path.");
  const value = raw.replaceAll("\\", "/");
  if (
    !value ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    /[\x00-\x1f]/.test(value) ||
    value.split("/").some((part) => part === "." || part === "..")
  )
    throw Error("The ZIP contains an unsafe file path.");
  return value;
}
export const filePath = (file) => file.webkitRelativePath || file.name;
export const portableKey = (value) =>
  value.normalize("NFC").toLocaleLowerCase("en");
export function plannedPackage(files, paths) {
  if (
    !files.length ||
    files.length > packageLimits.count ||
    files.reduce((size, file) => size + file.size, 0) > packageLimits.bytes
  )
    throw Error("Choose 1–100 files totaling at most 100 MB.");
  if (paths && (!Array.isArray(paths) || paths.length !== files.length))
    throw Error("Each transferred file needs one archive path.");
  const names = files.map((file, i) =>
    archivePath(paths?.[i] || filePath(file)),
  );
  const seen = new Set([portableKey(checksumFilename)]);
  for (const name of names) {
    const key = portableKey(name);
    if (
      name.length > 512 ||
      name.split("/").some((part) => !part || /[. ]$/.test(part))
    )
      throw Error(
        "Use archive paths up to 512 characters without empty segments or trailing dots or spaces.",
      );
    if (seen.has(key))
      throw Error("Use unique paths and reserve the root name SHA256SUMS.");
    seen.add(key);
  }
  for (const name of names) {
    const pieces = portableKey(name).split("/");
    for (let i = 1; i < pieces.length; i++) {
      if (seen.has(pieces.slice(0, i).join("/")))
        throw Error("A file path conflicts with a folder path.");
    }
  }
  return names;
}
export async function digest(data, algorithm = "SHA-256") {
  const bytes = new Uint8Array(await crypto.subtle.digest(algorithm, data));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
export function verificationRows(expected, entries, hashes) {
  const grouped = (rows) => {
    const result = new Map();
    for (const row of rows) {
      const key = portableKey(row.name);
      const group = result.get(key) || [];
      group.push(row);
      result.set(key, group);
    }
    return result;
  };
  const wanted = grouped(expected),
    found = grouped(entries);
  const result = [];
  for (const key of new Set([...wanted.keys(), ...found.keys()])) {
    const list = wanted.get(key) || [],
      actual = found.get(key) || [];
    if (list.length > 1 || actual.length > 1) {
      for (const name of new Set(
        [...list, ...actual].map((entry) => entry.name),
      ))
        result.push({ name, state: "Ambiguous" });
      continue;
    }
    const want = list[0],
      current = actual[0];
    const hash = current && hashes.get(current.index);
    if (!want || (current && want.name !== current.name))
      result.push({ name: current.name, state: "Not in manifest" });
    if (want && (!current || want.name !== current.name))
      result.push({ name: want.name, state: "Missing" });
    if (want && current && want.name === current.name)
      result.push({
        name: want.name,
        state:
          (want.sha256 && want.sha256 !== hash?.sha256) ||
          (want.sha512 && want.sha512 !== hash?.sha512)
            ? "Mismatch"
            : "Match",
      });
  }
  return result;
}
