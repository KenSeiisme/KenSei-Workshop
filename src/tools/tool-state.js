import { uiFrom, uiText } from "../site/ui.js";
// 独立于具体工具的状态适配层；不持有文件或编辑内容。
const labels = {
  ready: "Ready",
  working: "Working",
  success: "Complete",
  cancelled: "Cancelled",
  error: "Needs attention",
  stale: "Needs updating",
};
export function feedback(state, message) {
  // 初始化失敗必須一直可見，不能被已載入部分的輸入提示蓋掉。
  if (document.querySelector("[data-tool][data-load-error]")) return;
  const box = document.querySelector(".tool-feedback");
  if (!box) return;
  if (box.dataset.state !== state) box.dataset.state = state;
  const label = box.querySelector(".tool-state-label"),
    text = box.querySelector(".tool-state-message"),
    value = labels[state] || labels.ready;
  uiText(label, uiFrom(value));
  if (message) uiText(text, uiFrom(message));
}
export function stateFor(message, error = false) {
  if (
    /inputs? changed|settings changed|generate again to update|needs? (?:a new|updat)/i.test(
      message,
    )
  )
    return "stale";
  if (
    error ||
    /failed|could not|unable|invalid|exceed|not supported|damaged|permission denied/i.test(
      message,
    )
  )
    return "error";
  if (/cancelled|canceled|aborted/i.test(message)) return "cancelled";
  if (
    /\bcompleted?\b|ready to download|verified|finished|exported|generated|cue updated|subtitles loaded|^done|calculated|text extracted|(?:output|result|recording|preview|download) (?:is )?ready/i.test(
      message,
    )
  )
    return "success";
  if (
    /rendering|building|preparing|processing|loading|downloading|recognizing|starting|hashing|comparing|encoding|decoding|recording|measuring|running|packing|extracting|calculating|scanning|please wait/i.test(
      message,
    )
  )
    return "working";
  return "ready";
}
