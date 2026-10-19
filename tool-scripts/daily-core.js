// 纯计算逻辑，浏览器与测试共享；不保存用户输入。
export function randomIndex(length) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 65536)
    throw new Error("Invalid random range.");
  const values = new Uint32Array(1),
    ceiling = 4294967296 - (4294967296 % length);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= ceiling);
  return values[0] % length;
}
export function password(length, groups, exclude) {
  if (!Number.isInteger(length) || length < 8 || length > 64)
    throw new Error("Choose a whole-number length from 8 to 64.");
  const sets = groups
    .map((s) => (exclude ? s.replace(/[Il1O0]/g, "") : s))
    .filter(Boolean);
  if (!sets.length) throw new Error("Select at least one character category.");
  const all = sets.join("");
  // 拒绝不包含全部所选类别的样本，保持合格密码之间等概率。
  for (;;) {
    const result = Array.from(
      { length },
      () => all[randomIndex(all.length)],
    ).join("");
    if (sets.every((s) => [...result].some((c) => s.includes(c))))
      return result;
  }
}
export function parseHex(text) {
  let hex = text.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(hex))
    throw new Error("Use a 3- or 6-digit HEX color.");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export const hexColor = (rgb) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
export function rgbToHsl([r, g, b]) {
  [r, g, b] = [r, g, b].map((v) => v / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min,
    l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (delta) {
    s = delta / (1 - Math.abs(2 * l - 1));
    h =
      60 *
      (max === r
        ? ((g - b) / delta) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4);
  }
  return [(h + 360) % 360, s * 100, l * 100];
}
export function hslToRgb([h, s, l]) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  const parts =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return parts.map((v) => Math.round((v + m) * 255));
}
export function contrast(a, b) {
  const lum = (rgb) =>
    rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const unit = (name, factor, offset = 0) => ({ name, factor, offset });
export const units = {
  Length: [
    unit("Millimeters (mm)", 0.001),
    unit("Centimeters (cm)", 0.01),
    unit("Meters (m)", 1),
    unit("Kilometers (km)", 1000),
    unit("Inches (in)", 0.0254),
    unit("Feet (ft)", 0.3048),
    unit("Yards (yd)", 0.9144),
    unit("Miles (mi)", 1609.344),
  ],
  Weight: [
    unit("Milligrams (mg)", 0.000001),
    unit("Grams (g)", 0.001),
    unit("Kilograms (kg)", 1),
    unit("Tonnes (t)", 1000),
    unit("Ounces (oz)", 0.028349523125),
    unit("Pounds (lb)", 0.45359237),
  ],
  Temperature: [
    unit("Celsius (°C)", 1),
    unit("Fahrenheit (°F)", 5 / 9, (-32 * 5) / 9),
    unit("Kelvin (K)", 1, -273.15),
  ],
  Area: [
    unit("Square meters (m²)", 1),
    unit("Square kilometers (km²)", 1000000),
    unit("Square feet (ft²)", 0.09290304),
    unit("Hectares (ha)", 10000),
    unit("Acres", 4046.8564224),
  ],
  Volume: [
    unit("Milliliters (mL)", 0.001),
    unit("Liters (L)", 1),
    unit("Cubic meters (m³)", 1000),
    unit("US fluid ounces", 0.0295735295625),
    unit("US gallons", 3.785411784),
    unit("Imperial fluid ounces", 0.0284130625),
    unit("Imperial gallons", 4.54609),
  ],
  Speed: [
    unit("Meters / second (m/s)", 1),
    unit("Kilometers / hour (km/h)", 1 / 3.6),
    unit("Miles / hour (mph)", 0.44704),
    unit("Knots (kn)", 0.5144444444444445),
  ],
  Time: [
    unit("Milliseconds (ms)", 0.001),
    unit("Seconds (s)", 1),
    unit("Minutes (min)", 60),
    unit("Hours (h)", 3600),
    unit("Days", 86400),
    unit("Weeks", 604800),
  ],
  Storage: [
    unit("Bytes (B)", 1),
    unit("Kilobytes (kB · 1000 B)", 1e3),
    unit("Megabytes (MB)", 1e6),
    unit("Gigabytes (GB)", 1e9),
    unit("Terabytes (TB)", 1e12),
    unit("Kibibytes (KiB · 1024 B)", 1024),
    unit("Mebibytes (MiB)", 1024 ** 2),
    unit("Gibibytes (GiB)", 1024 ** 3),
    unit("Tebibytes (TiB)", 1024 ** 4),
  ],
};
export function convert(text, category, from, to) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()))
    throw new Error("Enter a valid number, such as 1.5 or 1e3.");
  const value = Number(text),
    a = units[category]?.[from],
    b = units[category]?.[to];
  if (!Number.isFinite(value) || !a || !b)
    throw new Error("Choose valid units and a finite number.");
  const base = value * a.factor + a.offset;
  if (category === "Temperature" && base < -273.1500000001)
    throw new Error("Temperature cannot be below absolute zero.");
  const result = (base - b.offset) / b.factor;
  if (!Number.isFinite(result))
    throw new Error("This value is too large to convert.");
  return Object.is(result, -0) ? 0 : result;
}
