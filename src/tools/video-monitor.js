import { audioContextType } from "./audio-context.js";
import { frameRate } from "./video-timeline.js";

export function createVideoMonitor(videos, report, target = globalThis) {
  let context,
    master,
    muted = false;
  let disabled = false;
  const lanes = Array.from({ length: 6 }, () => new Audio()).map((media) => ({
    media,
    clip: null,
    requested: false,
  }));
  const channels = new Map();
  function unlock() {
    if (disabled) return;
    try {
      if (!context) {
        const Context = audioContextType(false, target);
        context = new Context();
        master = context.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(context.destination);
        for (const media of [...videos, ...lanes.map((lane) => lane.media)]) {
          const node = context.createMediaElementSource(media);
          const gain = context.createGain();
          gain.gain.value = 0;
          node.connect(gain).connect(master);
          channels.set(media, gain.gain);
          media.muted = false;
        }
      }
      if (context.state !== "running") context.resume().catch(report);
    } catch (error) {
      disabled = true;
      for (const video of videos) video.muted = muted;
      report(error);
    }
  }
  function setGain(media, value) {
    const param = channels.get(media);
    if (param && param.value !== value) param.value = value;
  }
  function silence() {
    for (const video of videos) setGain(video, 0);
    for (const lane of lanes) {
      lane.media.pause();
      lane.requested = false;
      setGain(lane.media, 0);
    }
  }
  function setMuted(value) {
    muted = value;
    if (master) master.gain.value = value ? 0 : 1;
    else for (const video of videos) video.muted = value;
  }
  function update(mix, sources, frame, fronts) {
    if (disabled || !context) return;
    const find = (lane) =>
      lane.find((clip) => clip.gain && clip.at <= frame && frame < clip.stop);
    const laneFor = (id) => mix.lanes[mix.ids.indexOf(id)] || [];
    for (const video of videos) setGain(video, 0);
    for (const [id, video] of fronts) {
      const clip = find(laneFor(id));
      setGain(video, (clip?.gain || 0) * mix.scale);
    }
    for (const [i, lane] of lanes.entries()) {
      const clip = find(laneFor(i + 1)),
        media = lane.media;
      if (!clip) {
        media.pause();
        lane.requested = false;
        lane.clip = null;
        setGain(media, 0);
        continue;
      }
      const asset = sources[clip.source];
      const time = clip.start / 1000 + (frame - clip.at) / frameRate;
      if (lane.url !== asset.url) {
        lane.url = media.src = asset.url;
        lane.requested = false;
        media.load();
        media.onerror = () =>
          report(
            Error("Could not preview audio from {0}.", {
              cause: asset.file.name,
            }),
          );
      }
      if (!media.readyState) continue;
      const offset = media.seekable.length ? media.seekable.start(0) : 0;
      const position = Math.max(
        offset,
        Math.min(media.duration - 0.001, offset + time),
      );
      if (
        lane.clip !== clip ||
        (!media.seeking && Math.abs(media.currentTime - position) > 0.08)
      ) {
        media.currentTime = position;
        lane.clip = clip;
      }
      setGain(media, media.seeking ? 0 : clip.gain * mix.scale);
      if (media.paused && !media.seeking && !lane.requested) {
        lane.requested = true;
        media.play().catch((error) => {
          lane.requested = false;
          if (error.name !== "AbortError") report(error);
        });
      }
    }
  }
  function release(url) {
    for (const lane of lanes) {
      if (url && lane.url !== url) continue;
      lane.media.pause();
      lane.media.removeAttribute("src");
      lane.media.load();
      lane.url = null;
      lane.clip = null;
      lane.requested = false;
    }
    if (!url) context?.close().catch(() => {});
  }
  return { unlock, update, silence, setMuted, release };
}
