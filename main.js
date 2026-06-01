const { Plugin, Setting } = require("obsidian");

const TARGET_DEPTH = 2;
const GRAPH_VIEW_TYPE = "graph";
const LOCAL_GRAPH_VIEW_TYPE = "localgraph";
const SEARCH_HIGHLIGHT_OPTION = "searchHighlightMode";
const SEARCH_HIGHLIGHT_COLOR_OPTION = "searchHighlightColor";
const SEARCH_HIGHLIGHT_TOGGLE_CLASS = "cluddlegraphs-search-highlight-toggle";
const SEARCH_HIGHLIGHT_COLOR_CLASS = "cluddlegraphs-search-highlight-color";
const SEARCH_HIGHLIGHT_COLOR_MARKER = "__cluddlegraphsSearchHit";
const SEARCH_HIGHLIGHT_DEFAULT_COLOR = "#ff2d55";
const LEGACY_SEARCH_HIGHLIGHT_SENTINEL = { a: 1, rgb: 0xff00ff };
const RESET_CONFIRM_BUTTON_CLASS = "cluddlegraphs-reset-confirm";
const RESET_CONFIRMING_CLASS = "cluddlegraphs-reset-confirming";
const RESET_CONFIRM_TIMEOUT_MS = 5000;

module.exports = class CluddleGraphsPlugin extends Plugin {
  onload() {
    this.pendingLeaves = new WeakSet();
    this.enginePatches = new WeakMap();
    this.rendererPatches = new WeakMap();
    this.nodePatches = new WeakMap();
    this.linkPatches = new WeakMap();
    this.filterControls = new WeakMap();
    this.displayControls = new WeakMap();
    this.resetButtonPatches = new WeakMap();

    const syncSoon = () => {
      window.setTimeout(() => this.syncGraphViews(), 0);
      window.setTimeout(() => this.syncGraphViews(), 250);
    };

    this.app.workspace.onLayoutReady(syncSoon);
    this.registerEvent(this.app.workspace.on("layout-change", syncSoon));
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncSoon));
  }

  onunload() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.restoreGraphEngine(this.getGraphEngine(leaf?.view));
    });
  }

  syncGraphViews() {
    this.enforceLocalGraphDepth();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const engine = this.getGraphEngine(leaf?.view);
      if (!engine) {
        return;
      }

      this.initializeSearchHighlightOptions(engine);
      this.addGraphPanelToggle(engine);
      this.addGraphDisplayColorPicker(engine);
      this.patchGraphResetButton(engine);
      this.patchGraphEngine(engine);
      this.syncRendererSearchHighlights(engine);
    });
  }

  enforceLocalGraphDepth() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!leaf?.view || leaf.view.getViewType?.() !== LOCAL_GRAPH_VIEW_TYPE) {
        return;
      }

      const viewState = leaf.getViewState?.();
      if (!viewState?.state) {
        return;
      }

      const options = viewState.state.options ?? {};
      if (options.localJumps === TARGET_DEPTH || this.pendingLeaves.has(leaf)) {
        return;
      }

      const nextViewState = {
        ...viewState,
        state: {
          ...viewState.state,
          options: {
            ...options,
            localJumps: TARGET_DEPTH
          }
        }
      };

      this.pendingLeaves.add(leaf);
      Promise.resolve(leaf.setViewState(nextViewState))
        .catch((error) => console.error("Failed to set local graph depth", error))
        .finally(() => this.pendingLeaves.delete(leaf));
    });
  }

  addGraphPanelToggle(engine) {
    const filterOptions = engine.filterOptions;
    const childrenEl = filterOptions?.childrenEl;
    if (!childrenEl) {
      return;
    }

    const trackedControlEl = this.filterControls.get(engine)?.settingEl;
    if (trackedControlEl?.parentElement === childrenEl) {
      this.placeSearchHighlightToggle(childrenEl, trackedControlEl);
      return;
    }

    this.removeDetachedControl(childrenEl, SEARCH_HIGHLIGHT_TOGGLE_CLASS, trackedControlEl);

    const setting = new Setting(childrenEl)
      .setName("Highlight search matches")
      .setClass("mod-toggle")
      .setClass(SEARCH_HIGHLIGHT_TOGGLE_CLASS)
      .addToggle((toggle) => {
        toggle
          .setValue(this.isHighlightModeEnabled(engine))
          .onChange((enabled) => {
            this.setHighlightMode(engine, enabled);
          });

        filterOptions.optionListeners[SEARCH_HIGHLIGHT_OPTION] = (value) => {
          if (typeof value === "boolean") {
            engine.options[SEARCH_HIGHLIGHT_OPTION] = value;
            toggle.setValue(value);
            this.refreshGraphSearch(engine);
          }
          return this.isHighlightModeEnabled(engine);
        };
      });

    this.placeSearchHighlightToggle(childrenEl, setting.settingEl);
    this.filterControls.set(engine, setting);
  }

  placeSearchHighlightToggle(childrenEl, settingEl) {
    childrenEl.appendChild(settingEl);
  }

  addGraphDisplayColorPicker(engine) {
    const displayOptions = engine.displayOptions;
    const childrenEl = displayOptions?.childrenEl;
    if (!childrenEl) {
      return;
    }

    const trackedControlEl = this.displayControls.get(engine)?.settingEl;
    if (trackedControlEl?.parentElement === childrenEl) {
      return;
    }

    this.removeDetachedControl(childrenEl, SEARCH_HIGHLIGHT_COLOR_CLASS, trackedControlEl);

    const setting = new Setting(childrenEl)
      .setName("Highlighted hit nodes")
      .setClass(SEARCH_HIGHLIGHT_COLOR_CLASS)
      .addColorPicker((colorPicker) => {
        colorPicker
          .setValue(this.getSearchHighlightColorHex(engine))
          .onChange((value) => {
            this.setSearchHighlightColor(engine, value);
          });

        displayOptions.optionListeners[SEARCH_HIGHLIGHT_COLOR_OPTION] = (value) => {
          if (typeof value === "string") {
            const color = this.normalizeHexColor(value);
            if (color) {
              engine.options[SEARCH_HIGHLIGHT_COLOR_OPTION] = color;
              colorPicker.setValue(color);
              this.refreshGraphSearch(engine);
              engine.renderer?.changed?.();
            }
          }
          return this.getSearchHighlightColorHex(engine);
        };
      });

    childrenEl.insertBefore(setting.settingEl, childrenEl.firstChild);
    this.displayControls.set(engine, setting);
  }

  removeDetachedControl(childrenEl, controlClass, trackedEl) {
    for (const existingEl of childrenEl.querySelectorAll?.(`.${controlClass}`) ?? []) {
      if (existingEl !== trackedEl) {
        this.detachElement(existingEl);
      }
    }
  }

  patchGraphResetButton(engine) {
    if (this.resetButtonPatches.has(engine)) {
      return;
    }

    const resetButton = engine.controlsEl?.querySelector?.(".graph-controls-button.mod-reset");
    if (!resetButton) {
      return;
    }

    const state = {
      confirmButton: null,
      timeoutId: null
    };

    const clearConfirmation = () => {
      if (state.timeoutId !== null) {
        window.clearTimeout(state.timeoutId);
        state.timeoutId = null;
      }

      this.detachElement(state.confirmButton);
      state.confirmButton = null;
      resetButton.classList?.remove(RESET_CONFIRMING_CLASS);
    };

    const confirmReset = (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearConfirmation();
      this.resetGraphOptions(engine);
    };

    const onResetClick = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (state.confirmButton) {
        return;
      }

      state.confirmButton = this.createResetConfirmButton(resetButton, confirmReset);
      resetButton.classList?.add(RESET_CONFIRMING_CLASS);
      state.timeoutId = window.setTimeout(clearConfirmation, RESET_CONFIRM_TIMEOUT_MS);
    };

    resetButton.addEventListener("click", onResetClick, true);
    this.resetButtonPatches.set(engine, { resetButton, onResetClick, clearConfirmation });
  }

  createResetConfirmButton(resetButton, onClick) {
    const doc = resetButton.ownerDocument ?? document;
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = "Are you sure?";
    button.classList.add(RESET_CONFIRM_BUTTON_CLASS, "mod-warning");
    button.setAttribute("aria-label", "Confirm graph reset");
    button.addEventListener("click", onClick);
    resetButton.parentElement?.insertBefore(button, resetButton.nextSibling);
    return button;
  }

  setHighlightMode(engine, enabled) {
    engine.options[SEARCH_HIGHLIGHT_OPTION] = enabled;
    engine.onOptionsChange?.();
    this.refreshGraphSearch(engine);
  }

  setSearchHighlightColor(engine, value) {
    const color = this.normalizeHexColor(value);
    if (!color) {
      return;
    }

    engine.options[SEARCH_HIGHLIGHT_COLOR_OPTION] = color;
    engine.onOptionsChange?.();
    this.refreshGraphSearch(engine);
    engine.renderer?.changed?.();
  }

  isHighlightModeEnabled(engine) {
    return engine.options?.[SEARCH_HIGHLIGHT_OPTION] === true;
  }

  initializeSearchHighlightOptions(engine) {
    const savedOptions = this.getSavedGraphOptions(engine);

    if (typeof engine.options?.[SEARCH_HIGHLIGHT_OPTION] !== "boolean") {
      engine.options[SEARCH_HIGHLIGHT_OPTION] = savedOptions?.[SEARCH_HIGHLIGHT_OPTION] === true;
    }

    const savedColor = this.normalizeHexColor(savedOptions?.[SEARCH_HIGHLIGHT_COLOR_OPTION]);
    const currentColor = this.normalizeHexColor(engine.options?.[SEARCH_HIGHLIGHT_COLOR_OPTION]);
    engine.options[SEARCH_HIGHLIGHT_COLOR_OPTION] = currentColor ?? savedColor ?? SEARCH_HIGHLIGHT_DEFAULT_COLOR;
  }

  getSavedGraphOptions(engine) {
    if (engine.view?.getViewType?.() === LOCAL_GRAPH_VIEW_TYPE) {
      return engine.view?.leaf?.getViewState?.()?.state?.options ?? engine.view?.getState?.()?.options;
    }
    return this.app.internalPlugins?.getPluginById?.("graph")?.instance?.options;
  }

  patchGraphEngine(engine) {
    if (this.enginePatches.has(engine)) {
      return;
    }

    const originalSetQuery = engine.setQuery;
    const originalRender = engine.render;
    if (typeof originalSetQuery !== "function" || typeof originalRender !== "function") {
      return;
    }

    const plugin = this;
    engine.setQuery = function(queries) {
      plugin.currentSearchHighlightEngine = plugin.isHighlightModeEnabled(this) ? this : null;
      try {
        return originalSetQuery.call(this, plugin.prepareQueriesForSearchHighlight(this, queries));
      } finally {
        plugin.currentSearchHighlightEngine = null;
        plugin.syncRendererSearchHighlights(this);
      }
    };

    engine.render = function(...args) {
      const result = originalRender.apply(this, args);
      plugin.syncRendererSearchHighlights(this);
      return result;
    };

    this.enginePatches.set(engine, { setQuery: originalSetQuery, render: originalRender });
    this.patchRenderer(engine.renderer);
  }

  restoreGraphEngine(engine) {
    if (!engine) {
      return;
    }

    const patch = this.enginePatches.get(engine);
    if (patch) {
      engine.setQuery = patch.setQuery;
      engine.render = patch.render;
      this.enginePatches.delete(engine);
    }

    this.restoreGraphResetButton(engine);
    this.removeGraphPanelControls(engine);
    this.clearRendererSearchHighlights(engine.renderer);
    this.restoreRenderer(engine.renderer);
  }

  restoreGraphResetButton(engine) {
    const patch = this.resetButtonPatches.get(engine);
    if (!patch) {
      return;
    }

    patch.clearConfirmation();
    patch.resetButton.removeEventListener("click", patch.onResetClick, true);
    this.resetButtonPatches.delete(engine);
  }

  removeGraphPanelControls(engine) {
    const filterControl = this.filterControls.get(engine);
    if (filterControl) {
      this.detachElement(filterControl.settingEl);
      this.filterControls.delete(engine);
    }

    const displayControl = this.displayControls.get(engine);
    if (displayControl) {
      this.detachElement(displayControl.settingEl);
      this.displayControls.delete(engine);
    }

    delete engine.filterOptions?.optionListeners?.[SEARCH_HIGHLIGHT_OPTION];
    delete engine.displayOptions?.optionListeners?.[SEARCH_HIGHLIGHT_COLOR_OPTION];
  }

  detachElement(element) {
    if (typeof element?.detach === "function") {
      element.detach();
    } else {
      element?.remove?.();
    }
  }

  resetGraphOptions(engine) {
    engine.filterOptions?.setDefaultOptions?.();
    engine.colorGroupOptions?.setColorQueries?.([]);
    engine.displayOptions?.setDefaultOptions?.();
    engine.forceOptions?.setDefaultOptions?.();
    engine.onOptionsChange?.();
    this.enforceLocalGraphDepth();
  }

  prepareQueriesForSearchHighlight(engine, queries) {
    if (!this.isHighlightModeEnabled(engine) || !Array.isArray(queries)) {
      return queries;
    }

    return queries.map((query) => {
      if (!query || query.color) {
        return query;
      }

      return { ...query, color: this.createSearchHighlightColor(engine) };
    });
  }

  syncRendererSearchHighlights(engine) {
    const renderer = engine?.renderer;
    if (!renderer) {
      return;
    }

    this.patchRenderer(renderer);
    this.patchRendererElements(renderer);

    if (!this.isHighlightModeEnabled(engine)) {
      this.clearRendererSearchHighlights(renderer);
      return;
    }

    const search = engine.filterOptions?.search?.getValue?.() ?? "";
    if (!search) {
      this.clearRendererSearchHighlights(renderer);
      return;
    }

    const ids = this.getCurrentSearchMatchIds(engine);
    renderer.searchHighlightColor = this.createSearchHighlightColor(engine);
    renderer.searchHighlightNodeIds = ids;
    renderer.searchHighlightNodes = new Set(
      Array.from(ids)
        .map((id) => renderer.nodeLookup?.[id])
        .filter(Boolean)
    );
    renderer.changed?.();
  }

  getCurrentSearchMatchIds(engine) {
    const ids = new Set();
    const filter = engine.fileFilter ?? {};

    for (const [id, value] of Object.entries(filter)) {
      if (this.isSearchHighlightSentinel(value)) {
        ids.add(id);
      }
    }

    return ids;
  }

  isSearchHighlightSentinel(value) {
    return !!value
      && typeof value === "object"
      && (value[SEARCH_HIGHLIGHT_COLOR_MARKER] === true
        || (
          value.a === LEGACY_SEARCH_HIGHLIGHT_SENTINEL.a
          && value.rgb === LEGACY_SEARCH_HIGHLIGHT_SENTINEL.rgb
        ));
  }

  clearRendererSearchHighlights(renderer) {
    if (!renderer) {
      return;
    }

    if (renderer.searchHighlightNodeIds?.size || renderer.searchHighlightNodes?.size || renderer.searchHighlightColor) {
      renderer.searchHighlightNodeIds = new Set();
      renderer.searchHighlightNodes = new Set();
      renderer.searchHighlightColor = null;
      renderer.changed?.();
    }
  }

  patchRenderer(renderer) {
    if (!renderer || this.rendererPatches.has(renderer)) {
      return;
    }

    if (typeof renderer.getHighlightNode !== "function") {
      return;
    }

    const plugin = this;
    renderer.isSearchHighlightedNode = function(node) {
      return plugin.isSearchHighlightedNode(this, node);
    };
    renderer.isSearchRelatedNode = function(node) {
      return plugin.isSearchRelatedNode(this, node);
    };

    renderer.searchHighlightNodeIds = new Set();
    renderer.searchHighlightNodes = new Set();
    renderer.searchHighlightColor = null;
    this.rendererPatches.set(renderer, {});
  }

  patchRendererElements(renderer) {
    for (const node of renderer.nodes ?? []) {
      this.patchGraphNode(node);
    }

    for (const link of renderer.links ?? []) {
      this.patchGraphLink(link);
    }
  }

  patchGraphNode(node) {
    if (!node || this.nodePatches.has(node) || typeof node.render !== "function") {
      return;
    }

    const originalRender = node.render;
    const plugin = this;

    node.render = function(...args) {
      const renderer = this.renderer;
      const nativeHighlight = renderer.getHighlightNode?.();
      const searchHighlightNode = nativeHighlight ? null : plugin.getNodeSearchHighlightNode(renderer, this);

      if (!searchHighlightNode) {
        return originalRender.apply(this, args);
      }

      const previousHighlightNode = renderer.highlightNode;
      renderer.highlightNode = searchHighlightNode;
      try {
        if (plugin.isSearchHighlightedNode(renderer, this)) {
          return plugin.renderWithSearchHighlightColor(renderer, () => originalRender.apply(this, args));
        }
        return originalRender.apply(this, args);
      } finally {
        renderer.highlightNode = previousHighlightNode;
      }
    };

    this.nodePatches.set(node, { render: originalRender });
  }

  patchGraphLink(link) {
    if (!link || this.linkPatches.has(link) || typeof link.render !== "function") {
      return;
    }

    const originalRender = link.render;
    const plugin = this;

    link.render = function(...args) {
      const renderer = this.renderer;
      const nativeHighlight = renderer.getHighlightNode?.();
      const highlightedNode = nativeHighlight ? null : plugin.getLinkSearchHighlightNode(renderer, this);

      if (!highlightedNode) {
        return originalRender.apply(this, args);
      }

      const previousHighlightNode = renderer.highlightNode;
      renderer.highlightNode = highlightedNode;
      try {
        return originalRender.apply(this, args);
      } finally {
        renderer.highlightNode = previousHighlightNode;
      }
    };

    this.linkPatches.set(link, { render: originalRender });
  }

  restoreRenderer(renderer) {
    if (!renderer) {
      return;
    }

    const rendererPatch = this.rendererPatches.get(renderer);
    if (rendererPatch) {
      delete renderer.isSearchHighlightedNode;
      delete renderer.isSearchRelatedNode;
      delete renderer.searchHighlightNodeIds;
      delete renderer.searchHighlightNodes;
      delete renderer.searchHighlightColor;
      this.rendererPatches.delete(renderer);
    }

    for (const node of renderer.nodes ?? []) {
      const nodePatch = this.nodePatches.get(node);
      if (nodePatch) {
        node.render = nodePatch.render;
        this.nodePatches.delete(node);
      }
    }

    for (const link of renderer.links ?? []) {
      const linkPatch = this.linkPatches.get(link);
      if (linkPatch) {
        link.render = linkPatch.render;
        this.linkPatches.delete(link);
      }
    }
  }

  isSearchHighlightedNode(renderer, node) {
    return renderer?.searchHighlightNodes?.has(node) === true;
  }

  getFirstSearchHighlightedNode(renderer) {
    const highlights = renderer?.searchHighlightNodes;
    if (!highlights || highlights.size === 0) {
      return null;
    }

    return highlights.values().next().value ?? null;
  }

  getNodeSearchHighlightNode(renderer, node) {
    const firstHighlight = this.getFirstSearchHighlightedNode(renderer);
    if (!firstHighlight) {
      return null;
    }

    if (this.isSearchHighlightedNode(renderer, node)) {
      return node;
    }

    for (const highlighted of renderer.searchHighlightNodes ?? []) {
      if (node.forward?.hasOwnProperty(highlighted.id) || node.reverse?.hasOwnProperty(highlighted.id)) {
        return highlighted;
      }
    }

    return firstHighlight;
  }

  isSearchRelatedNode(renderer, node) {
    if (this.isSearchHighlightedNode(renderer, node)) {
      return true;
    }

    for (const highlighted of renderer?.searchHighlightNodes ?? []) {
      if (node.forward?.hasOwnProperty(highlighted.id) || node.reverse?.hasOwnProperty(highlighted.id)) {
        return true;
      }
    }

    return false;
  }

  getLinkSearchHighlightNode(renderer, link) {
    const firstHighlight = this.getFirstSearchHighlightedNode(renderer);
    if (!firstHighlight) {
      return null;
    }

    if (this.isSearchHighlightedNode(renderer, link.source)) {
      return link.source;
    }
    if (this.isSearchHighlightedNode(renderer, link.target)) {
      return link.target;
    }
    return firstHighlight;
  }

  renderWithSearchHighlightColor(renderer, renderNode) {
    const color = renderer.searchHighlightColor;
    const colors = renderer.colors;
    if (!color || !colors?.fillHighlight) {
      return renderNode();
    }

    const previousFillHighlight = colors.fillHighlight;
    colors.fillHighlight = color;
    try {
      return renderNode();
    } finally {
      colors.fillHighlight = previousFillHighlight;
    }
  }

  createSearchHighlightColor(engine) {
    return {
      a: 1,
      rgb: this.hexToRgb(this.getSearchHighlightColorHex(engine)),
      [SEARCH_HIGHLIGHT_COLOR_MARKER]: true
    };
  }

  getSearchHighlightColorHex(engine) {
    return this.normalizeHexColor(engine.options?.[SEARCH_HIGHLIGHT_COLOR_OPTION]) ?? SEARCH_HIGHLIGHT_DEFAULT_COLOR;
  }

  normalizeHexColor(value) {
    if (typeof value !== "string") {
      return null;
    }

    const color = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      return color.toLowerCase();
    }
    if (/^[0-9a-f]{6}$/i.test(color)) {
      return `#${color.toLowerCase()}`;
    }
    return null;
  }

  hexToRgb(color) {
    return parseInt(color.slice(1), 16);
  }

  refreshGraphSearch(engine) {
    if (typeof engine?.updateSearch === "function") {
      engine.updateSearch();
    } else {
      engine?.requestUpdateSearch?.run?.();
    }
  }

  getGraphEngine(view) {
    const viewType = view?.getViewType?.();
    if (viewType === GRAPH_VIEW_TYPE) {
      return view.dataEngine;
    }
    if (viewType === LOCAL_GRAPH_VIEW_TYPE) {
      return view.engine;
    }
    return null;
  }
};
