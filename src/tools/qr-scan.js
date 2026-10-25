import { $, library, image, copy } from "./common.js";
import { stopTracks, mediaError } from "./media-capture.js";
import { uiText } from "../site/ui.js";

if ($("#qr-scan-panel")) {
  let stream = null,
    frame = null,
    generation = 0,
    busy = false,
    lastFrame = 0;
  const video = $("#qr-camera-video"),
    canvas = document.createElement("canvas"),
    context = canvas.getContext("2d", { willReadFrequently: true });
  const state = (text, error = false) => {
    uiText($("#qr-scan-status"), text);
    $("#qr-scan-status").classList.toggle("error-text", error);
  };
  function controls() {
    $("#qr-camera-start").disabled =
      busy || Boolean(stream) || !navigator.mediaDevices?.getUserMedia;
    $("#qr-camera-stop").disabled = !stream && !busy;
    $("#qr-scan-file").disabled = busy || Boolean(stream);
  }
  function stop() {
    generation++;
    cancelAnimationFrame(frame);
    frame = null;
    stopTracks(stream);
    stream = null;
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    busy = false;
    controls();
  }
  function result(text) {
    stop();
    $("#qr-scan-result").value = text;
    $("#qr-scan-copy").disabled = !text;
    const link = $("#qr-scan-open");
    link.hidden = true;
    link.removeAttribute("href");
    try {
      const url = new URL(text);
      if (["http:", "https:"].includes(url.protocol)) {
        link.href = url.href;
        link.hidden = false;
      }
    } catch {}
    state(
      "QR code read. Review the content before opening a link or sharing it.",
    );
  }
  function decode(source, width, height, scanner) {
    if (!context)
      throw Error("Image reading is not available in this browser.");
    const scale = Math.min(1, 2200 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    let pixels;
    try {
      pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      throw Error(
        "The browser could not read image pixels. Try another browser or scan the code with your device camera app.",
      );
    }
    return scanner(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: "attemptBoth",
    });
  }
  $("#qr-scan-file").onchange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    stop();
    const token = generation;
    busy = true;
    controls();
    state("Reading this image on your device…");
    try {
      const [picture, scanner] = await Promise.all([
        image(file),
        library("jsqr.js", "jsQR"),
      ]);
      if (token !== generation) return;
      const code = decode(
        picture,
        picture.naturalWidth || picture.width,
        picture.naturalHeight || picture.height,
        scanner,
      );
      if (code) result(code.data);
      else
        state(
          "No readable QR code found. Try a sharper image with the complete code and its border visible.",
          true,
        );
    } catch (error) {
      if (token === generation) state(error.message, true);
    } finally {
      if (token === generation) {
        busy = false;
        controls();
      }
    }
  };
  $("#qr-camera-start").onclick = async () => {
    stop();
    const token = generation;
    busy = true;
    controls();
    state("Allow camera access to begin scanning…");
    let incoming = null;
    try {
      incoming = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: $("#qr-camera-facing").value },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (token !== generation) {
        stopTracks(incoming);
        return;
      }
      stream = incoming;
      stream.getVideoTracks().forEach((track) =>
        track.addEventListener(
          "ended",
          () => {
            if (token === generation) {
              stop();
              state("Camera stopped. Start again to scan another code.");
            }
          },
          { once: true },
        ),
      );
      const scanner = await library("jsqr.js", "jsQR");
      if (token !== generation) {
        stopTracks(incoming);
        return;
      }
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      if (token !== generation) return;
      busy = false;
      controls();
      state(
        "Camera active. Point it at one complete QR code. Scanning stops when a result is found.",
      );
      lastFrame = 0;
      const scan = (time) => {
        if (token !== generation || !stream) return;
        try {
          if (
            video.readyState >= 2 &&
            time - lastFrame >= 250 &&
            video.videoWidth &&
            video.videoHeight
          ) {
            lastFrame = time;
            const code = decode(
              video,
              video.videoWidth,
              video.videoHeight,
              scanner,
            );
            if (code) {
              result(code.data);
              return;
            }
          }
          frame = requestAnimationFrame(scan);
        } catch (error) {
          stop();
          state(error.message, true);
        }
      };
      frame = requestAnimationFrame(scan);
    } catch (error) {
      stopTracks(incoming);
      if (token === generation) {
        stop();
        state(mediaError(error), true);
      }
    }
  };
  $("#qr-camera-stop").onclick = () => {
    stop();
    state("Camera off. Your result stays here until you clear it.");
  };
  $("#qr-camera-facing").onchange = () => {
    if (stream || busy) {
      stop();
      state("Camera changed. Choose Start camera to scan with it.");
    }
  };
  $("#qr-scan-copy").onclick = () => copy($("#qr-scan-result"));
  $("#qr-scan-clear").onclick = () => {
    stop();
    $("#qr-scan-result").value = "";
    $("#qr-scan-copy").disabled = true;
    $("#qr-scan-open").hidden = true;
    $("#qr-scan-open").removeAttribute("href");
    state("Result cleared. Choose another image or start the camera.");
  };
  function tab(scan, focus = false) {
    if (!scan) stop();
    $("#qr-scan-panel").hidden = !scan;
    $("#qr-generate-panel").hidden = scan;
    for (const [id, selected] of [
      ["qr-scan-tab", scan],
      ["qr-generate-tab", !scan],
    ]) {
      $("#" + id).setAttribute("aria-selected", String(selected));
      $("#" + id).tabIndex = selected ? 0 : -1;
      if (focus && selected) $("#" + id).focus();
    }
  }
  $("#qr-generate-tab").onclick = () => tab(false);
  $("#qr-scan-tab").onclick = () => tab(true);
  for (const id of ["qr-generate-tab", "qr-scan-tab"])
    $("#" + id).addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        tab(
          event.key === "End" ||
            (event.key !== "Home" &&
              $("#qr-scan-tab").getAttribute("aria-selected") !== "true"),
          true,
        );
      }
    });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (stream || busy)) {
      stop();
      state(
        "Camera stopped while this page was hidden. Start again when you are ready.",
      );
    }
  });
  window.addEventListener("pagehide", stop);
  if (!navigator.mediaDevices?.getUserMedia)
    state(
      "Camera scanning is unavailable here. You can still scan a local image.",
    );
  tab(false);
  controls();
}
