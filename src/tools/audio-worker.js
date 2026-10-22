// 编码在可终止 worker 中进行；原文件与编辑状态留在页面。
onmessage = async ({ data }) => {
  try {
    const { channels, format, bitrate, gain } = data,
      n = channels?.length,
      frames = channels?.[0]?.length;
    if (
      ![1, 2].includes(n) ||
      !frames ||
      frames > 44100 * 300 ||
      channels.some((c) => c.length !== frames) ||
      !Number.isFinite(gain) ||
      gain < 0 ||
      gain > 2
    )
      throw Error("Invalid audio selection.");
    let clipped = false;
    const sample = (channel, index) => {
      const value = channels[channel][index] * gain;
      if (Math.abs(value) > 1) clipped = true;
      return Math.max(-1, Math.min(1, value));
    };
    let blob;
    if (format === "wav") {
      const buffer = new ArrayBuffer(44 + frames * n * 2),
        view = new DataView(buffer);
      const text = (p, s) =>
        [...s].forEach((c, i) => view.setUint8(p + i, c.charCodeAt(0)));
      text(0, "RIFF");
      view.setUint32(4, 36 + frames * n * 2, true);
      text(8, "WAVE");
      text(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, n, true);
      view.setUint32(24, 44100, true);
      view.setUint32(28, 44100 * n * 2, true);
      view.setUint16(32, n * 2, true);
      view.setUint16(34, 16, true);
      text(36, "data");
      view.setUint32(40, frames * n * 2, true);
      for (let start = 0; start < frames; start += 32768) {
        const end = Math.min(frames, start + 32768);
        for (let i = start; i < end; i++)
          for (let c = 0; c < n; c++) {
            const value = sample(c, i);
            view.setInt16(
              44 + (i * n + c) * 2,
              Math.round(value * (value < 0 ? 32768 : 32767)),
              true,
            );
          }
        postMessage({ type: "progress", value: (end / frames) * 100 });
        await new Promise((r) => setTimeout(r, 0));
      }
      blob = new Blob([buffer], { type: "audio/wav" });
    } else {
      if (![128, 192, 320].includes(bitrate))
        throw Error("Choose a supported MP3 bitrate.");
      const {
        Output,
        BufferTarget,
        Mp3OutputFormat,
        AudioSampleSource,
        AudioSample,
        registerMp3Encoder,
      } = await import("/vendor/audio-codecs.js");
      registerMp3Encoder();
      const target = new BufferTarget(),
        output = new Output({ format: new Mp3OutputFormat(), target }),
        source = new AudioSampleSource({
          codec: "mp3",
          bitrate: bitrate * 1000,
        });
      output.addAudioTrack(source);
      await output.start();
      for (let start = 0; start < frames; start += 11025) {
        const count = Math.min(11025, frames - start),
          interleaved = new Float32Array(count * n);
        for (let i = 0; i < count; i++)
          for (let c = 0; c < n; c++)
            interleaved[i * n + c] = sample(c, start + i);
        const audio = new AudioSample({
          format: "f32",
          data: interleaved,
          numberOfChannels: n,
          sampleRate: 44100,
          timestamp: start / 44100,
        });
        try {
          await source.add(audio);
        } finally {
          audio.close();
        }
        postMessage({
          type: "progress",
          value: ((start + count) / frames) * 100,
        });
      }
      await source.close();
      await output.finalize();
      blob = new Blob([target.buffer], { type: "audio/mpeg" });
    }
    postMessage({ type: "complete", blob, clipped });
  } catch (e) {
    postMessage({
      type: "error",
      message:
        "Audio export failed. Your edit is still here; retry or choose WAV. " +
        (e.message || ""),
    });
  }
};
