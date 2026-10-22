// Exercise the visible native disclosure control before using collapsed content.
async function expand(page, title) {
  const summary = page
    .locator("details.tool-fold > summary")
    .filter({ hasText: title });
  if (await summary.evaluate((node) => !node.parentElement.open))
    await summary.click();
}
module.exports = { expand };
