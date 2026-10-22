// 优先使用项目依赖；Codex 本机可复用已安装的浏览器测试运行时。
const path = require("node:path"),
  os = require("node:os");
try {
  module.exports = require("playwright");
} catch (error) {
  const runtime =
    process.env.WORKSHOP_PLAYWRIGHT_PATH ||
    path.join(
      os.homedir(),
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "node_modules",
      "playwright",
    );
  try {
    module.exports = require(runtime);
  } catch {
    throw Error(
      "Browser tests need Playwright. Run pnpm install and install the selected Playwright browser.",
      { cause: error },
    );
  }
}
