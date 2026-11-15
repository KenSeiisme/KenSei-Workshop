import {
  assertVectorScene,
  sceneSettings,
  validateWhiteboard,
} from "./whiteboard-core.js";
import { recordSignature } from "./record-store.js";

export function elementContent(element) {
  if (element.isDeleted)
    return JSON.stringify([element.id, element.type, true]);
  const { version, versionNonce, updated, ...content } =
    compactDeleted(element);
  return recordSignature(content);
}
export const elementStamp = (e) =>
  `${e.version}:${e.versionNonce}:${e.index}:${e.isDeleted}`;

export function mergeSharedElements(existing, incoming) {
  const merged = new Map(existing.map((element) => [element.id, element]));
  for (const element of incoming) {
    const previous = merged.get(element.id);
    if (
      !previous ||
      element.version > previous.version ||
      (element.version === previous.version &&
        element.versionNonce < previous.versionNonce)
    )
      merged.set(element.id, element);
  }
  return [...merged.values()].sort((a, b) => {
    if (a.index !== b.index) return a.index < b.index ? -1 : 1;
    return a.id < b.id ? -1 : a.id === b.id ? 0 : 1;
  });
}
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
