// A graph updates only while someone can see it. Obsidian hides a tab that is not active with
// display: none, so the view element has no size. A collapsed sidebar also gives no size, and a
// minimized window sets the document visibility state to "hidden". A ResizeObserver and the
// visibilitychange event report each change, so a check in each frame reads a stored state and
// causes no layout work.

const watches = new WeakMap();

function isElementShown(el) {
  return el.isConnected !== false
    && el.clientWidth > 0
    && el.clientHeight > 0
    && el.ownerDocument?.visibilityState !== "hidden";
}

function startWatch(renderer, onShow, visible) {
  const el = renderer?.containerEl;
  const win = el?.win ?? el?.ownerDocument?.defaultView;
  if (!el || watches.has(renderer) || typeof win?.ResizeObserver !== "function") {
    return;
  }

  const watch = {
    doc: el.ownerDocument ?? null,
    visible: visible ?? isElementShown(el),
    onShow,
    observer: null,
    update: null
  };
  watch.update = () => {
    const shown = isElementShown(el);
    if (shown === watch.visible) {
      return;
    }
    watch.visible = shown;
    if (shown) {
      watch.onShow();
    }
  };
  watch.observer = new win.ResizeObserver(watch.update);
  watch.observer.observe(el);
  watch.doc?.addEventListener?.("visibilitychange", watch.update);
  watches.set(renderer, watch);
}

function stopWatch(renderer, watch) {
  watch.observer.disconnect();
  watch.doc?.removeEventListener?.("visibilitychange", watch.update);
  watches.delete(renderer);
}

// Call onShow each time the graph changes from hidden to visible.
function watchGraphVisibility(renderer, onShow) {
  startWatch(renderer, onShow);
}

function unwatchGraphVisibility(renderer) {
  const watch = renderer ? watches.get(renderer) : undefined;
  if (watch) {
    stopWatch(renderer, watch);
  }
}

// A graph without a watch counts as visible, so that it never stops by mistake.
function isGraphVisible(renderer) {
  const watch = renderer ? watches.get(renderer) : undefined;
  if (!watch) {
    return true;
  }

  if (renderer.containerEl?.ownerDocument !== watch.doc) {
    // The graph moved to another window. Watch it there, and keep the last state until that window reports a size.
    stopWatch(renderer, watch);
    startWatch(renderer, watch.onShow, watch.visible);
    return watches.get(renderer)?.visible ?? true;
  }
  return watch.visible;
}

module.exports = {
  isGraphVisible,
  unwatchGraphVisibility,
  watchGraphVisibility
};
