export function vcard(name, phone, email) {
  const escape = (s) =>
    s
      .replaceAll("\\", "\\\\")
      .replaceAll("\r", "")
      .replaceAll("\n", "\\n")
      .replaceAll(",", "\\,")
      .replaceAll(";", "\\;");
  return (
    "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:" +
    escape(name) +
    "\r\nTEL:" +
    escape(phone) +
    "\r\nEMAIL:" +
    escape(email) +
    "\r\nEND:VCARD"
  );
}
// 固定版本的生成器默认使用单字节字符；显式传入 UTF-8 字节，保留中文及 emoji。
export function qrByteText(text) {
  return Array.from(new TextEncoder().encode(text), (byte) =>
    String.fromCharCode(byte),
  ).join("");
}
