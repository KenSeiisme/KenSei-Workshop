const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";
const out = "_qa/whiteboard-canvas";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    acceptDownloads: true,
  });
  await context.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  const p = await context.newPage(),
    errors = [],
    writes = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  context.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) writes.push(r.url());
  });
  const state = () =>
    p.evaluate(() => {
      const c = window.KenseiAdvancedContexts.whiteboard;
      return {
        scene: c.currentData(),
        native: {
          activeTool: c.drawing.getAppState().activeTool,
          selected: c.drawing.getAppState().selectedElementIds,
        },
      };
    });
  const drag = async (a, b) => {
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(b.x, b.y, { steps: 12 });
    await p.mouse.up();
    await p.waitForTimeout(180);
  };
  const point = async (x, y) =>
    p
      .evaluate(
        ([x, y]) => {
          const c = window.KenseiAdvancedContexts.whiteboard;
          return c.engine.sceneCoordsToViewportCoords(
            { sceneX: x, sceneY: y },
            c.drawing.getAppState(),
          );
        },
        [x, y],
      )
      .then((v) => ({ x: v.x, y: v.y }));
  async function close(id) {
    await p.locator(id).evaluate((n) => n.close());
  }
  async function download(selector) {
    const wait = p.waitForEvent("download");
    await p.click(selector);
    const d = await wait;
    return fs.readFileSync(await d.path());
  }
  try {
    await p.goto(base + "/tools/whiteboard/");
    await p.waitForSelector('[data-ready="true"]');
    await p.waitForSelector("#board-canvas canvas");
    const empty = await p.evaluate(async () => {
      const m = await import("/tool-scripts/whiteboard.js");
      return m.store.rows().length;
    });
    assert.equal(empty, 0, "preview must not create a record");
    assert(await p.locator("#board-entry-new").isVisible());
    assert((await p.locator("#board-canvas-shell").boundingBox()).y <= 180);
    await p.screenshot({ path: out + "/entry.png" });
    await p.click("#board-entry-new");
    await p.waitForFunction(
      () =>
        document.body.classList.contains("whiteboard-focus") &&
        window.KenseiAdvancedContexts.whiteboard.drawing &&
        !window.KenseiAdvancedContexts.whiteboard.drawing.getAppState()
          .viewModeEnabled,
    );
    assert(
      (await p.locator("#board-canvas-shell").boundingBox()).y < 100,
      "focus must remove header space",
    );
    await p.locator('label:has([data-testid="toolbar-rectangle"])').click();
    await drag(await point(300, 180), await point(430, 280));
    await drag(await point(650, 300), await point(830, 400));
    let s = await state();
    fs.writeFileSync(out + "/drawing-state.json", JSON.stringify(s, null, 2));
    await p.screenshot({ path: out + "/drawing.png" });
    assert.equal(
      s.scene.elements.filter((e) => e.type === "rectangle" && !e.isDeleted)
        .length,
      2,
    );
    assert.equal(s.native.activeTool.type, "rectangle");
    assert.equal(s.native.activeTool.locked, true);
    await p.keyboard.press("v");
    assert.equal((await state()).native.activeTool.type, "selection");
    await p.keyboard.press("Escape");
    assert.equal((await state()).native.activeTool.type, "selection");
    const nodes = s.scene.elements.filter((e) => e.type === "rectangle");
    // A visible port starts a real arrow drag; exercise sharp, round and elbow modes.
    for (const type of ["sharp", "round", "elbow"]) {
      await p.evaluate((type) => {
        const c = window.KenseiAdvancedContexts.whiteboard;
        c.drawing.updateScene({
          appState: {
            currentItemArrowType: type,
            selectedElementIds: {
              [c.drawing.getSceneElements().find((e) => e.type === "rectangle")
                .id]: true,
            },
          },
        });
        c.drawing.setActiveTool({ type: "selection" });
      }, type);
      await p.waitForFunction(
        () => document.querySelectorAll(".board-port").length === 12,
      );
      await p.screenshot({ path: out + "/ports-" + type + ".png" });
      const a = await p
          .locator('.board-port[data-port="3"]')
          .evaluate((n) => n.getBoundingClientRect().toJSON()),
        b = await point(650, 350);
      await drag({ x: a.x + a.width / 2, y: a.y + a.height / 2 }, b);
      s = await state();
      const arrow = s.scene.elements
        .filter((e) => e.type === "arrow" && !e.isDeleted)
        .at(-1);
      assert(arrow, `missing ${type} arrow`);
      assert.equal(arrow.customData.kenseiPorts.start, 3);
      assert.equal(arrow.customData.kenseiPorts.end, 9);
      assert.equal(arrow.elbowed, type === "elbow");
      if (type === "round") assert(arrow.roundness);
    }
    // A node move/resize/rotation updates both ends through existing binding targets.
    await p.evaluate(() => {
      const c = window.KenseiAdvancedContexts.whiteboard,
        e = c.drawing.getSceneElements().find((e) => e.type === "rectangle");
      c.drawing.updateScene({
        elements: c.drawing.getSceneElementsIncludingDeleted().map((n) =>
          n.id === e.id
            ? c.engine.newElementWith(n, {
                x: 260,
                y: 160,
                width: 200,
                height: 120,
                angle: Math.PI / 6,
              })
            : n,
        ),
        captureUpdate: c.engine.CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await p.waitForTimeout(250);
    assert(
      await p.evaluate(async () => {
        const { nodePorts, arrowPoints } =
            await import("/tool-scripts/whiteboard-geometry.js"),
          c = window.KenseiAdvancedContexts.whiteboard,
          n = c.currentData().elements.find((e) => e.type === "rectangle"),
          port = nodePorts(n)[3];
        return c
          .currentData()
          .elements.filter((e) => e.type === "arrow" && !e.isDeleted)
          .every(
            (e) =>
              Math.hypot(
                arrowPoints(e)[0].x - port.x,
                arrowPoints(e)[0].y - port.y,
              ) < 0.01,
          );
      }),
    );
    await p.waitForTimeout(650);
    const stable = JSON.stringify((await state()).scene);
    await p.waitForTimeout(650);
    assert.equal(
      JSON.stringify((await state()).scene),
      stable,
      "idle adapter must not create version loops",
    );
    await p.evaluate(() => {
      window.__whiteboardCanvas = document.querySelector(
        "#board-canvas canvas",
      );
      window.__whiteboardAPI = window.KenseiAdvancedContexts.whiteboard.drawing;
    });
    await p.click("#board-focus");
    await p.click("#board-focus");
    await p.click("#board-fullscreen");
    await p.waitForTimeout(200);
    const fullscreen = await p.evaluate(
      () => document.fullscreenElement?.id === "whiteboard-stage",
    );
    if (!fullscreen)
      assert(
        (await p.locator("#tool-status").innerText()).includes(
          "Fullscreen is unavailable",
        ),
      );
    await p.click("#board-background");
    assert(
      await p.evaluate(() =>
        document
          .querySelector("#whiteboard-stage")
          .contains(document.querySelector("#board-background-panel")),
      ),
    );
    await p.selectOption("#board-paper-type", "graph");
    await p.selectOption("#board-paper-spacing", "20");
    await close("#board-background-panel");
    if (fullscreen) await p.click("#board-fullscreen");
    assert(
      await p.evaluate(() =>
        document.body.classList.contains("whiteboard-focus"),
      ),
    );
    await p.evaluate(() => globalThis.KenseiI18n.setLocale("zh-Hant"));
    await p.waitForTimeout(200);
    assert(
      await p.evaluate(
        () =>
          window.__whiteboardAPI ===
            window.KenseiAdvancedContexts.whiteboard.drawing &&
          window.__whiteboardCanvas ===
            document.querySelector("#board-canvas canvas"),
      ),
      "layout/locale must preserve editor",
    );
    await p.evaluate(() => globalThis.KenseiI18n.setLocale("en"));
    await p.click("#board-menu-open");
    const json = JSON.parse(await download("#board-json"));
    assert.equal(json.appState.paper.type, "graph");
    assert(json.elements.some((e) => e.customData?.kenseiPorts));
    const svg = (await download("#board-svg")).toString();
    assert(svg.includes('data-kensei-paper="graph"'));
    assert(svg.includes("你好") === false);
    const png = await download("#board-png");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    fs.writeFileSync(out + "/graph.png", png);
    fs.writeFileSync(out + "/graph.svg", svg);
    await p.uncheck("#board-include-paper");
    assert(
      !(await download("#board-svg")).toString().includes("data-kensei-paper="),
    );
    fs.writeFileSync(out + "/plain.png", await download("#board-png"));
    await p.check("#board-include-paper");
    await p.evaluate(() => {
      const c = window.KenseiAdvancedContexts.whiteboard,
        id = c.drawing
          .getSceneElements()
          .find((e) => e.type === "rectangle").id;
      c.drawing.updateScene({
        appState: { selectedElementIds: { [id]: true } },
      });
    });
    await p.check("#board-export-selection");
    const selectedPng = await download("#board-png"),
      selectedSvg = (await download("#board-svg")).toString();
    assert(selectedPng.readUInt32BE(16) < png.readUInt32BE(16));
    assert(selectedSvg.includes('data-kensei-paper="graph"'));
    await p.getByRole("button", { name: "Prepare PNG", exact: true }).click();
    const prepared = await download(
      "#board-more-content .advanced-panel .button:has-text('Download PNG')",
    );
    assert(
      prepared.equals(selectedPng),
      "selection and Send to must use the same rendered PNG",
    );
    const receiving = p.waitForEvent("popup");
    await p
      .locator(".handoff-controls button")
      .filter({ hasText: "Image Studio" })
      .click();
    const target = await receiving;
    await target.waitForFunction(
      () =>
        document.querySelector("#image-preview")?.naturalWidth > 0 &&
        !location.hash.includes("handoff="),
    );
    assert.equal(
      await target.evaluate(
        () => document.querySelector("#image-preview").naturalWidth,
      ),
      prepared.readUInt32BE(16),
    );
    assert.equal(
      await target.evaluate(
        () => document.querySelector("#image-preview").naturalHeight,
      ),
      prepared.readUInt32BE(20),
    );
    assert(
      await target.locator("#image-download").isHidden(),
      "receiving a file must not auto-process it",
    );
    await target.close();
    await p.bringToFront();
    await p.uncheck("#board-export-selection");
    await close("#board-menu");
    const n = json.elements.length;
    for (const type of ["plain", "ruled", "grid", "dots", "graph"]) {
      await p.click("#board-background");
      await p.selectOption("#board-paper-type", type);
      for (const spacing of ["10", "20", "40"]) {
        await p.selectOption("#board-paper-spacing", spacing);
        assert.equal((await state()).scene.elements.length, n);
        assert.equal((await state()).scene.appState.paper.spacing, +spacing);
      }
      await close("#board-background-panel");
    }
    await p.waitForTimeout(800);
    const url = p.url();
    assert(url.includes("?id="));
    await p.reload();
    await p.waitForSelector('[data-ready="true"]');
    await p.waitForFunction(
      () =>
        document.body.classList.contains("whiteboard-focus") &&
        window.KenseiAdvancedContexts?.whiteboard?.drawing,
    );
    assert.equal(
      (await state()).scene.elements.filter((e) => !e.isDeleted).length,
      n,
    );
    await p.goto(base + "/tools/whiteboard/");
    await p.waitForSelector('[data-ready="true"]');
    assert(await p.locator("#board-continue").isVisible());
    assert(await p.locator("#board-entry-new").isVisible());
    assert(
      !(await p.evaluate(() =>
        document.body.classList.contains("whiteboard-focus"),
      )),
    );
    for (const [width, height] of [
      [320, 640],
      [360, 800],
      [768, 1024],
      [1366, 768],
      [1440, 900],
      [800, 360],
    ]) {
      await p.setViewportSize({ width, height });
      await p.waitForTimeout(200);
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "overflow " + width,
      );
      const box = await p.locator("#board-canvas-shell").boundingBox();
      assert(
        box.y <= (width < 768 ? 160 : 180),
        `canvas top ${box.y} at ${width}`,
      );
      assert(await p.locator("#board-entry-new").isVisible());
      await p.screenshot({ path: out + `/entry-${width}.png` });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log(
      "PASS canvas entry, repeated drawing, native lock/selection, 12-port sharp/round/elbow bindings and transforms, no idle loops, focus/fullscreen/locale identity, real PNG/SVG/JSON exports, all paper presets, reload/Continue and six layouts; no file uploads",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
