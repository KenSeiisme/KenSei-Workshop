import { $, copy } from "./common.js";
import { units, convert } from "./daily-core.js";
import { uiOption, uiMsg, uiFrom, uiError, uiText } from "../site/ui.js";

const cat = $("#unit-category"),
  from = $("#unit-from"),
  to = $("#unit-to");
for (const name of Object.keys(units)) cat.add(uiOption(uiFrom(name), name));
function update() {
  try {
    const result = convert(
      $("#unit-value").value,
      cat.value,
      Number(from.value),
      Number(to.value),
    );
    $("#unit-result").value = Number(result.toPrecision(12)).toString();
    uiText($("#unit-status"), uiMsg("Rounded to 12 significant digits."));
    $("#unit-copy").disabled = false;
    $("#unit-status").classList.remove("error-text");
  } catch (e) {
    $("#unit-result").value = "";
    uiText($("#unit-status"), uiError(e));
    $("#unit-copy").disabled = true;
    $("#unit-status").classList.add("error-text");
  }
}
cat.onchange = () => {
  from.replaceChildren();
  to.replaceChildren();
  units[cat.value].forEach((u, i) => {
    from.add(uiOption(uiFrom(u.name), i));
    to.add(uiOption(uiFrom(u.name), i));
  });
  to.value = "1";
  update();
};
from.onchange = to.onchange = update;
$("#unit-value").oninput = update;
$("#unit-swap").onclick = () => {
  const old = from.value;
  from.value = to.value;
  to.value = old;
  if ($("#unit-result").value) $("#unit-value").value = $("#unit-result").value;
  update();
};
$("#unit-copy").onclick = () => copy($("#unit-result"));
cat.onchange();
