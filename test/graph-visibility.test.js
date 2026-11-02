const assert = require("node:assert/strict");
const { test } = require("node:test");
const { isGraphVisible, unwatchGraphVisibility, watchGraphVisibility } = require("../src/graph-visibility");

// One window with its document. A minimized window sets the document visibility state to "hidden".
function createWindow({ resizeObserver = true } = {}) {
  const observers = new Set();
  const listeners = new Set();
  const doc = {
    visibilityState: "visible",
    addEventListener(type, listener) {
      if (type === "visibilitychange") {
        listeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange") {
        listeners.delete(listener);
      }
    }
  };
  const win = {};
  if (resizeObserver) {
    win.ResizeObserver = function(callback) {
      const observer = {
        targets: new Set(),
        observe(target) {
          this.targets.add(target);
        },
        disconnect() {
          this.targets.clear();
          observers.delete(observer);
        }
      };
      observer.callback = callback;
      observers.add(observer);
      return observer;
    };
  }

  const notifyVisibility = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return {
    win,
    doc,
    observerCount: () => observers.size,
    listenerCount: () => listeners.size,
    // Report the size of each observed element, as a ResizeObserver does after a layout.
    reportSizes() {
      for (const observer of [...observers]) {
        const entries = [...observer.targets].map((target) => ({ target }));
        if (entries.length > 0) {
          observer.callback(entries);
        }
      }
    },
    minimize() {
      doc.visibilityState = "hidden";
      notifyVisibility();
    },
    restore() {
      doc.visibilityState = "visible";
      notifyVisibility();
    }
  };
}

// A graph view element. Obsidian hides a tab that is not active with display: none, so its size is 0.
function createGraphElement(window) {
  return { win: window.win, ownerDocument: window.doc, isConnected: true, clientWidth: 800, clientHeight: 600 };
}

function hide(el, window) {
  el.clientWidth = 0;
  el.clientHeight = 0;
  window.reportSizes();
}

function show(el, window) {
  el.clientWidth = 800;
  el.clientHeight = 600;
  window.reportSizes();
}

test("counts a graph without a watch as visible", () => {
  assert.equal(isGraphVisible({ containerEl: createGraphElement(createWindow()) }), true);
  assert.equal(isGraphVisible(null), true);
});

test("follows the graph through a hidden tab and calls onShow one time when it shows", () => {
  const window = createWindow();
  const el = createGraphElement(window);
  const renderer = { containerEl: el };
  let shows = 0;
  watchGraphVisibility(renderer, () => shows++);
  assert.equal(isGraphVisible(renderer), true);

  hide(el, window);
  window.reportSizes();
  assert.equal(isGraphVisible(renderer), false);
  assert.equal(shows, 0);

  show(el, window);
  window.reportSizes();
  assert.equal(isGraphVisible(renderer), true);
  assert.equal(shows, 1, "onShow runs one time for each change from hidden to visible");
});

test("counts a graph in a minimized window as hidden", () => {
  const window = createWindow();
  const renderer = { containerEl: createGraphElement(window) };
  let shows = 0;
  watchGraphVisibility(renderer, () => shows++);

  window.minimize();
  assert.equal(isGraphVisible(renderer), false);
  window.restore();
  assert.equal(isGraphVisible(renderer), true);
  assert.equal(shows, 1);
});

test("watches a graph that starts in a hidden tab", () => {
  const window = createWindow();
  const el = createGraphElement(window);
  el.clientWidth = 0;
  el.clientHeight = 0;
  const renderer = { containerEl: el };
  let shows = 0;
  watchGraphVisibility(renderer, () => shows++);
  assert.equal(isGraphVisible(renderer), false);

  show(el, window);
  assert.equal(isGraphVisible(renderer), true);
  assert.equal(shows, 1);
});

test("removes the observer and the listener on unwatch, and then counts the graph as visible", () => {
  const window = createWindow();
  const el = createGraphElement(window);
  const renderer = { containerEl: el };
  watchGraphVisibility(renderer, () => {});
  watchGraphVisibility(renderer, () => {});
  assert.equal(window.observerCount(), 1, "a second watch must not add an observer");
  assert.equal(window.listenerCount(), 1);

  hide(el, window);
  unwatchGraphVisibility(renderer);
  assert.equal(window.observerCount(), 0);
  assert.equal(window.listenerCount(), 0);
  assert.equal(isGraphVisible(renderer), true);
  unwatchGraphVisibility(renderer);
  unwatchGraphVisibility(null);
});

test("starts a new watch when the graph moves to another window", () => {
  const mainWindow = createWindow();
  const el = createGraphElement(mainWindow);
  const renderer = { containerEl: el };
  let shows = 0;
  watchGraphVisibility(renderer, () => shows++);
  hide(el, mainWindow);

  // Obsidian moves the same view element into the document of the new window.
  const popout = createWindow();
  el.win = popout.win;
  el.ownerDocument = popout.doc;
  el.clientWidth = 800;
  el.clientHeight = 600;
  assert.equal(isGraphVisible(renderer), false, "the state stays hidden until the new window reports a size");
  assert.equal(mainWindow.observerCount(), 0, "the old window must not keep an observer");
  assert.equal(mainWindow.listenerCount(), 0, "the old window must not keep a listener");
  assert.equal(popout.observerCount(), 1);
  assert.equal(popout.listenerCount(), 1);

  popout.reportSizes();
  assert.equal(isGraphVisible(renderer), true);
  assert.equal(shows, 1);
});

test("does not watch a graph when its window has no ResizeObserver", () => {
  const window = createWindow({ resizeObserver: false });
  const el = createGraphElement(window);
  const renderer = { containerEl: el };
  watchGraphVisibility(renderer, () => {});
  hide(el, window);
  assert.equal(isGraphVisible(renderer), true, "without size reports, the graph must never stop");
  assert.equal(window.listenerCount(), 0);
});

test("reads no element size when it checks the visibility state", () => {
  const window = createWindow();
  const el = createGraphElement(window);
  let sizeReads = 0;
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    get() {
      sizeReads++;
      return 800;
    }
  });
  const renderer = { containerEl: el };
  watchGraphVisibility(renderer, () => {});

  sizeReads = 0;
  for (let index = 0; index < 100; index++) {
    isGraphVisible(renderer);
  }
  assert.equal(sizeReads, 0, "a check in each frame must not cause layout work");
});
