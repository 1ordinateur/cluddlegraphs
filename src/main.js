const { Plugin, Setting } = require("obsidian");
const CanvasGraphController = require("./canvas-graph");
const {
  CanvasEdgeColorController,
  DEFAULT_CANVAS_CONNECTION_COLOR,
  normalizeCanvasColorId,
  normalizeCanvasConnectionColorSettings
} = require("./canvas-edge-colors");
const CluddleGraphsSettingTab = require("./settings");
const {
  CANVAS_CLOUDS_ACTIVE_PROPERTY,
  CANVAS_LINK_COLOR_PROPERTY,
  CANVAS_NODE_LABEL_PROPERTY,
  CANVAS_NODE_SHAPE_PROPERTY,
  CANVAS_ZONE_ATTRACTION_PROPERTY
} = require("./graph-properties");
const { limitLayoutFrames, restoreLayoutFrames } = require("./layout-frame-limit");

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
const GRAPH_NODE_CENTER = 100;
const GRAPH_NODE_RADIUS = 100;
const GRAPH_NODE_DIAMETER = GRAPH_NODE_RADIUS * 2;

module.exports = class CluddleGraphsPlugin extends Plugin {
  async onload() {
    this.unloaded = false;
    this.settings = normalizeCanvasConnectionColorSettings(await this.loadData());
    this.canvasGraph = new CanvasGraphController(this);
    this.canvasEdgeColors = new CanvasEdgeColorController(this);
    this.syncTimeouts = new Set();
    this.pendingLeaves = new WeakSet();
    this.enginePatches = new WeakMap();
    this.rendererPatches = new WeakMap();
    this.nodePatches = new WeakMap();
    this.linkPatches = new WeakMap();
    this.localGraphNodeClickPatches = new WeakMap();
    this.filterControls = new WeakMap();
    this.displayControls = new WeakMap();
    this.resetButtonPatches = new WeakMap();
    this.addSettingTab(new CluddleGraphsSettingTab(this.app, this));

    const syncSoon = () => this.scheduleGraphSync();

    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) {
        return;
      }

      this.canvasGraph.onload();
      syncSoon();
    });
    this.registerEvent(this.app.workspace.on("layout-change", syncSoon));
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncSoon));
  }

  onunload() {
    this.unloaded = true;
    this.canvasEdgeColors?.onunload();
    this.canvasGraph?.onunload?.();
    for (const timeoutId of this.syncTimeouts) {
      window.clearTimeout(timeoutId);
    }
    this.syncTimeouts.clear();

    this.app.workspace.iterateAllLeaves((leaf) => {
      this.restoreGraphEngine(this.getGraphEngine(leaf?.view));
    });
  }

  scheduleGraphSync() {
    for (const delay of [0, 250]) {
      const timeoutId = window.setTimeout(() => {
        this.syncTimeouts.delete(timeoutId);
        if (!this.unloaded) {
          this.syncGraphViews();
        }
      }, delay);
      this.syncTimeouts.add(timeoutId);
    }
  }

  syncGraphViews() {
    if (this.unloaded) {
      return;
    }

    this.canvasEdgeColors.syncCanvasViews();
    this.enforceLocalGraphDepth();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const engine = this.getGraphEngine(leaf?.view);
      if (!engine) {
        return;
      }

      this.initializeSearchHighlightOptions(engine);
      this.canvasGraph.syncEngine(engine);
      this.addGraphPanelToggle(engine);
      this.addGraphDisplayColorPicker(engine);
      this.patchGraphResetButton(engine);
      this.patchGraphEngine(engine);
      this.patchLocalGraphNodeNavigation(engine);
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
    // A re-append of the last child still fires DOM mutation observers.
    if (childrenEl.lastElementChild !== settingEl) {
      childrenEl.appendChild(settingEl);
    }
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
      plugin.syncCanvasGraphSearchMatches(this);
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

    this.restoreLocalGraphNodeNavigation(engine);

    const patch = this.enginePatches.get(engine);
    if (patch) {
      engine.setQuery = patch.setQuery;
      engine.render = patch.render;
      this.enginePatches.delete(engine);
    }

    this.restoreGraphResetButton(engine);
    this.canvasGraph.restoreEngine(engine);
    this.removeGraphPanelControls(engine);
    this.clearRendererSearchHighlights(engine.renderer);
    this.restoreRenderer(engine.renderer);
    engine.render?.();
  }

  async setDefaultCanvasConnectionColor(value) {
    this.settings.defaultCanvasConnectionColor = normalizeCanvasColorId(
      value,
      DEFAULT_CANVAS_CONNECTION_COLOR
    );
    await this.saveData(this.settings);
  }

  async setCanvasConnectionColorMapping(sourceColor, connectionColor) {
    const source = normalizeCanvasColorId(sourceColor, null);
    if (source === null) {
      return;
    }

    const mappings = { ...this.settings.canvasConnectionColorByNodeColor };
    if (connectionColor === null || connectionColor === undefined || connectionColor === "") {
      delete mappings[source];
    } else {
      const target = normalizeCanvasColorId(connectionColor, null);
      if (target === null) {
        return;
      }
      mappings[source] = target;
    }

    this.settings.canvasConnectionColorByNodeColor = mappings;
    await this.saveData(this.settings);
  }

  patchLocalGraphNodeNavigation(engine) {
    if (engine?.view?.getViewType?.() !== LOCAL_GRAPH_VIEW_TYPE
      || typeof engine.renderer?.onNodeClick !== "function"
      || this.localGraphNodeClickPatches.has(engine)) {
      return;
    }

    const renderer = engine.renderer;
    const originalOnNodeClick = renderer.onNodeClick;
    const plugin = this;
    const patchedOnNodeClick = function(event, path, nodeType) {
      const usesNativeNavigation = (typeof event?.button === "number" && event.button !== 0)
        || !!event?.shiftKey
        || !!event?.altKey;
      if (nodeType === "tag" || usesNativeNavigation) {
        return originalOnNodeClick.call(this, event, path, nodeType);
      }

      const targetLeaf = plugin.getMainEditorLeaf();
      const file = plugin.app.metadataCache.getFirstLinkpathDest(path, "");
      if (!targetLeaf || !file || typeof targetLeaf.openFile !== "function") {
        return originalOnNodeClick.call(this, event, path, nodeType);
      }

      plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
      return targetLeaf.openFile(file, { active: true });
    };
    renderer.onNodeClick = patchedOnNodeClick;

    this.localGraphNodeClickPatches.set(engine, {
      originalOnNodeClick,
      patchedOnNodeClick,
      renderer
    });
  }

  restoreLocalGraphNodeNavigation(engine) {
    const patch = this.localGraphNodeClickPatches.get(engine);
    if (!patch) {
      return;
    }
    if (patch.renderer.onNodeClick === patch.patchedOnNodeClick) {
      patch.renderer.onNodeClick = patch.originalOnNodeClick;
    }
    this.localGraphNodeClickPatches.delete(engine);
  }

  getMainEditorLeaf() {
    const workspace = this.app.workspace;
    const rootSplit = workspace.rootSplit;
    const mostRecentLeaf = workspace.getMostRecentLeaf?.(rootSplit);
    if (this.isMainEditorTargetLeaf(mostRecentLeaf)) {
      return mostRecentLeaf;
    }

    let targetLeaf = null;
    workspace.iterateRootLeaves?.((leaf) => {
      if (this.isMainEditorTargetLeaf(leaf)
        && (!targetLeaf || (leaf.activeTime ?? 0) > (targetLeaf.activeTime ?? 0))) {
        targetLeaf = leaf;
      }
    });
    if (targetLeaf) {
      return targetLeaf;
    }

    if (mostRecentLeaf?.parent && typeof workspace.createLeafInTabGroup === "function") {
      return workspace.createLeafInTabGroup(mostRecentLeaf.parent);
    }
    if (rootSplit && typeof workspace.createLeafInParent === "function") {
      return workspace.createLeafInParent(rootSplit, rootSplit.children?.length ?? 0);
    }
    return null;
  }

  isMainEditorTargetLeaf(leaf) {
    if (!leaf || this.app.workspace.isInSidebar?.(leaf)) {
      return false;
    }
    const viewType = leaf.view?.getViewType?.();
    if (viewType === GRAPH_VIEW_TYPE || viewType === LOCAL_GRAPH_VIEW_TYPE) {
      return false;
    }
    return typeof leaf.canNavigate === "function" ? leaf.canNavigate() : leaf.view?.navigation !== false;
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
    this.canvasGraph.cacheGraphColorQueries(engine, queries);
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

  syncCanvasGraphSearchMatches(engine) {
    const matchValue = this.isHighlightModeEnabled(engine)
      ? this.createSearchHighlightColor(engine)
      : true;
    this.canvasGraph.syncSearchMatches(engine, matchValue);
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
    const color = this.createSearchHighlightColor(engine);
    const nodes = new Set(
      Array.from(ids)
        .map((id) => renderer.nodeLookup?.[id])
        .filter(Boolean)
    );
    // Each wake makes the native loop draw the full graph for 61 frames, so wake it only for a new highlight.
    const highlightChanged = !this.isSameSearchHighlight(renderer, nodes, color);
    renderer.searchHighlightColor = color;
    renderer.searchHighlightNodeIds = ids;
    renderer.searchHighlightNodes = nodes;
    renderer.searchHighlightNeighbors = this.getSearchHighlightNeighbors(renderer, nodes);
    if (highlightChanged) {
      renderer.changed?.();
    }
  }

  isSameSearchHighlight(renderer, nodes, color) {
    const previousColor = renderer.searchHighlightColor;
    const previousNodes = renderer.searchHighlightNodes;
    return previousColor?.a === color?.a
      && previousColor?.rgb === color?.rgb
      && previousNodes?.size === nodes.size
      && [...nodes].every((node) => previousNodes.has(node));
  }

  // Map each neighbour to the first highlighted node that links to it, in highlight order.
  getSearchHighlightNeighbors(renderer, highlights) {
    const neighbors = new Map();
    for (const highlighted of highlights) {
      for (const related of [highlighted.forward, highlighted.reverse]) {
        for (const id of Object.keys(related ?? {})) {
          const node = renderer.nodeLookup?.[id];
          if (node && !neighbors.has(node)) {
            neighbors.set(node, highlighted);
          }
        }
      }
    }
    return neighbors;
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
      renderer.searchHighlightNeighbors = new Map();
      renderer.searchHighlightColor = null;
      renderer.changed?.();
    }
  }

  patchRenderer(renderer) {
    if (!renderer || this.rendererPatches.has(renderer)) {
      return;
    }

    limitLayoutFrames(renderer);
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
    renderer.searchHighlightNeighbors = new Map();
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
    const originalInitGraphics = typeof node.initGraphics === "function" ? node.initGraphics : null;
    const originalGetDisplayText = typeof node.getDisplayText === "function" ? node.getDisplayText : null;
    const plugin = this;

    if (originalInitGraphics) {
      node.initGraphics = function(...args) {
        const result = originalInitGraphics.apply(this, args);
        plugin.drawCanvasGraphNodeShape(this);
        return result;
      };
    }

    if (originalGetDisplayText) {
      node.getDisplayText = function(...args) {
        if (this[CANVAS_NODE_LABEL_PROPERTY]) {
          return this[CANVAS_NODE_LABEL_PROPERTY];
        }
        return originalGetDisplayText.apply(this, args);
      };
    }

    // Obsidian calls this for every node in each animation frame. Keep the usual path to the native render.
    node.render = function() {
      const renderer = this.renderer;
      if (renderer?.[CANVAS_CLOUDS_ACTIVE_PROPERTY]) {
        plugin.canvasGraph.requestMembershipCloudSync(renderer);
      }
      if (!renderer?.searchHighlightNodes?.size || renderer.getHighlightNode?.()) {
        return originalRender.apply(this, arguments);
      }
      return plugin.renderNodeWithSearchHighlight(renderer, this, originalRender, arguments);
    };

    this.nodePatches.set(node, {
      render: originalRender,
      initGraphics: originalInitGraphics,
      getDisplayText: originalGetDisplayText
    });
  }

  renderNodeWithSearchHighlight(renderer, node, originalRender, args) {
    const previousHighlightNode = renderer.highlightNode;
    renderer.highlightNode = this.getNodeSearchHighlightNode(renderer, node);
    try {
      if (this.isSearchHighlightedNode(renderer, node)) {
        return this.renderWithSearchHighlightColor(renderer, () => originalRender.apply(node, args));
      }
      return originalRender.apply(node, args);
    } finally {
      renderer.highlightNode = previousHighlightNode;
    }
  }

  patchGraphLink(link) {
    if (!link || this.linkPatches.has(link) || typeof link.render !== "function") {
      return;
    }

    const originalRender = link.render;
    const plugin = this;

    // Obsidian calls this for every link in each animation frame. Keep the usual path to the native render.
    link.render = function() {
      if (this[CANVAS_ZONE_ATTRACTION_PROPERTY]) {
        plugin.hideCanvasGraphLink(this);
        return undefined;
      }

      const renderer = this.renderer;
      const highlightedNode = renderer?.searchHighlightNodes?.size && !renderer.getHighlightNode?.()
        ? plugin.getLinkSearchHighlightNode(renderer, this)
        : null;
      let result;
      if (highlightedNode) {
        const previousHighlightNode = renderer.highlightNode;
        renderer.highlightNode = highlightedNode;
        try {
          result = originalRender.apply(this, arguments);
        } finally {
          renderer.highlightNode = previousHighlightNode;
        }
      } else {
        result = originalRender.apply(this, arguments);
      }

      plugin.applyCanvasGraphLinkTint(this);
      return result;
    };

    this.linkPatches.set(link, { render: originalRender });
  }

  // The native render sets these flags again in each frame after the link stops being a hidden zone link.
  hideCanvasGraphLink(link) {
    for (const item of [link.line, link.arrow]) {
      if (item && item.visible !== false) {
        item.visible = false;
      }
    }
  }

  // The native render moves the tint toward the theme line colour, so write the Canvas colour after it.
  applyCanvasGraphLinkTint(link) {
    const color = link[CANVAS_LINK_COLOR_PROPERTY];
    if (typeof color !== "number") {
      return;
    }
    if (link.line) {
      link.line.tint = color;
    }
    if (link.arrow) {
      link.arrow.tint = color;
    }
  }

  restoreRenderer(renderer) {
    if (!renderer) {
      return;
    }

    restoreLayoutFrames(renderer);
    const rendererPatch = this.rendererPatches.get(renderer);
    if (rendererPatch) {
      delete renderer.isSearchHighlightedNode;
      delete renderer.isSearchRelatedNode;
      delete renderer.searchHighlightNodeIds;
      delete renderer.searchHighlightNodes;
      delete renderer.searchHighlightNeighbors;
      delete renderer.searchHighlightColor;
      this.rendererPatches.delete(renderer);
    }

    for (const node of renderer.nodes ?? []) {
      const nodePatch = this.nodePatches.get(node);
      if (nodePatch) {
        node.render = nodePatch.render;
        if (nodePatch.initGraphics) {
          node.initGraphics = nodePatch.initGraphics;
        }
        if (nodePatch.getDisplayText) {
          node.getDisplayText = nodePatch.getDisplayText;
        }
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

    return renderer.searchHighlightNeighbors?.get(node) ?? firstHighlight;
  }

  isSearchRelatedNode(renderer, node) {
    return this.isSearchHighlightedNode(renderer, node)
      || renderer?.searchHighlightNeighbors?.has(node) === true;
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

  // Draw a shape in white one time for each graphics object. The native render colours it with the tint.
  // The native initGraphics draws a white circle, so a "circle" shape needs no draw.
  // Return true when the shape is drawn again.
  drawCanvasGraphNodeShape(node) {
    const graphics = node?.circle;
    if (!graphics || typeof graphics.clear !== "function") {
      return false;
    }

    const shape = node[CANVAS_NODE_SHAPE_PROPERTY] || "circle";
    this.drawnGraphNodeShapes ??= new WeakMap();
    if ((this.drawnGraphNodeShapes.get(graphics) ?? "circle") === shape) {
      return false;
    }

    graphics.clear();
    graphics.beginFill?.(0xffffff, 1);

    if (shape === "circle") {
      graphics.drawCircle?.(GRAPH_NODE_CENTER, GRAPH_NODE_CENTER, GRAPH_NODE_RADIUS);
    } else if (shape === "square" && typeof graphics.drawRect === "function") {
      graphics.drawRect(0, 0, GRAPH_NODE_DIAMETER, GRAPH_NODE_DIAMETER);
    } else {
      const sides = shape === "triangle" ? 3 : shape === "pentagon" ? 5 : shape === "hexagon" ? 6 : 4;
      this.drawRegularGraphPolygon(graphics, sides);
    }

    graphics.endFill?.();
    this.drawnGraphNodeShapes.set(graphics, shape);
    return true;
  }

  drawRegularGraphPolygon(graphics, sides) {
    const startAngle = -Math.PI / 2;
    let firstX = 0;
    let firstY = 0;

    for (let index = 0; index < sides; index++) {
      const angle = startAngle + (Math.PI * 2 * index) / sides;
      const x = GRAPH_NODE_CENTER + Math.cos(angle) * GRAPH_NODE_RADIUS;
      const y = GRAPH_NODE_CENTER + Math.sin(angle) * GRAPH_NODE_RADIUS;

      if (index === 0) {
        firstX = x;
        firstY = y;
        graphics.moveTo?.(x, y);
      } else {
        graphics.lineTo?.(x, y);
      }
    }

    graphics.lineTo?.(firstX, firstY);
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

  resolveCssColor(color, doc = document) {
    const hexColor = this.normalizeHexColor(color);
    if (hexColor) {
      return hexColor;
    }

    const el = doc.createElement("div");
    el.style.color = color;
    el.style.display = "none";
    doc.body.appendChild(el);

    try {
      const resolvedColor = (doc.defaultView ?? window).getComputedStyle(el).color;
      const match = resolvedColor.match(/^rgba?\(\s*(\d+)(?:,|\s+)\s*(\d+)(?:,|\s+)\s*(\d+)/);
      if (!match) {
        return null;
      }
      const rgb = (parseInt(match[1], 10) << 16) + (parseInt(match[2], 10) << 8) + parseInt(match[3], 10);
      return `#${rgb.toString(16).padStart(6, "0")}`;
    } finally {
      this.detachElement(el);
    }
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

  hasOpenGraphView() {
    let hasGraphView = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const viewType = leaf?.view?.getViewType?.();
      if (viewType === GRAPH_VIEW_TYPE || viewType === LOCAL_GRAPH_VIEW_TYPE) {
        hasGraphView = true;
      }
    });
    return hasGraphView;
  }

  renderOpenGraphViews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const engine = this.getGraphEngine(leaf?.view);
      engine?.render?.();
    });
  }
};
