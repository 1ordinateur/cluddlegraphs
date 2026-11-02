// Obsidian's graph worker sends new node positions about 60 times a second while the layout moves.
// Each message makes the main thread draw the full graph, and the main thread also runs the editor.
// Thus a large graph can freeze Obsidian, for example when a new link restarts the layout.
// While the layout moves, and until the native render loop stops after its idle frames, this limit
// draws at most about 30 frames a second. It also waits at least as long as the last frame took,
// so the graph uses at most about half of the main thread. A hover, pan or zoom without layout
// motion keeps the native frame rate. Canvas zone cloud syncs follow the drawn frames, but they run
// in their own frame callback, so this bound does not include their time.

const LAYOUT_FRAME_INTERVAL_MS = 1000 / 30;
// Frame callbacks start on display refresh boundaries, so a frame can start a little early.
const FRAME_START_TOLERANCE_MS = 4;
// The native loop draws 61 frames after its last wake, and then it stops.
const NATIVE_IDLE_FRAMES = 61;

const limits = new WeakMap();

function getRendererWindow(renderer) {
  return renderer.containerEl?.win ?? globalThis;
}

function getTime(win) {
  return (win.performance ?? globalThis.performance).now();
}

function limitLayoutFrames(renderer) {
  if (!renderer || limits.has(renderer) || typeof renderer.queueRender !== "function" || !("renderTimer" in renderer)) {
    return;
  }

  const limit = {
    layoutMoves: false,
    framesSinceLayoutStep: 0,
    frameWindow: null,
    lastFrameStart: null,
    frameInterval: LAYOUT_FRAME_INTERVAL_MS,
    hadOwnQueueRender: Object.hasOwn(renderer, "queueRender"),
    nativeQueueRender: renderer.queueRender,
    queueRender: null,
    onFrame: null,
    worker: renderer.worker ?? null,
    nativeOnMessage: null,
    onMessage: null
  };

  limit.onFrame = () => {
    const callback = renderer.renderCallback;
    if (!callback) {
      renderer.renderTimer = null;
      return;
    }

    const win = getRendererWindow(renderer);
    if (win !== limit.frameWindow) {
      // Each window has its own clock origin, so a time from the previous window is not comparable.
      limit.frameWindow = win;
      limit.lastFrameStart = null;
    }
    const start = getTime(win);
    if (limit.layoutMoves
      && limit.lastFrameStart !== null
      && start - limit.lastFrameStart < limit.frameInterval - FRAME_START_TOLERANCE_MS) {
      renderer.renderTimer = win.requestAnimationFrame(limit.onFrame);
      return;
    }

    limit.lastFrameStart = start;
    callback.call(renderer);
    limit.frameInterval = Math.max(LAYOUT_FRAME_INTERVAL_MS, 2 * (getTime(win) - start));
    limit.framesSinceLayoutStep++;
    if (!renderer.renderTimer || limit.framesSinceLayoutStep >= NATIVE_IDLE_FRAMES) {
      // The layout and the native idle frames after it are complete. A later pan or hover keeps the native rate.
      limit.layoutMoves = false;
    }
  };

  // This is a copy of the queueRender of Obsidian 1.14.5, with the limit callback in place of the native
  // frame callback. While the limit is on, a queueRender wrapper from another plugin does not run.
  limit.queueRender = function() {
    if (!this.renderTimer && this.renderCallback) {
      this.renderTimer = getRendererWindow(this).requestAnimationFrame(limit.onFrame);
    }
  };
  renderer.queueRender = limit.queueRender;

  if (typeof limit.worker?.onmessage === "function") {
    limit.nativeOnMessage = limit.worker.onmessage;
    limit.onMessage = function(event) {
      // The worker sends one setup message with `ignore`. All other messages are layout steps.
      if (!event?.data?.ignore) {
        limit.layoutMoves = true;
        limit.framesSinceLayoutStep = 0;
      }
      return limit.nativeOnMessage.call(this, event);
    };
    limit.worker.onmessage = limit.onMessage;
  }

  limits.set(renderer, limit);
}

function restoreLayoutFrames(renderer) {
  const limit = renderer ? limits.get(renderer) : undefined;
  if (!limit) {
    return;
  }

  limits.delete(renderer);
  // A frame that is still queued draws at once, and the native loop then queues the frames that follow.
  limit.layoutMoves = false;
  if (renderer.queueRender === limit.queueRender) {
    if (limit.hadOwnQueueRender) {
      renderer.queueRender = limit.nativeQueueRender;
    } else {
      delete renderer.queueRender;
    }
  }
  if (limit.worker && limit.worker.onmessage === limit.onMessage) {
    limit.worker.onmessage = limit.nativeOnMessage;
  }
}

module.exports = {
  LAYOUT_FRAME_INTERVAL_MS,
  limitLayoutFrames,
  restoreLayoutFrames
};
