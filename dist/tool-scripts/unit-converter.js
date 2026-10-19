import { $, copy } from "./common.js";
import { units, convert } from "./daily-core.js";
const cat = $("#unit-category"),
  from = $("#unit-from"),
  to = $("#unit-to");
for (const name of Object.keys(units)) cat.add(new Option(name, name));
function update() {
  try {
    const result = convert(
      $("#unit-value").value,
      cat.value,
      Number(from.value),
      Number(to.value),
    );
    $("#unit-result").value = Number(result.toPrecision(12)).toString();
    $("#unit-status").textContent = "Rounded to 12 significant digits.";
    $("#unit-copy").disabled = false;
  } catch (e) {
    $("#unit-result").value = "";
    $("#unit-status").textContent = e.message;
    $("#unit-copy").disabled = true;
  }
}
cat.onchange = () => {
  from.replaceChildren();
  to.replaceChildren();
  units[cat.value].forEach((u, i) => {
    from.add(new Option(u.name, i));
    to.add(new Option(u.name, i));
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
