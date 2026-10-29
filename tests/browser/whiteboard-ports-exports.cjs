const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";
(async () => {
  const b = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    p = await b.newPage({ viewport: { width: 1440, height: 900 } }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  try {
    await p.goto(base + "/tools/whiteboard/");
    await p.waitForSelector('[data-ready="true"]');
    await p.click("#board-entry-new");
    await p.waitForFunction(
      () =>
        window.KenseiAdvancedContexts?.whiteboard?.drawing &&
        !window.KenseiAdvancedContexts.whiteboard.drawing.getAppState()
          .viewModeEnabled,
    );
    await p.evaluate(() => {
      const c = window.KenseiAdvancedContexts.whiteboard,
        E = c.engine,
        n = E.convertToExcalidrawElements([
          {
            id: "left",
            type: "rectangle",
            x: 350,
            y: 180,
            width: 120,
            height: 100,
            backgroundColor: "#beace0",
            fillStyle: "solid",
          },
          {
            id: "right",
            type: "ellipse",
            x: 720,
            y: 280,
            width: 140,
            height: 100,
          },
        ]);
      const arrow = E.convertToExcalidrawElements([
        {
          id: "connector",
          type: "arrow",
          x: 470,
          y: 230,
          points: [
            [0, 0],
            [250, 100],
          ],
          startBinding: { elementId: "left", focus: 0, gap: 1 },
          endBinding: { elementId: "right", focus: 0, gap: 1 },
        },
      ])[0];
      n[0].id = "left";
      n[1].id = "right";
      arrow.id = "connector";
      arrow.startBinding = { elementId: "left", focus: 0, gap: 1 };
      arrow.endBinding = { elementId: "right", focus: 0, gap: 1 };
      arrow.customData = { kenseiPorts: { version: 1, start: 3, end: 9 } };
      n.forEach((e) => (e.boundElements = [{ id: arrow.id, type: "arrow" }]));
      c.drawing.updateScene({
        elements: [...n, arrow],
        captureUpdate: E.CaptureUpdateAction.IMMEDIATELY,
      });
      c.drawing.setActiveTool({ type: "selection" });
    });
    await p.waitForTimeout(200);
    async function coordinates(x, y) {
      return p.evaluate(
        ([x, y]) => {
          const c = window.KenseiAdvancedContexts.whiteboard;
          return c.engine.sceneCoordsToViewportCoords(
            { sceneX: x, sceneY: y },
            c.drawing.getAppState(),
          );
        },
        [x, y],
      );
    }
    const a = await coordinates(400, 220),
      z = await coordinates(480, 280);
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(z.x, z.y, { steps: 15 });
    await p.mouse.up();
    await p.waitForTimeout(200);
    let current = await p.evaluate(() =>
      window.KenseiAdvancedContexts.whiteboard.currentData(),
    );
    assert.equal(current.elements.find((e) => e.id === "left").x, 430);
    await p.keyboard.press("Control+z");
    await p.waitForTimeout(150);
    current = await p.evaluate(() =>
      window.KenseiAdvancedContexts.whiteboard.currentData(),
    );
    assert.equal(
      current.elements.find((e) => e.id === "left").x,
      350,
      "one undo must restore node drag",
    );
    assert.equal(
      current.elements.find((e) => e.id === "connector").x,
      470,
      "one undo must restore fixed endpoint",
    );
    await p.keyboard.press("Control+Shift+z");
    await p.waitForTimeout(150);
    assert.equal(
      await p.evaluate(
        () =>
          window.KenseiAdvancedContexts.whiteboard
            .currentData()
            .elements.find((e) => e.id === "left").x,
      ),
      430,
    );
    await p.keyboard.press("Delete");
    await p.waitForTimeout(100);
    current = await p.evaluate(() =>
      window.KenseiAdvancedContexts.whiteboard.currentData(),
    );
    assert.equal(
      current.elements.find((e) => e.id === "connector").startBinding,
      null,
    );
    await p.keyboard.press("Control+z");
    await p.waitForTimeout(150);
    current = await p.evaluate(() =>
      window.KenseiAdvancedContexts.whiteboard.currentData(),
    );
    assert.equal(
      current.elements.find((e) => e.id === "connector").customData.kenseiPorts
        .start,
      3,
      "undo deletion restores binding",
    );
    // Duplicate both nodes and the wire through native keyboard handling; references must remap.
    await p.evaluate(() => {
      const c = window.KenseiAdvancedContexts.whiteboard;
      c.drawing.updateScene({
        appState: {
          selectedElementIds: Object.fromEntries(
            c.drawing.getSceneElements().map((e) => [e.id, true]),
          ),
        },
      });
    });
    await p.keyboard.press("Control+d");
    await p.waitForTimeout(150);
    current = await p.evaluate(() =>
      window.KenseiAdvancedContexts.whiteboard.currentData(),
    );
    const wires = current.elements.filter(
      (e) => e.type === "arrow" && !e.isDeleted,
    );
    assert.equal(wires.length, 2);
    const copy = wires.find((e) => e.id !== "connector");
    assert.notEqual(copy.startBinding.elementId, "left");
    assert.notEqual(copy.endBinding.elementId, "right");
    assert.equal(copy.customData.kenseiPorts.start, 3);
    // Pure paper pixels are compared between independent Canvas and SVG browser renderers.
    const samples = await p.evaluate(async () => {
      const c = window.KenseiAdvancedContexts.whiteboard,
        { exportArtwork } = await import("/tool-scripts/whiteboard-paper.js");
      const elements = c.engine.convertToExcalidrawElements([
        {
          type: "rectangle",
          x: -37,
          y: -23,
          width: 120,
          height: 100,
          strokeWidth: 1,
          roughness: 0,
        },
      ]);
      const output = [];
      for (const type of ["plain", "ruled", "grid", "dots", "graph"]) {
        const data = {
          elements,
          appState: {
            viewBackgroundColor: "#fff",
            paper: { version: 1, type, spacing: 20 },
          },
        };
        const png = await exportArtwork(c.engine, data, { format: "png" }),
          svg = await exportArtwork(c.engine, data, { format: "svg" }),
          url = URL.createObjectURL(
            new Blob([svg.outerHTML], { type: "image/svg+xml" }),
          ),
          img = new Image();
        img.src = url;
        await img.decode();
        const v = document.createElement("canvas");
        v.width = png.width;
        v.height = png.height;
        v.getContext("2d").drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const x = png.getContext("2d").getImageData(30, 30, 95, 75).data,
          y = v.getContext("2d").getImageData(30, 30, 95, 75).data;
        let total = 0,
          max = 0;
        for (let i = 0; i < x.length; i += 4)
          for (let k = 0; k < 3; k++) {
            const d = Math.abs(x[i + k] - y[i + k]);
            total += d;
            max = Math.max(max, d);
          }
        const peaks = (canvas) => {
          const row = canvas
            .getContext("2d")
            .getImageData(
              type === "ruled" ? 50 : 30,
              type === "ruled" ? 30 : type === "dots" ? 43 : 50,
              type === "ruled" ? 1 : 95,
              type === "ruled" ? 95 : 1,
            ).data;
          const a = [];
          for (let i = 0; i < 95; i++) if (row[i * 4] > 25) a.push(i + 30);
          return a;
        };
        output.push({
          type,
          error: total / ((x.length / 4) * 3),
          max,
          width: png.width,
          height: png.height,
          pngPeaks: peaks(png),
          svgPeaks: peaks(v),
        });
      }
      return output;
    });
    fs.writeFileSync(
      "_qa/whiteboard-canvas/export-pixels.json",
      JSON.stringify(samples, null, 2),
    );
    for (const s of samples) {
      assert(s.error < 8, `PNG/SVG color disagreement ${s.type}: ${s.error}`);
      if (s.type !== "plain") {
        assert(s.pngPeaks.length && s.svgPeaks.length);
        for (const x of s.pngPeaks)
          assert(
            s.svgPeaks.some((y) => Math.abs(x - y) <= 1),
            `SVG pattern phase differs at ${s.type}/${x}`,
          );
      }
    }
    if (
      await p.evaluate(
        () => "filter" in document.createElement("canvas").getContext("2d"),
      )
    )
      assert(
        await p.evaluate(async () => {
          const original = CanvasRenderingContext2D.prototype.getImageData;
          CanvasRenderingContext2D.prototype.getImageData = () => {
            throw Error("canvas readback restricted");
          };
          try {
            const canvas =
              await window.KenseiAdvancedContexts.whiteboard.artwork({
                format: "png",
              });
            const blob = await new Promise((r) =>
              canvas.toBlob(r, "image/png"),
            );
            return blob?.size > 100;
          } finally {
            CanvasRenderingContext2D.prototype.getImageData = original;
          }
        }),
        "native-filter PNG export must not require canvas pixel readback",
      );
    // Paper preference does not enter element history, and lock-off restores native single-use drawing.
    await p.click("#board-menu-open");
    await p.uncheck("#board-keep-tool");
    await p.locator("#board-menu").evaluate((n) => n.close());
    await p.locator('label:has([data-testid="toolbar-rectangle"])').click();
    const p1 = await coordinates(980, 240),
      p2 = await coordinates(1080, 320);
    await p.mouse.move(p1.x, p1.y);
    await p.mouse.down();
    await p.mouse.move(p2.x, p2.y, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(150);
    assert.equal(
      await p.evaluate(
        () =>
          window.KenseiAdvancedContexts.whiteboard.drawing.getAppState()
            .activeTool.type,
      ),
      "selection",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS real node drag, single-step Undo/Redo, deletion/undo binding, native duplication remaps port targets, PNG/SVG pixel comparison for all five patterns at negative coordinates, native lock-off",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
