import { api } from "/tool-scripts/common.js";
import { uiFrom, uiMsg } from "../site/ui.js";
import {
  SKINS,
  awardGuest,
  guestSnapshot,
  compareLocal,
  localScoreKey,
  LOBBY_BADGES,
  claimGuestDaily,
} from "./hub-model.js";

export const hubOwner = () => api.user?.id || "guest";
const blank = () => ({
  runs: {},
  pending: {},
  days: {},
  balance: 0,
  owned: ["classic"],
  skin: "classic",
  badges: [],
  scores: {},
  submitted: {},
  notified: {},
  remote: null,
  ackedSegments: {},
  ackedStarts: {},
});
let database;
const channel =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("kensei-game-hub")
    : null;
const notify = (owner) =>
  window.dispatchEvent(new CustomEvent("game-hub-update", { detail: owner }));
if (channel) channel.onmessage = ({ data }) => notify(data);
function db() {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("kensei-game-hub-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("players");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(request.error);
    };
  }));
}
async function transact(owner, update) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(
      "players",
      update ? "readwrite" : "readonly",
    );
    const store = tx.objectStore("players");
    const request = store.get(owner);
    let data, error;
    request.onsuccess = () => {
      data = request.result || blank();
      if (update) {
        try {
          update(data);
          store.put(data, owner);
        } catch (failure) {
          error = failure;
          tx.abort();
        }
      }
    };
    tx.onabort = tx.onerror = () =>
      reject(error || tx.error || Error("Local game storage unavailable."));
    tx.oncomplete = () => {
      if (update) {
        notify(owner);
        channel?.postMessage(owner);
      }
      resolve(data);
    };
  });
}
export async function readHub(owner = hubOwner()) {
  const data = await transact(owner);
  const local = guestSnapshot(data);
  const view =
    owner === "guest"
      ? local
      : data.remote || {
          ...local,
          balance: null,
          today: [],
          badges: [],
          manualClaims: false,
        };
  const waiting = Object.entries(data.pending);
  if (data.remote) {
    const starts = new Set();
    for (const [key, run] of waiting) {
      const stats = (view.stats[run.game] ||= { plays: 0, activeMs: 0 });
      stats.activeMs += Math.max(
        0,
        run.activeMs - (data.ackedSegments?.[key] || 0),
      );
      if (run.started && !data.ackedStarts?.[run.id] && !starts.has(run.id)) {
        starts.add(run.id);
        stats.plays++;
      }
    }
  }
  return { ...view, scores: data.scores, pending: waiting.length };
}
async function rpc(owner, name, args) {
  if (hubOwner() !== owner || !api.client)
    throw Error("Account changed. Try again.");
  const { data, error } = await api.client.rpc(name, args);
  if (error) throw error;
  if (hubOwner() !== owner) throw Error("Account changed. Try again.");
  return data;
}
const jobs = new Map();
function updateSnapshot(data, snapshot) {
  const { newBadges, ...view } = snapshot;
  if (!data.remote || view.generatedAt >= data.remote.generatedAt)
    data.remote = view;
}
function reserveBadges(data, type, ids) {
  const seen = (data.notified ||= {});
  return ids.filter((id) => {
    const key = type + ":" + id;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}
export async function reserveMilestones(owner, ids) {
  let fresh = [];
  if (hubOwner() !== owner) return fresh;
  await transact(owner, (data) => {
    if (hubOwner() === owner) fresh = reserveBadges(data, "verified", ids);
  });
  return hubOwner() === owner ? fresh : [];
}
function notifyLobbyBadges(owner, ids) {
  if (hubOwner() !== owner) return;
  for (const [id, name] of LOBBY_BADGES)
    if (ids.includes(id))
      window.KenseiNotify?.(
        uiMsg("Achievement unlocked · {0}", [uiFrom(name)]),
        { kind: "achievement", key: id },
      );
}
export function syncHub(owner = hubOwner(), refresh = false) {
  if (owner === "guest") return Promise.resolve();
  if (jobs.has(owner)) return jobs.get(owner);
  const job = (async () => {
    const data = await transact(owner);
    const pending = Object.values(data.pending).slice(0, 30);
    if (!pending.length && !refresh) return;
    const snapshot = pending.length
      ? await rpc(owner, "sync_game_activity", {
          expected_user: owner,
          runs: pending,
        })
      : await rpc(owner, "game_hub_snapshot");
    let fresh = [];
    await transact(owner, (current) => {
      updateSnapshot(current, snapshot);
      if (hubOwner() === owner)
        fresh = reserveBadges(current, "lobby", snapshot.newBadges || []);
      for (const run of pending) {
        const key = `${run.id}:${run.segmentId}`;
        const segments = (current.ackedSegments ||= {});
        segments[key] = Math.max(segments[key] || 0, run.activeMs);
        if (run.started) (current.ackedStarts ||= {})[run.id] = true;
        if (JSON.stringify(current.pending[key]) === JSON.stringify(run))
          delete current.pending[key];
      }
    });
    notifyLobbyBadges(owner, fresh);
  })().finally(() => jobs.delete(owner));
  jobs.set(owner, job);
  return job;
}
export async function recordActivity(owner, run) {
  let fresh = [];
  await transact(owner, (data) => {
    const previous = data.runs[run.id];
    const segments = previous?.segments || {};
    const total =
      (previous?.activeMs || 0) +
      Math.max(0, run.activeMs - (segments[run.segmentId] || 0));
    segments[run.segmentId] = Math.max(
      segments[run.segmentId] || 0,
      run.activeMs,
    );
    const stored = {
      game: run.game,
      started: previous?.started || run.started,
      finished: previous?.finished || run.finished,
      activeMs: Math.min(86400000, total),
      segments,
    };
    data.runs[run.id] = stored;
    if (owner === "guest") {
      if (stored.finished && !previous?.finished && total > 0) {
        const prior = data.badges.length;
        awardGuest(data, run);
        if (hubOwner() === owner)
          fresh = reserveBadges(data, "lobby", data.badges.slice(prior));
      }
    } else {
      const key = `${run.id}:${run.segmentId}`;
      const waiting = data.pending[key];
      data.pending[key] = {
        ...run,
        finished: !!waiting?.finished || run.finished,
        activeMs: segments[run.segmentId],
        score: waiting?.finished ? waiting.score : run.score,
      };
    }
  });
  if (owner === "guest") notifyLobbyBadges(owner, fresh);
  else syncHub(owner).catch(() => {});
}
export async function changeSkin(owner, skin, purchase = false) {
  if (!Object.hasOwn(SKINS, skin)) throw Error("Unknown skin");
  if (owner !== "guest") {
    await jobs.get(owner);
    const snapshot = await rpc(
      owner,
      purchase ? "buy_game_skin" : "equip_game_skin",
      {
        expected_user: owner,
        skin_id: skin,
      },
    );
    await transact(owner, (data) => updateSnapshot(data, snapshot));
    return;
  }
  await transact(owner, (data) => {
    const owned = data.owned.includes(skin);
    if (purchase) {
      if (owned) return;
      if (data.balance < SKINS[skin].price) throw Error("Not enough coins");
      data.balance -= SKINS[skin].price;
      data.owned.push(skin);
    } else if (owned) data.skin = skin;
    else throw Error("Skin is locked");
  });
}
export async function claimDailyReward(owner, day, task) {
  if (owner !== hubOwner()) throw Error("Account changed. Try again.");
  if (owner === "guest") {
    await transact(owner, (data) => {
      if (owner !== hubOwner()) throw Error("Account changed. Try again.");
      claimGuestDaily(data, day, task);
    });
    return;
  }
  const snapshot = await rpc(owner, "claim_game_hub_reward", {
    expected_user: owner,
    task_day: day,
    task_id: task,
  });
  await transact(owner, (data) => updateSnapshot(data, snapshot));
}
export async function saveLocalScore(owner, run, nickname, score) {
  const name = nickname.trim().normalize("NFC");
  if (
    Array.from(name).length < 2 ||
    Array.from(name).length > 24 ||
    /[\u0000-\u001f\u007f]/u.test(name)
  )
    throw Error("Enter a nickname with 2–24 characters.");
  return transact(owner, (data) => {
    if (data.submitted[run.id]) return;
    const key = localScoreKey(run.game, run.mode, run.version ?? 3),
      rows = (data.scores[key] ||= {}),
      player = name.toLocaleLowerCase("en"),
      previous = Object.hasOwn(rows, player) ? rows[player] : null,
      row = { ...score, nickname: name, date: new Date().toISOString() };
    if (score.wins !== undefined) row.wins += previous?.wins || 0;
    if (!previous || compareLocal(run.game, run.mode, row, previous) < 0)
      Object.defineProperty(rows, player, {
        value: row,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    data.submitted[run.id] = true;
  });
}
