// Exercise visible inline setup and the game menus; ranking controls never pause play.
async function closePanels(page) {
  for (const dialog of await page
    .locator("[data-play-shell] dialog[open]")
    .all())
    await dialog.locator(".dialog-close").first().click();
}
async function openSettings(page) {
  if (await page.locator("[data-shell-settings-dialog][open]").count()) return;
  await closePanels(page);
  await page
    .locator(".game-heading-tools [data-shell-settings]")
    .first()
    .click();
}
async function openMenu(page) {
  if (await page.locator("[data-shell-menu-dialog][open]").count()) return;
  await closePanels(page);
  const trigger = page
    .locator(
      ".game-control-deck [data-shell-menu], .pong-room-controls [data-shell-menu]",
    )
    .first();
  if (await trigger.isVisible()) await trigger.click();
  else {
    await openSettings(page);
    await page
      .locator("[data-shell-settings-dialog] [data-shell-menu]")
      .click();
  }
}
async function gameSelect(page, selector, value) {
  if (selector === "[data-effects-select]") {
    if (!(await page.locator("[data-play-shell]").count()))
      return page.selectOption(selector, value);
    await openSettings(page);
    await page.selectOption(selector, value);
    return page
      .locator("[data-shell-settings-dialog] [data-shell-close]")
      .last()
      .click();
  }
  if (selector === "#game-board-version") {
    await closePanels(page);
    if (!(await page.locator("#game-leaderboard-content").isVisible()))
      await page.click("#game-board-collapse");
    return page.selectOption(selector, value);
  }
  if (
    selector === "#game-difficulty" &&
    (await page.locator("#game-difficulty option").count()) === 1
  ) {
    if ((await page.inputValue(selector)) !== value)
      throw Error("This game has only one setup option.");
    return value;
  }
  if (selector === "#game-mode")
    throw Error(
      "Mode selection was removed. Use guest play or pause/resume to test local-only games.",
    );
  await closePanels(page);
  if (!(await page.locator("[data-shell-entry]").isVisible())) {
    await openMenu(page);
    await page.click("#game-settings-change");
  }
  return page.selectOption(selector, value);
}
async function gameClick(page, selector) {
  if (selector === "#game-milestones>summary") {
    await openMenu(page);
    await page.locator("[data-shell-menu-dialog] [data-shell-info]").click();
  } else if (
    ["#game-settings-change", "#game-help", "#pong-leave"].includes(selector)
  )
    await openMenu(page);
  else if (selector === "#game-start") {
    const state = await page
      .locator("[data-play-shell]")
      .getAttribute("data-shell-state");
    const replacesSave =
      state === "ready" && (await page.locator("#game-restore").isVisible());
    if (
      !page.listenerCount("dialog") &&
      (replacesSave || ["playing", "paused"].includes(state))
    )
      page.once("dialog", (dialog) => dialog.accept());
    const inClosedDialog = await page
      .locator(selector)
      .evaluate((node) => !!node.closest("dialog:not([open])"));
    if (inClosedDialog) await openMenu(page);
    else await closePanels(page);
  } else if (["#game-board-refresh", "#game-save-retry"].includes(selector))
    await closePanels(page);
  return page.click(selector);
}
module.exports = { gameSelect, gameClick, closePanels, openSettings, openMenu };
