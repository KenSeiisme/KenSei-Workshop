import { sceneSettings, portSettings } from "./whiteboard-core.js";
import {
  nodePorts,
  nearestPort,
  projectPorts,
  arrowPoints,
  isNode,
} from "./whiteboard-geometry.js";
import { paintPaper } from "./whiteboard-paper.js";

export function createWhiteboardPresentation({
  host,
  shell,
  getEngine,
  getStage,
  changed,
}) {
  let settings = sceneSettings({}),
    api = null,
    unsub = [],
    gesture = null,
    pointer = null,
    frame = null,
    installing = false,
    lastTool = null;
  const paper = document.createElement("canvas"),
    ns = "http://www.w3.org/2000/svg",
    ports = document.createElementNS(ns, "svg");
  paper.className = "whiteboard-paper";
  paper.setAttribute("aria-hidden", "true");
  ports.classList.add("whiteboard-ports");
  ports.setAttribute("aria-hidden", "true");
  shell.prepend(paper);
  shell.append(ports);
  const engine = () => getEngine(),
    stage = () => getStage(),
    state = (native) => ({
      ...native,
      ...settings,
      paper: { ...settings.paper },
    });
  function point(event) {
    return engine().viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      api.getAppState(),
    );
  }
  function viewPoint(p) {
    const n = engine().sceneCoordsToViewportCoords(
        { sceneX: p.x, sceneY: p.y },
        api.getAppState(),
      ),
      r = shell.getBoundingClientRect();
    return {
      x: n.x - r.left - shell.clientLeft,
      y: n.y - r.top - shell.clientTop,
    };
  }
  function schedule() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      paint();
    });
  }
  function paint() {
    if (!api || document.hidden) return;
    const app = api.getAppState(),
      r = host.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2),
      staticCanvas = host.querySelector("canvas.static");
    const width = Math.max(1, Math.round(r.width)),
      height = Math.max(1, Math.round(r.height));
    if (
      paper.width !== Math.round(width * dpr) ||
      paper.height !== Math.round(height * dpr)
    ) {
      paper.width = Math.round(width * dpr);
      paper.height = Math.round(height * dpr);
    }
    paper.style.filter = staticCanvas
      ? getComputedStyle(staticCanvas).filter
      : "none";
    paintPaper(paper.getContext("2d"), width, height, settings, {
      zoom: app.zoom.value,
      scrollX: app.scrollX,
      scrollY: app.scrollY,
      dpr,
    });
    ports.setAttribute(
      "viewBox",
      `0 0 ${shell.clientWidth} ${shell.clientHeight}`,
    );
    ports.replaceChildren();
    if (app.viewModeEnabled || !stage().snap) return;
    const elements = api.getSceneElements(),
      selected = elements.filter(
        (e) => app.selectedElementIds[e.id] && isNode(e),
      );
    let nodes = selected;
    if (app.activeTool.type === "arrow" || gesture) {
      const p = pointer || gesture?.origin;
      if (p)
        nodes = elements
          .filter(
            (e) =>
              isNode(e) &&
              Math.hypot(p.x - e.x - e.width / 2, p.y - e.y - e.height / 2) <
                Math.hypot(e.width, e.height) / 2 + 30 / app.zoom.value,
          )
          .slice(-3);
    }
    const nearest = pointer
      ? nearestPort(nodes, pointer, app.zoom.value)
      : null;
    for (const node of nodes)
      for (const port of nodePorts(node)) {
        const p = viewPoint(port),
          r = shell.getBoundingClientRect();
        const hit = document.elementFromPoint(
          p.x + r.left + shell.clientLeft,
          p.y + r.top + shell.clientTop,
        );
        if (
          hit?.closest(".excalidraw .layer-ui__wrapper,textarea,input,dialog")
        )
          continue;
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", p.x);
        circle.setAttribute("cy", p.y);
        circle.setAttribute(
          "r",
          nearest?.elementId === port.elementId && nearest.index === port.index
            ? 5.5
            : 3.5,
        );
        circle.setAttribute(
          "class",
          "board-port" +
            (nearest?.elementId === port.elementId &&
            nearest.index === port.index
              ? " is-nearest"
              : ""),
        );
        circle.dataset.elementId = node.id;
        circle.dataset.port = String(port.index);
        ports.append(circle);
      }
  }
  function bind(e, end, port) {
    if (!port) return e[end + "Binding"];
    const old = e[end + "Binding"];
    return {
      elementId: port.elementId,
      focus: old?.elementId === port.elementId ? old.focus : 0,
      gap: 1,
      ...(e.elbowed ? { fixedPoint: [port.u, port.v] } : {}),
    };
  }
  function gestureElements(elements) {
    if (!gesture) return elements;
    const arrow = gesture.id
      ? elements.find((e) => e.id === gesture.id)
      : elements.find(
          (e) =>
            e.type === "arrow" && !e.isDeleted && !gesture.before.has(e.id),
        );
    if (!arrow) return elements;
    gesture.id = arrow.id;
    const current = portSettings(arrow) || {
        version: 1,
        start: null,
        end: null,
      },
      next = { ...current },
      patch = {};
    const ends = gesture.endpoint ? [gesture.endpoint] : ["start", "end"];
    for (const end of ends) {
      const p =
        end === "start" && !gesture.endpoint
          ? gesture.start
          : stage().snap && pointer
            ? nearestPort(
                elements,
                pointer,
                api.getAppState().zoom.value,
                gesture.touch,
              )
            : null;
      next[end] = p?.index ?? null;
      if (p) patch[end + "Binding"] = bind(arrow, end, p);
    }
    if (next.start === null && next.end === null && !arrow.customData)
      return elements;
    const candidate = { ...arrow, ...patch, customData: { kenseiPorts: next } };
    let result = elements.map((e) => (e === arrow ? candidate : e));
    for (const end of ends) {
      const target = candidate[end + "Binding"]?.elementId;
      if (next[end] !== null && target)
        result = result.map((e) =>
          e.id === target && !e.boundElements?.some((b) => b.id === arrow.id)
            ? {
                ...e,
                boundElements: [
                  ...(e.boundElements || []).filter((b) => b.id !== arrow.id),
                  { id: arrow.id, type: "arrow" },
                ],
              }
            : e,
        );
    }
    return result;
  }
  function normalize(elements, native, { remote = false } = {}) {
    if (!api) return { elements, state: state(native) };
    if (installing) return null;
    let next = projectPorts(remote ? elements : gestureElements(elements));
    let updated = false;
    next = next.map((e, i) => {
      const prior = elements[i];
      if (e === prior || JSON.stringify(e) === JSON.stringify(prior))
        return prior;
      updated = true;
      if (remote) return e;
      const { id, version, versionNonce, updated: at, ...patch } = e;
      return engine().newElementWith(prior, patch, true);
    });
    if (updated && !remote) {
      installing = true;
      api.updateScene({
        elements: next,
        captureUpdate: engine().CaptureUpdateAction.EVENTUALLY,
      });
      installing = false;
    }
    if (!remote) {
      const tool = native.activeTool,
        creation = [
          "rectangle",
          "diamond",
          "ellipse",
          "arrow",
          "line",
          "freedraw",
          "text",
        ].includes(tool.type);
      if (
        creation &&
        lastTool?.type === tool.type &&
        lastTool.locked !== tool.locked &&
        !gesture
      )
        stage().nativeLock(tool.locked);
      if (
        creation &&
        lastTool?.type !== tool.type &&
        tool.locked !== stage().keep
      ) {
        installing = true;
        api.setActiveTool({ type: tool.type, locked: stage().keep });
        installing = false;
      }
      lastTool = {
        type: tool.type,
        locked: api.getAppState().activeTool.locked,
      };
    }
    schedule();
    return { elements: next, state: state(native) };
  }
  function down(tool, downState, event) {
    if (api.getAppState().viewModeEnabled) return;
    const elements = api.getSceneElements(),
      p = event ? point(event) : downState.origin;
    pointer = p;
    const app = api.getAppState(),
      selected = elements.filter(
        (e) => e.type === "arrow" && app.selectedElementIds[e.id],
      );
    let id = null,
      endpoint = null;
    if (tool.type !== "arrow" && selected.length === 1) {
      const points = arrowPoints(selected[0]),
        distance = 18 / app.zoom.value;
      if (Math.hypot(points[0].x - p.x, points[0].y - p.y) < distance)
        endpoint = "start";
      else if (
        Math.hypot(points.at(-1).x - p.x, points.at(-1).y - p.y) < distance
      )
        endpoint = "end";
      if (endpoint) id = selected[0].id;
    }
    if (tool.type === "arrow" || endpoint)
      gesture = {
        before: new Set(elements.map((e) => e.id)),
        origin: p,
        start: stage().snap
          ? nearestPort(
              elements,
              p,
              app.zoom.value,
              event?.pointerType === "touch",
            )
          : null,
        id,
        endpoint,
        touch: event?.pointerType === "touch",
      };
  }
  function up(tool, downState, event) {
    if (!gesture) return;
    if (event) pointer = point(event);
    const normalized = normalize(
      api.getSceneElementsIncludingDeleted(),
      api.getAppState(),
    );
    gesture = null;
    if (normalized)
      changed(normalized.elements, normalized.state, api.getFiles());
    schedule();
  }
  let portDrag = null;
  // 觸屏選中節點後，可從可見連接點拖出新箭頭；不需要精準點中原生工具列。
  ports.addEventListener("pointerdown", (event) => {
    const node = event.target.closest("[data-port]");
    if (!node || !api || api.getAppState().viewModeEnabled) return;
    const element = api
        .getSceneElements()
        .find((e) => e.id === node.dataset.elementId),
      start = nodePorts(element)[+node.dataset.port];
    portDrag = { start, pointerId: event.pointerId, end: start };
    ports.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  ports.addEventListener("pointermove", (event) => {
    if (!portDrag) return;
    portDrag.end = point(event);
    pointer = portDrag.end;
    schedule();
  });
  ports.addEventListener("pointerup", (event) => {
    if (!portDrag) return;
    const drag = portDrag;
    portDrag = null;
    const app = api.getAppState(),
      elements = api.getSceneElementsIncludingDeleted(),
      end = nearestPort(
        elements,
        point(event),
        app.zoom.value,
        event.pointerType === "touch",
      ),
      p = end || point(event);
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 5) return;
    const elbowed = app.currentItemArrowType === "elbow",
      skeleton = {
        type: "arrow",
        x: drag.start.x,
        y: drag.start.y,
        points: [
          [0, 0],
          [p.x - drag.start.x, p.y - drag.start.y],
        ],
        strokeColor: app.currentItemStrokeColor,
        strokeWidth: app.currentItemStrokeWidth,
        endArrowhead: app.currentItemEndArrowhead,
        elbowed,
        roundness: app.currentItemArrowType === "round" ? { type: 2 } : null,
      };
    let arrow = engine().convertToExcalidrawElements([skeleton])[0];
    arrow = {
      ...arrow,
      elbowed,
      ...(elbowed
        ? { fixedSegments: null, startIsSpecial: false, endIsSpecial: false }
        : {}),
      startBinding: bind(arrow, "start", drag.start),
      endBinding: bind(arrow, "end", end),
      customData: {
        kenseiPorts: {
          version: 1,
          start: drag.start.index,
          end: end?.index ?? null,
        },
      },
    };
    let next = [...elements, arrow];
    for (const target of new Set([drag.start.elementId, end?.elementId]))
      if (target)
        next = next.map((e) =>
          e.id === target
            ? engine().newElementWith(e, {
                boundElements: [
                  ...(e.boundElements || []).filter((b) => b.id !== arrow.id),
                  { id: arrow.id, type: "arrow" },
                ],
              })
            : e,
        );
    next = projectPorts(next);
    api.updateScene({
      elements: next,
      captureUpdate: engine().CaptureUpdateAction.IMMEDIATELY,
    });
    if (app.activeTool.type === "arrow" && stage().keep)
      api.setActiveTool({ type: "arrow", locked: true });
  });
  ports.addEventListener("pointercancel", () => {
    portDrag = null;
    schedule();
  });
  const resizeObserver = new ResizeObserver(() => {
    api?.refresh();
    schedule();
  });
  resizeObserver.observe(host);
  window.addEventListener("visibilitychange", schedule);
  window.addEventListener("pagehide", () => {
    unsub.forEach((fn) => fn());
    resizeObserver.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  });
  return {
    native: (app) => ({ ...app, viewBackgroundColor: "#00000000" }),
    state,
    normalize,
    load(data) {
      api = null;
      lastTool = null;
      settings = sceneSettings(data.appState);
      stage().paper(settings);
      gesture = null;
      pointer = null;
    },
    attach(instance) {
      unsub.forEach((fn) => fn());
      api = instance;
      lastTool = null;
      unsub = [
        api.onPointerDown(down),
        api.onPointerUp(up),
        api.onScrollChange(schedule),
      ];
      api.updateScene({
        appState: {
          activeTool: { ...api.getAppState().activeTool, locked: stage().keep },
        },
        captureUpdate: engine().CaptureUpdateAction.NEVER,
      });
      schedule();
    },
    pointer(payload) {
      pointer = payload.pointer;
      schedule();
    },
    settings(patch) {
      settings = sceneSettings({ ...settings, ...patch });
      stage().paper(settings);
      schedule();
      if (api)
        changed(
          api.getSceneElementsIncludingDeleted(),
          state(api.getAppState()),
          api.getFiles(),
        );
    },
    preferences() {
      if (api) {
        const tool = api.getAppState().activeTool;
        api.setActiveTool({ type: tool.type, locked: stage().keep });
      }
      schedule();
    },
    remote(elements, app) {
      settings = sceneSettings(app);
      stage().paper(settings);
      installing = true;
      api?.updateScene({
        elements: projectPorts(elements),
        appState: { viewBackgroundColor: "#00000000" },
        captureUpdate: engine().CaptureUpdateAction.NEVER,
      });
      installing = false;
      schedule();
    },
    refresh() {
      api?.refresh();
      schedule();
    },
  };
}
