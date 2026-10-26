export function parseManifest(text) {
  if (new TextEncoder().encode(text).length > 1000000)
    throw Error("Use a checksum manifest up to 1 MB.");
  let list;
  if (text.trim().startsWith("{")) {
    const data = JSON.parse(text);
    list = data.files;
    if (!Array.isArray(list))
      throw Error("Choose a KenSei checksum JSON manifest.");
  } else
    list = text
      .split(/\r?\n/)
      .filter((x) => x.trim() && !x.startsWith("#"))
      .map((line) => {
        const m = line.match(/^([a-fA-F0-9]{64}|[a-fA-F0-9]{128}) [ *](.+)$/);
        if (!m) throw Error("Use SHA256SUMS or SHA512SUMS lines.");
        return {
          name: m[2],
          [m[1].length === 64 ? "sha256" : "sha512"]: m[1].toLowerCase(),
        };
      });
  if (list.length > 10000) throw Error("Use at most 10,000 checksum entries.");
  return list.map((r) => {
    if (
      typeof r.name !== "string" ||
      !r.name ||
      r.name.length > 512 ||
      (!r.sha256 && !r.sha512) ||
      (r.sha256 && !/^[a-fA-F0-9]{64}$/.test(r.sha256)) ||
      (r.sha512 && !/^[a-fA-F0-9]{128}$/.test(r.sha512))
    )
      throw Error("The checksum manifest contains an invalid entry.");
    return {
      name: r.name,
      sha256: r.sha256?.toLowerCase(),
      sha512: r.sha512?.toLowerCase(),
    };
  });
}
export function compareManifest(expected, actual) {
  return expected
    .map((e) => {
      const rows = actual.filter((r) => r.name === e.name);
      return {
        ...e,
        state: !rows.length
          ? "Missing"
          : rows.length !== 1
            ? "Ambiguous"
            : (e.sha256 && !rows[0].sha256) || (e.sha512 && !rows[0].sha512)
              ? "Run required algorithm"
              : Object.entries(e)
                    .filter(([k]) => k !== "name")
                    .every(([k, v]) => !v || rows[0][k] === v)
                ? "Match"
                : "Mismatch",
      };
    })
    .concat(
      actual
        .filter((r) => !expected.some((e) => e.name === r.name))
        .map((r) => ({ name: r.name, state: "Not in manifest" })),
    );
}
