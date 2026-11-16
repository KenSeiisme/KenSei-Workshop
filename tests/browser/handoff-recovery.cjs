const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const { saveBrowserFailure } = require("../support/browser-artifacts.cjs");

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const sdk = `
export function createClient() {
  return { auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange() {} } };
}
`;
async function send(page, target, kind) {
  await page.evaluate(
    async ({ target, kind }) => {
      const { sendControl } = await import("/tool-scripts/handoff.js");
      const anchor = document.createElement("div");
      anchor.id = "fixture-handoff";
      document.querySelector("#fixture-handoff")?.remove();
      document.querySelector("[data-tool]").prepend(anchor);
      sendControl(
        anchor,
        () =>
          kind === "text"
            ? { kind, text: "A local result" }
            : {
                kind,
                files: [
                  new File(["not an image"], "broken.png", {
                    type: "image/png",
                  }),
                ],
              },
        [target],
      );
    },
    { target, kind },
  );
  const popup = page.waitForEvent("popup");
  await page.locator("#fixture-handoff .handoff-controls > button").click();
  return popup;
}
const progress = (page, selector = "[data-tool] > .handoff-progress") =>
  page.locator(selector);
const sourceProgress = (page) =>
  progress(page, "#fixture-handoff .handoff-progress");
const includes = (locator, text) => locator.filter({ hasText: text }).waitFor();

async function main() {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
  });
  const context = await browser.newContext();
  try {
    await context.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (route) =>
        route.fulfill({ contentType: "application/javascript", body: sdk }),
    );
    await context.addInitScript(() => {
      const Native = window.BroadcastChannel;
      window.BroadcastChannel = class extends Native {
        postMessage(message) {
          if (
            message.action === "ready" &&
            window.holdReady &&
            !window.releaseReady
          )
            return;
          if (
            location.pathname.includes("/markdown-studio/") &&
            message.action === "accepted" &&
            !window.droppedAcceptance
          ) {
            window.droppedAcceptance = true;
            return;
          }
          super.postMessage(message);
        }
      };
      window.importCount = 0;
      document.addEventListener("input", (event) => {
        if (event.target.id === "markdown-input") window.importCount++;
      });
    });
    const source = await context.newPage();
    await source.goto(base + "/tools/text-toolkit/");
    await source.waitForFunction(() => window.KenseiWorkspace?.ready);
    const markdown = await send(source, "markdown-studio", "text");
    await markdown.waitForFunction(
      () =>
        document.querySelector("#markdown-input")?.value === "A local result" &&
        window.droppedAcceptance,
    );
    assert.equal(
      await sourceProgress(source)
        .textContent()
        .then((s) => s.includes("Result received")),
      false,
    );
    await sourceProgress(source)
      .getByRole("button", { name: "Retry transfer" })
      .click();
    await includes(sourceProgress(source), "Result received");
    assert.equal(await markdown.evaluate(() => window.importCount), 1);
    assert.doesNotMatch(markdown.url(), /handoff=/);
    await markdown.close();

    const image = await send(source, "image-studio", "files");
    await sourceProgress(source)
      .filter({ hasText: "could not import" })
      .waitFor();
    assert.match(image.url(), /handoff=/);
    assert.equal(await image.locator("#image-pick").isVisible(), true);
    await progress(image)
      .getByRole("button", { name: "Cancel transfer" })
      .click();
    await includes(sourceProgress(source), "Transfer cancelled");
    assert.doesNotMatch(image.url(), /handoff=/);
    await image.close();

    let resume;
    await context.route(
      "**/tool-scripts/advanced-markdown-studio.js",
      (route) =>
        new Promise((resolve) => {
          resume = () => resolve(route.continue());
        }),
    );
    await source.clock.install();
    const cancelled = await send(source, "markdown-studio", "text");
    for (let i = 0; !resume && i < 20; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(resume);
    await source.clock.fastForward(15001);
    await includes(sourceProgress(source), "taking longer than expected");
    await sourceProgress(source)
      .getByRole("button", { name: "Cancel transfer" })
      .click();
    await resume();
    await cancelled.waitForFunction(() => window.KenseiWorkspace?.ready);
    assert.equal(await cancelled.locator("#markdown-input").inputValue(), "");
    assert.equal(await cancelled.evaluate(() => window.importCount), 0);
    await cancelled.close();
    await context.unroute("**/tool-scripts/advanced-markdown-studio.js");

    // Existing content needs an explicit import. Losing the source preserves it.
    await context.addInitScript(() => {
      if (location.pathname.includes("/markdown-studio/"))
        window.holdReady = true;
    });
    const original = await send(source, "markdown-studio", "text");
    await original.locator("#markdown-input").fill("My existing draft");
    await original.evaluate(() => {
      window.releaseReady = true;
    });
    await progress(original)
      .getByRole("button", { name: "Import result" })
      .waitFor();
    await source.close({ runBeforeUnload: true });
    await includes(progress(original), "source tab was closed");
    assert.equal(
      await original.locator("#markdown-input").inputValue(),
      "My existing draft",
    );
    const changedSource = await context.newPage();
    await changedSource.goto(base + "/tools/text-toolkit/");
    await changedSource.waitForFunction(() => KenseiWorkspace.ready);
    const changed = await send(changedSource, "markdown-studio", "text");
    await changed.locator("#markdown-input").fill("Draft for this account");
    await changed.evaluate(() => {
      window.releaseReady = true;
    });
    await progress(changed)
      .getByRole("button", { name: "Import result" })
      .waitFor();
    await changedSource.evaluate(() => {
      Object.defineProperty(KenseiWorkspace, "user", {
        value: { id: "second-account" },
      });
      window.dispatchEvent(new Event("workspace-ready"));
    });
    await includes(
      sourceProgress(changedSource),
      "The account or transfer changed",
    );
    await progress(changed)
      .getByRole("button", { name: "Import result" })
      .waitFor({ state: "hidden" });
    assert.equal(
      await changed.locator("#markdown-input").inputValue(),
      "Draft for this account",
    );
    console.log(
      "PASS handoff: lost confirmation, slow loading, corrupt input, cancellation and source closure",
    );
  } catch (error) {
    await saveBrowserFailure(context, "handoff-recovery");
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
