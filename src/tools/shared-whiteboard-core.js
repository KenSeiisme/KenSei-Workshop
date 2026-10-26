import {
  assertVectorScene,
  sceneSettings,
  validateWhiteboard,
} from "./whiteboard-core.js";
export const elementStamp = (e) =>
  `${e.version}:${e.versionNonce}:${e.index}:${e.isDeleted}`;
export function sharedChanges(elements) {
  assertVectorScene(elements);
  for (const e of elements) {
    if (
      !Number.isInteger(e.version) ||
      e.version < 1 ||
      !Number.isInteger(e.versionNonce) ||
      e.versionNonce < 0 ||
      typeof e.index !== "string"
    )
      throw Error("Invalid element version or layer index.");
  }
  return elements;
}
export function sharedData(name, elements, appState) {
  return {
    version: 1,
    name,
    elements: structuredClone(elements),
    appState: sceneSettings(appState),
  };
}
export const checkedSharedData = (name, elements, appState) =>
  validateWhiteboard(
    sharedData(name, sharedChanges(elements).map(compactDeleted), appState),
  );

export function compactDeleted(e) {
  if (!e.isDeleted) return e;
  return Object.fromEntries(
    [
      "id",
      "type",
      "version",
      "versionNonce",
      "index",
      "isDeleted",
      "x",
      "y",
      "width",
      "height",
      "angle",
    ].map((k) => [k, e[k]]),
  );
}
