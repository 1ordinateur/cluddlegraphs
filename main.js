const { Plugin, Setting } = require("obsidian");

const TARGET_DEPTH = 2;
const GRAPH_VIEW_TYPE = "graph";
const LOCAL_GRAPH_VIEW_TYPE = "localgraph";
const SEARCH_HIGHLIGHT_OPTION = "searchHighlightMode";
const SEARCH_HIGHLIGHT_TOGGLE_CLASS = "cluddlegraphsearch-search-highlight-toggle";
const SEARCH_HIGHLIGHT_SENTINEL = { a: 1, rgb: 0xff00ff };

module.exports = class CluddleGraphSearchPlugin extends Plugin {
  onload() {
    this.pendingLeaves = new WeakSet();
    this.enginePatches = new WeakMap();
    this.rendererPatches = new WeakMap();
    this.nodePatches = new WeakMap();
    this.linkPatches = new WeakMap();

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

      this.addGraphPanelToggle(engine);
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
    if (!childrenEl || childrenEl.querySelector?.(`.${SEARCH_HIGHLIGHT_TOGGLE_CLASS}`)) {
      return;
    }

    const setting = new Setting(childrenEl)
      .setName("Highlight search matches")
      .setDesc("Keep all graph nodes visible and highlight search matches like hovered nodes.")
      .setClass("mod-toggle")
      .setClass(SEARCH_HIGHLIGHT_TOGGLE_CLASS)
      .addToggle((toggle) => {
        toggle
          .setValue(this.isHighlightModeEnabled(engine))
          .onChange((enabled) => {
            this.setHighlightMode(engine, enabled);
          });
      });

    const searchSettingEl = filterOptions.searchSetting?.settingEl;
    if (searchSettingEl?.nextSibling) {
      childrenEl.insertBefore(setting.settingEl, searchSettingEl.nextSibling);
    } else if (searchSettingEl) {
      childrenEl.appendChild(setting.settingEl);
    }
  }

  setHighlightMode(engine, enabled) {
    engine.options[SEARCH_HIGHLIGHT_OPTION] = enabled;
    engine.onOptionsChange?.();
    this.refreshGraphSearch(engine);
  }

  isHighlightModeEnabled(engine) {
    return engine.options?.[SEARCH_HIGHLIGHT_OPTION] === true;
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

    this.clearRendererSearchHighlights(engine.renderer);
    this.restoreRenderer(engine.renderer);
  }

  prepareQueriesForSearchHighlight(engine, queries) {
    if (!this.isHighlightModeEnabled(engine) || !Array.isArray(queries)) {
      return queries;
    }

    return queries.map((query) => {
      if (!query || query.color) {
        return query;
      }

      return { ...query, color: SEARCH_HIGHLIGHT_SENTINEL };
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
      && value.a === SEARCH_HIGHLIGHT_SENTINEL.a
      && value.rgb === SEARCH_HIGHLIGHT_SENTINEL.rgb;
  }

  clearRendererSearchHighlights(renderer) {
    if (!renderer) {
      return;
    }

    if (renderer.searchHighlightNodeIds?.size || renderer.searchHighlightNodes?.size) {
      renderer.searchHighlightNodeIds = new Set();
      renderer.searchHighlightNodes = new Set();
      renderer.changed?.();
    }
  }

  patchRenderer(renderer) {
    if (!renderer || this.rendererPatches.has(renderer)) {
      return;
    }

    const originalGetHighlightNode = renderer.getHighlightNode;
    if (typeof originalGetHighlightNode !== "function") {
      return;
    }

    const plugin = this;
    renderer.getHighlightNode = function(...args) {
      return originalGetHighlightNode.apply(this, args);
    };
    renderer.isSearchHighlightedNode = function(node) {
      return plugin.isSearchHighlightedNode(this, node);
    };
    renderer.isSearchRelatedNode = function(node) {
      return plugin.isSearchRelatedNode(this, node);
    };

    renderer.searchHighlightNodeIds = new Set();
    renderer.searchHighlightNodes = new Set();
    this.rendererPatches.set(renderer, { getHighlightNode: originalGetHighlightNode });
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
      renderer.getHighlightNode = rendererPatch.getHighlightNode;
      delete renderer.isSearchHighlightedNode;
      delete renderer.isSearchRelatedNode;
      delete renderer.searchHighlightNodeIds;
      delete renderer.searchHighlightNodes;
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
