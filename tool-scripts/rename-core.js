export function renamed(files, options) {
  const start = Number(options.start),
    digits = Number(options.digits);
  if (
    options.number &&
    (!Number.isSafeInteger(start) ||
      start < 0 ||
      start > 999999999 ||
      !Number.isInteger(digits) ||
      digits < 1 ||
      digits > 9)
  )
    throw Error("Use a start from 0 to 999,999,999 and 1–9 digits.");
  const names = files.map((file, i) => {
    const original = file.name,
      last = original.lastIndexOf("."),
      base = last > 0 ? original.slice(0, last) : original,
      extension = last > 0 ? original.slice(last) : "";
    let text = options.find
      ? base.split(options.find).join(options.replace)
      : base;
    if (options.case === "lower") text = text.toLocaleLowerCase("en");
    if (options.case === "upper") text = text.toLocaleUpperCase("en");
    const name =
      (options.prefix || "") +
      (options.number ? String(start + i).padStart(digits, "0") + "_" : "") +
      text +
      (options.suffix || "") +
      extension;
    const error =
      !name ||
      name.length > 180 ||
      /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
      /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
        ? "Choose a portable file name (no reserved characters or names)."
        : null;
    return { original, name, error };
  });
  const counts = new Map();
  for (const row of names) {
    const key = row.name.normalize("NFC").toLocaleLowerCase("en");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return names.map((row) => ({
    ...row,
    error:
      row.error ||
      (counts.get(row.name.normalize("NFC").toLocaleLowerCase("en")) > 1
        ? "This name conflicts with another file."
        : null),
  }));
}
