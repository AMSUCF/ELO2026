// Shared HLS attachment for STARS recordings.
//
// Ordering matters here: Chrome answers canPlayType("application/vnd.apple
// .mpegurl") with "maybe" but cannot actually play HLS, so trusting that
// check first leaves the video stuck in networkState LOADING with no error
// ever firing. hls.js is therefore preferred wherever Media Source
// Extensions exist, and native playback is reserved for the engines that
// have no MSE at all (notably iPhone Safari), where it is the only option.

const HLS_JS_SRC = "https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js";

// Some sessions are long; give a slow connection room before declaring failure.
const STALL_TIMEOUT_MS = 30000;

function hasMediaSource() {
  return typeof window.MediaSource !== "undefined" ||
         typeof window.ManagedMediaSource !== "undefined";
}

let hlsLoader = null;
function loadHlsJs() {
  if (!hlsLoader) {
    hlsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = HLS_JS_SRC;
      script.onload = () => resolve(window.Hls);
      script.onerror = () => reject(new Error("hls.js failed to load"));
      document.head.appendChild(script);
    });
  }
  return hlsLoader;
}

// Attaches `src` to `video`, calling onFatalError() if the stream cannot be
// played at all. Resolves once a playback strategy is attached, not once
// playback begins.
export async function attachStream(video, src, onFatalError) {
  let settled = false;
  const fail = () => {
    if (settled) return;
    settled = true;
    clearTimeout(stallTimer);
    onFatalError();
  };
  const succeed = () => {
    if (settled) return;
    settled = true;
    clearTimeout(stallTimer);
  };

  // Nothing below reports a stalled manifest reliably, so watch for the
  // player never producing metadata. The readyState re-check keeps a slow
  // but working stream from having its player yanked away.
  const stallTimer = setTimeout(() => {
    if (video.readyState === 0) fail();
    else succeed();
  }, STALL_TIMEOUT_MS);
  video.addEventListener("loadedmetadata", succeed, { once: true });

  if (hasMediaSource()) {
    let Hls;
    try {
      Hls = await loadHlsJs();
    } catch {
      Hls = null;
    }
    if (Hls && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          hls.destroy();
          fail();
        }
      });
      return;
    }
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.addEventListener("error", fail, { once: true });
    video.src = src;
    return;
  }

  fail();
}
