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
// 旧文件共用 chromium 名称；显式选择引擎时仍运行相同的文件输出断言。
const engine = process.env.WORKSHOP_BROWSER_ENGINE;
if (engine && engine !== "chromium") {
  if (!["firefox", "webkit"].includes(engine))
    throw Error("WORKSHOP_BROWSER_ENGINE must be chromium, firefox or webkit.");
  const selected = module.exports[engine];
  module.exports = new Proxy(module.exports, {
    get(target, key) {
      if (key !== "chromium") return Reflect.get(target, key);
      return new Proxy(target.chromium, {
        get(type, method) {
          if (method !== "launch") return Reflect.get(type, method);
          return (options = {}) => {
            const { channel, ...supported } = options;
            return selected.launch(supported);
          };
        },
      });
    },
  });
}
