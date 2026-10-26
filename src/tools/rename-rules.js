export function applyRenameRules(text, file, index, rules = []) {
  if (!Array.isArray(rules) || rules.length > 20)
    throw Error("Use at most 20 rename rules.");
  const original = file.name.replace(/\.[^.]+$/, "");
  for (const r of rules) {
    if (typeof r.value !== "string" || r.value.length > 200)
      throw Error("Use rename rule text up to 200 characters.");
    if (r.type === "prefix") text = r.value + text;
    else if (r.type === "suffix") text += r.value;
    else if (r.type === "lower") text = text.toLocaleLowerCase("en");
    else if (r.type === "upper") text = text.toLocaleUpperCase("en");
    else if (r.type === "replace") {
      if (r.find) text = text.split(r.find).join(r.value);
    } else if (r.type === "template") {
      const d = new Date(file.lastModified || 0),
        date = Number.isFinite(d.valueOf())
          ? [
              d.getFullYear(),
              String(d.getMonth() + 1).padStart(2, "0"),
              String(d.getDate()).padStart(2, "0"),
            ].join("-")
          : "";
      text = r.value.replace(
        /\{(name|original|date|n(?::0?([1-9]))?)\}/g,
        (_, key, pad) =>
          key === "name"
            ? text
            : key === "original"
              ? original
              : key === "date"
                ? date
                : String(index + 1).padStart(Number(pad) || 1, "0"),
      );
    } else throw Error("Unknown rename rule.");
  }
  return text;
}
