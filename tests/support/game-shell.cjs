// Follow the visible settings/menu controls after the board-first layout change.
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
  if (
    !["#game-mode", "#game-difficulty", "#game-human-side"].includes(selector)
  ) {
    if (!(await page.locator("[data-shell-info-dialog][open]").count())) {
      await openMenu(page);
      await page.locator("[data-shell-menu-dialog] [data-shell-info]").click();
    }
    if (!(await page.locator("#game-rank-panel").evaluate((node) => node.open)))
      await page.locator("#game-rank-panel>summary").click();
    return page.selectOption(selector, value);
  }
  await openSettings(page);
  const setup = page.locator("#game-setup");
  if (!(await setup.evaluate((node) => node.open)))
    await setup.locator("summary").click();
  await page.selectOption(selector, value);
  await page
    .locator("[data-shell-settings-dialog] [data-shell-close]")
    .last()
    .click();
}
async function gameClick(page, selector) {
  if (
    selector.includes("game-rank-panel") ||
    selector.includes("game-save-panel") ||
    [
      "#game-board-refresh",
      "#game-save-retry",
      "#game-milestones>summary",
    ].includes(selector)
  ) {
    if (!(await page.locator("[data-shell-info-dialog][open]").count())) {
      await openMenu(page);
      await page.locator("[data-shell-menu-dialog] [data-shell-info]").click();
    }
    if (
      selector === "#game-board-refresh" &&
      !(await page.locator("#game-rank-panel").evaluate((node) => node.open))
    )
      await page.locator("#game-rank-panel>summary").click();
  } else if (
    ["#game-settings-change", "#game-help", "#pong-leave"].includes(selector)
  )
    await openMenu(page);
  else if (selector === "#game-start") {
    if (
      !page.listenerCount("dialog") &&
      /New game|Restart/.test(await page.locator(selector).textContent())
    )
      page.once("dialog", (dialog) => dialog.accept());
    const parent = await page
      .locator(selector)
      .evaluate(
        (node) =>
          node.closest("dialog")?.hasAttribute("open") ||
          !node.closest("dialog"),
      );
    if (!parent) await openMenu(page);
    else if (
      !(await page
        .locator(selector)
        .evaluate((node) => !!node.closest("dialog[open]")))
    )
      await closePanels(page);
  }
  return page.click(selector);
}
module.exports = { gameSelect, gameClick, closePanels, openSettings, openMenu };
