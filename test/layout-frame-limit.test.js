const assert = require("node:assert/strict");
const { test } = require("node:test");
const { limitLayoutFrames, restoreLayoutFrames } = require("../src/layout-frame-limit");

const REFRESH_MS = 1000 / 60;

// A display that refreshes at 60 Hz. Frame work moves the clock forward, as main thread work does.
// Each window has its own clock origin, so a window that opens later shows a smaller time.
function createDisplay(start = 0) {
  let now = start;
  let nextId = 1;
  let pending = [];
  const win = {
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      const id = nextId++;
      pending.push({ id, callback });
      return id;
    },
    cancelAnimationFrame(id) {
      pending = pending.filter((frame) => frame.id !== id);
    }
  };

  return {
    win,
    now: () => now,
    spend(ms) {
      now += ms;
    },
    hasPendingFrames: () => pending.length > 0,
    pendingFrameCount: () => pending.length,
    // Run each display refresh up to `until`. `beforeRefresh` runs first, for example for a worker message.
    run(until, beforeRefresh = () => {}) {
      for (;;) {
        const refresh = (Math.floor(now / REFRESH_MS + 1e-9) + 1) * REFRESH_MS;
        if (refresh > until) {
          now = Math.max(now, until);
          return;
        }
        now = refresh;
        beforeRefresh(now);
        const due = pending;
        pending = [];
        for (const frame of due) {
          frame.callback(now);
        }
      }
    }
  };
}

// The parts of Obsidian 1.14.5's graph renderer loop that the frame limit touches.
const nativeRendererPrototype = {
  changed() {
    this.idleFrames = 0;
    this.queueRender();
  },
  queueRender() {
    if (!this.renderTimer && this.renderCallback) {
      this.renderTimer = this.containerEl.win.requestAnimationFrame(this.renderCallback);
    }
  },
  initGraphics() {
    this.renderCallback = () => {
      this.renderTimer = null;
      if (this.idleFrames > 60) {
        return;
      }
      const start = this.display.now();
      this.display.spend(this.frameCost);
      this.frames++;
      this.busy += this.frameCost;
      this.firstFrameStart ??= start;
      this.lastFrameEnd = this.display.now();
      this.idleFrames++;
      this.queueRender();
    };
    this.queueRender();
  },
  destroyGraphics() {
    this.containerEl.win.cancelAnimationFrame(this.renderTimer);
    this.renderTimer = null;
    this.renderCallback = null;
  }
};

function createNativeRenderer(display, frameCost) {
  const renderer = Object.create(nativeRendererPrototype);
  Object.assign(renderer, {
    display,
    frameCost,
    frames: 0,
    busy: 0,
    firstFrameStart: null,
    lastFrameEnd: null,
    idleFrames: 0,
    renderTimer: null,
    containerEl: { win: display.win }
  });
  renderer.worker = {
    onmessage(event) {
      if (!event.data.ignore) {
        renderer.workerResults = event.data;
        renderer.changed();
      }
    }
  };
  return renderer;
}

// The layout worker sends new node positions at each display refresh until `end`.
function layoutMessagesUntil(renderer, end) {
  return (time) => {
    if (time < end) {
      renderer.worker.onmessage({ data: { id: [], buffer: null } });
    }
  };
}

function resetCounts(renderer) {
  renderer.frames = 0;
  renderer.busy = 0;
  renderer.firstFrameStart = null;
  renderer.lastFrameEnd = null;
}

test("draws at most about 30 frames a second while the layout moves", () => {
  const display = createDisplay();
  const renderer = createNativeRenderer(display, 2);
  limitLayoutFrames(renderer);
  renderer.initGraphics();

  display.run(1000, layoutMessagesUntil(renderer, 1000));

  assert.ok(renderer.frames >= 28 && renderer.frames <= 31, `${renderer.frames} frames in one second`);
});

test("keeps at least half of the main thread free while slow layout frames draw", () => {
  const display = createDisplay();
  const renderer = createNativeRenderer(display, 50);
  limitLayoutFrames(renderer);
  renderer.initGraphics();

  display.run(3000, layoutMessagesUntil(renderer, 3000));

  assert.ok(renderer.busy / 3000 <= 0.55, `the graph used ${Math.round(renderer.busy / 30)}% of the main thread`);
  assert.ok(renderer.frames >= 25, `the graph must continue to draw, but drew only ${renderer.frames} frames`);
});

test("keeps half of the main thread free while a new link restarts the layout, also in the idle tail", () => {
  const display = createDisplay();
  const renderer = createNativeRenderer(display, 40);
  limitLayoutFrames(renderer);
  renderer.initGraphics();
  display.run(20000);
  resetCounts(renderer);

  // A new link makes Obsidian restart the layout at alpha 0.3, which is about 250 worker steps.
  const restartAt = display.now();
  renderer.changed();
  display.run(restartAt + 60000, layoutMessagesUntil(renderer, restartAt + 250 * REFRESH_MS));

  assert.equal(display.hasPendingFrames(), false, "the render loop must stop after the idle tail");
  assert.ok(renderer.frames >= 61, `the idle tail must draw all its frames, but drew ${renderer.frames}`);
  const span = renderer.lastFrameEnd - renderer.firstFrameStart;
  assert.ok(renderer.busy / span <= 0.55, `the graph used ${Math.round((100 * renderer.busy) / span)}% of the main thread`);
});

test("draws at full rate when only a hover or pan wakes the graph", () => {
  const display = createDisplay();
  const renderer = createNativeRenderer(display, 2);
  limitLayoutFrames(renderer);
  renderer.worker.onmessage({ data: { ignore: true, shared: null } });
  renderer.initGraphics();

  display.run(500);
  assert.ok(renderer.frames >= 29, `${renderer.frames} frames in 500 ms without layout motion`);

  display.run(2000, layoutMessagesUntil(renderer, 1000));
  display.run(20000);
  assert.equal(display.hasPendingFrames(), false, "the render loop must stop after the layout");
  resetCounts(renderer);

  const hoverAt = display.now();
  renderer.changed();
  display.run(hoverAt + 500);
  assert.ok(renderer.frames >= 29, `${renderer.frames} frames in 500 ms after the layout stopped`);
});

test("cancels a waiting frame when Obsidian destroys the graph graphics, and starts again after a new init", () => {
  const display = createDisplay();
  const renderer = createNativeRenderer(display, 50);
  limitLayoutFrames(renderer);
  renderer.initGraphics();
  display.run(120, layoutMessagesUntil(renderer, 120));
  const frames = renderer.frames;
  assert.ok(frames >= 1);

  renderer.destroyGraphics();
  display.run(2000);
  assert.equal(renderer.frames, frames, "no frame may draw after destroyGraphics");
  assert.equal(display.hasPendingFrames(), false);

  renderer.initGraphics();
  display.run(2500);
  assert.ok(renderer.frames > frames, "the graph must draw again after a new initGraphics");
});

test("restores the native render scheduling and worker handler", () => {
  const display = createDisplay();
  const renderer = createNativeRenderer(display, 2);
  const nativeOnMessage = renderer.worker.onmessage;
  const ownQueueRender = createNativeRenderer(display, 2);
  const nativeQueueRender = function() {
    return nativeRendererPrototype.queueRender.call(this);
  };
  ownQueueRender.queueRender = nativeQueueRender;

  limitLayoutFrames(renderer);
  limitLayoutFrames(renderer);
  limitLayoutFrames(ownQueueRender);
  assert.notEqual(renderer.worker.onmessage, nativeOnMessage);
  assert.notEqual(ownQueueRender.queueRender, nativeQueueRender);

  restoreLayoutFrames(renderer);
  restoreLayoutFrames(ownQueueRender);
  assert.equal(Object.hasOwn(renderer, "queueRender"), false);
  assert.equal(renderer.worker.onmessage, nativeOnMessage);
  assert.equal(ownQueueRender.queueRender, nativeQueueRender);

  renderer.initGraphics();
  display.run(1000, layoutMessagesUntil(renderer, 1000));
  assert.ok(renderer.frames >= 58, `${renderer.frames} frames in one second after the restore`);
});

test("leaves a renderer without the native render loop unchanged", () => {
  const renderer = { setData() {} };
  limitLayoutFrames(renderer);
  restoreLayoutFrames(renderer);
  assert.deepEqual(Object.keys(renderer), ["setData"]);
  limitLayoutFrames(null);
  restoreLayoutFrames(undefined);
});

test("draws again at once after the graph moves to a new window while the layout moves", () => {
  const mainWindow = createDisplay(3600000);
  const renderer = createNativeRenderer(mainWindow, 2);
  limitLayoutFrames(renderer);
  renderer.initGraphics();
  mainWindow.run(3601000, layoutMessagesUntil(renderer, 3602000));

  // Obsidian reloads the graph iframe in the new window: destroyGraphics, then initGraphics on the same renderer.
  const popout = createDisplay(0);
  renderer.destroyGraphics();
  renderer.display = popout;
  renderer.containerEl = { win: popout.win };
  resetCounts(renderer);
  renderer.initGraphics();
  popout.run(1000, layoutMessagesUntil(renderer, 1000));

  assert.ok(renderer.frames >= 28, `${renderer.frames} frames in the first second in the new window`);
});

test("returns to the full frame rate for a pan that starts in the idle tail after the layout", () => {
  const display = createDisplay();
  const renderer = createNativeRenderer(display, 2);
  limitLayoutFrames(renderer);
  renderer.initGraphics();
  display.run(1000, layoutMessagesUntil(renderer, 1000));

  // A pan calls changed() at each refresh, so the native loop does not stop.
  const pan = () => renderer.changed();
  display.run(3000, pan);
  resetCounts(renderer);
  display.run(4000, pan);

  assert.ok(renderer.frames >= 58, `${renderer.frames} frames in one second of a pan, 2 s after the layout stopped`);
});

test("keeps one queued frame when Obsidian destroys and inits the graphics in one step while a frame waits", () => {
  const display = createDisplay();
  const renderer = createNativeRenderer(display, 50);
  limitLayoutFrames(renderer);
  renderer.initGraphics();
  let maxPending = 0;
  const messages = layoutMessagesUntil(renderer, 5000);
  const watch = (time) => {
    maxPending = Math.max(maxPending, display.pendingFrameCount());
    messages(time);
  };
  display.run(130, watch);
  const frames = renderer.frames;

  renderer.destroyGraphics();
  renderer.initGraphics();
  assert.equal(display.pendingFrameCount(), 1);
  display.run(3000, watch);

  assert.equal(maxPending, 1, "there must never be two frame chains");
  assert.ok(renderer.frames > frames + 10, "the graph must continue to draw after the new init");
});

test("draws a waiting frame after a restore and then continues at the native rate", () => {
  const display = createDisplay();
  const renderer = createNativeRenderer(display, 2);
  limitLayoutFrames(renderer);
  renderer.initGraphics();
  let maxPending = 0;
  const messages = layoutMessagesUntil(renderer, 2000);
  const watch = (time) => {
    maxPending = Math.max(maxPending, display.pendingFrameCount());
    messages(time);
  };
  display.run(500, watch);

  restoreLayoutFrames(renderer);
  resetCounts(renderer);
  display.run(1500, watch);

  assert.equal(maxPending, 1, "there must never be two frame chains");
  assert.ok(renderer.frames >= 58, `${renderer.frames} frames in one second after the restore`);
});
