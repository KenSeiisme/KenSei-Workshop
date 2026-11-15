const fs = require("node:fs/promises");
const path = require("node:path");

async function saveBrowserFailure(context, suite) {
  const directory = process.env.WORKSHOP_BROWSER_ARTIFACTS;
  if (!directory) return;
  try {
    await fs.mkdir(directory, { recursive: true });
    await Promise.allSettled(
      context.pages().map((page, index) =>
        page.screenshot({
          path: path.join(directory, suite + "-" + (index + 1) + ".png"),
          timeout: 5000,
        }),
      ),
    );
  } catch (error) {
    console.warn("Could not capture failure screenshots:", error.message);
  }
}

module.exports = { saveBrowserFailure };
