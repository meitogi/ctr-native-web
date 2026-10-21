// What Share sends : the game canvas, one frame per present, and SDL's audio output.
//
// Video : `canvas.captureStream(0)` takes a frame only on `requestFrame()`, which the game
// calls right after each present (platform/native_renderer.c, NativeRenderer_WebSharePresent),
// so the stream carries exactly the frames the game shows (~30 fps) and no duplicates.
// The canvas is an upscale of the PS1 display : `scale` brings the encoded width back to the
// PS1 width (512 → 512 × 384 on the 800 × 600 canvas), every PS1 column kept.
//
// Audio : SDL3's ScriptProcessorNode (externals/SDL/src/audio/emscripten) also feeds a
// MediaStreamAudioDestinationNode. The dev page's mute (web/index.html, no `?sound`) sits
// between that node and the speakers only, so the tap carries the sound either way and never
// unmutes the tab. SDL drops and recreates the node when the device reopens : `tapAudio()` is
// re-run and connects the new one to the same destination.

/** The scale-down (≥ 1) from the canvas viewport to the PS1 display width. */
export function scaleFor(displayW, viewportW) {
  if (!(displayW > 0) || !(viewportW > 0)) return 1;
  return Math.max(1, Math.round((viewportW / displayW) * 10000) / 10000);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} Module - the Emscripten module (`Module.SDL3` once SDL's audio is open)
 * @param {object} [o]
 * @param {(scale: number) => void} [o.onScale] - the PS1 display size changed
 */
export function createCapture(canvas, Module, { onScale = () => {} } = {}) {
  const video = canvas.captureStream(0);
  const [track] = video.getVideoTracks();
  track.contentHint = 'motion';
  const cap = { stream: new MediaStream([track]), frames: 0, scale: 1, display: null, audio: false };
  let dest = null;
  let tapped = null;

  /** Connects SDL's playback node to the stream's audio track ; true once there is one. */
  cap.tapAudio = () => {
    const sdl = Module.SDL3;
    const ctx = sdl?.audioContext;
    const node = sdl?.audio_playback?.scriptProcessorNode;
    if (!ctx || !node) return cap.audio;
    if (!dest) {
      dest = ctx.createMediaStreamDestination();
      cap.stream.addTrack(dest.stream.getAudioTracks()[0]);
      cap.audio = true;
    }
    if (node !== tapped && dest.context === ctx) {
      node.connect(dest);
      tapped = node;
    }
    return cap.audio;
  };

  /** Called by the game after each present. */
  cap.present = (displayW, displayH, viewportW) => {
    track.requestFrame();
    cap.frames++;
    const d = cap.display;
    if (d && d[0] === displayW && d[1] === displayH && d[2] === viewportW) return;
    cap.display = [displayW, displayH, viewportW];
    const scale = scaleFor(displayW, viewportW);
    if (scale !== cap.scale) {
      cap.scale = scale;
      onScale(scale);
    }
  };

  cap.stop = () => {
    for (const t of cap.stream.getTracks()) t.stop();
    tapped?.disconnect(dest);
  };
  return cap;
}
