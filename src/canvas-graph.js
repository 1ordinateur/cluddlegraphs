const { Setting, TFile, setIcon } = require("obsidian");
const {
  CANVAS_CLOUDS_ACTIVE_PROPERTY,
  CANVAS_LINK_COLOR_PROPERTY,
  CANVAS_NODE_LABEL_PROPERTY,
  CANVAS_NODE_SHAPE_PROPERTY,
  CANVAS_ZONE_ATTRACTION_PROPERTY
} = require("./graph-properties");

const CANVAS_LINK_MODE_OPTION = "cluddlegraphsCanvasLinkMode";
const CANVAS_LINK_COLOR_OPTION = "cluddlegraphsCanvasLinkColor";
const CANVAS_CARDS_OPTION = "cluddlegraphsCanvasCards";
const CANVAS_PARENT_MEMBERSHIPS_OPTION = "cluddlegraphsCanvasParentMemberships";
const CANVAS_GROUP_MEMBERSHIPS_OPTION = "cluddlegraphsCanvasGroupMemberships";
const CANVAS_MEMBERSHIP_CLOUDS_OPTION = "cluddlegraphsCanvasMembershipClouds";
const CANVAS_INHERIT_CARD_COLORS_OPTION = "cluddlegraphsCanvasInheritCardColors";
const CANVAS_NODE_SHAPE_OPTIONS = {
  file: "cluddlegraphsCanvasFileNodeShape",
  text: "cluddlegraphsCanvasTextNodeShape",
  link: "cluddlegraphsCanvasLinkNodeShape",
  group: "cluddlegraphsCanvasGroupNodeShape"
};
const CANVAS_LINK_MODE_DEFAULT = "hide";
const CANVAS_LINK_COLOR_DEFAULT = "#7c3aed";
const CANVAS_NODE_SHAPE_DEFAULTS = {
  file: "circle",
  text: "square",
  link: "square",
  group: "square"
};
const CANVAS_NODE_TYPES = ["file", "text", "link", "group"];
const CANVAS_SHAPES = ["circle", "triangle", "square", "pentagon", "hexagon"];
const CANVAS_NODE_TYPE_LABELS = {
  file: "File nodes",
  text: "Text cards",
  link: "URL cards",
  group: "Group cards"
};
const CANVAS_GRAPH_ONLY_NODE_PREFIX = "cluddlegraphs-canvas-node";
const CANVAS_OPTIONS_GROUP_CLASS = "cluddlegraphs-canvas-options-group";
const CANVAS_FILTER_GROUP_CLASS = "cluddlegraphs-canvas-filter-group";
const CANVAS_DISPLAY_GROUP_CLASS = "cluddlegraphs-canvas-display-group";
const CANVAS_OPTIONS_GROUP_SUMMARY_CLASS = "cluddlegraphs-canvas-options-group-summary";
const CANVAS_OPTIONS_GROUP_CONTENT_CLASS = "cluddlegraphs-canvas-options-group-content";
const CANVAS_OPTIONS_GROUP_TITLE = "Cluddlegraph";
const NATIVE_CANVAS_LINKS_CLASS = "cluddlegraphs-native-canvas-links";
const CANVAS_LINK_MODE_CLASS = "cluddlegraphs-canvas-link-mode";
const CANVAS_CARDS_CLASS = "cluddlegraphs-canvas-cards";
const LEGACY_CANVAS_PARENT_MEMBERSHIPS_CLASS = "cluddlegraphs-canvas-parent-memberships";
const CANVAS_GROUP_MEMBERSHIPS_CLASS = "cluddlegraphs-canvas-group-memberships";
const CANVAS_LINK_COLOR_CLASS = "cluddlegraphs-canvas-link-color";
const CANVAS_MEMBERSHIP_CLOUDS_CLASS = "cluddlegraphs-canvas-membership-clouds";
const CANVAS_INHERIT_CARD_COLORS_CLASS = "cluddlegraphs-canvas-inherit-card-colors";
const CANVAS_NODE_SHAPE_CLASS_PREFIX = "cluddlegraphs-canvas-node-shape";
const CANVAS_RENDER_LOADING_CLASS = "cluddlegraphs-canvas-render-loading";
const CANVAS_RENDER_READY_CLASS = "cluddlegraphs-canvas-render-ready";
const GROUP_MEMBERSHIP_METADATA_VERSION = 2;
const CANVAS_GROUP_TOP_EXTENSION = 20;
const UNRESOLVED_CANVAS_COLOR = 0x010203;
const DEFAULT_LOCAL_CANVAS_DEPTH = 2;
const GRAPH_NODE_CENTER = 100;
const CANVAS_CLOUD_PADDING = GRAPH_NODE_CENTER + 12;
const CANVAS_CLOUD_ALPHA = 0.12;
const CANVAS_CLOUD_LINE_ALPHA = 0.35;
const CANVAS_CLOUD_LINE_WIDTH = 4;
const CANVAS_CLOUD_MIN_MARGIN = 4;
const CANVAS_CLOUD_MARGIN_RATIO = 0.12;
const CANVAS_CLOUD_CORNER_SEGMENTS = 4;
const CANVAS_CLOUD_CIRCLE_SEGMENTS = 20;
const CANVAS_RENDER_FADE_MS = 220;
const CANVAS_ZONE_SETTLE_MS = 180;
const CANVAS_HYDRATION_DEBOUNCE_MS = 300;
const CANVAS_HYDRATION_MAX_WAIT_MS = 2000;

const CANVAS_LINK_MODE_LABELS = {
  all: "All links",
  hide: "Hide canvas links",
  only: "Canvas links only"
};

const CANVAS_SHAPE_LABELS = {
  circle: "Circle",
  triangle: "Triangle",
  square: "Square",
  pentagon: "Pentagon",
  hexagon: "Hexagon"
};

module.exports = class CanvasGraphController {
  constructor(plugin) {
    this.plugin = plugin;
    this.rendererPatches = new WeakMap();
    this.rendererEngines = new WeakMap();
    this.graphColorQueries = new WeakMap();
    this.zoneAttractionLinkKeys = new WeakMap();
    this.cloudLayers = new WeakMap();
    this.cloudSyncFrames = new WeakMap();
    this.cloudSyncTimers = new WeakMap();
    this.cloudReadyAt = new WeakMap();
    this.rendererFadeFrames = new WeakMap();
    this.rendererRefreshFrames = new WeakMap();
    this.filterControls = new WeakMap();
    this.filterGroups = new WeakMap();
    this.nativeCanvasLinksControlBindings = new WeakMap();
    this.groupVisibilityObservers = new WeakMap();
    this.displayControls = new WeakMap();
    this.displayGroups = new WeakMap();
    this.injectedCanvasLinkKeys = new WeakMap();
    this.decoratedLinkRenderers = new WeakSet();
    this.searchMatches = new WeakMap();
    this.canvasGraphLinks = {};
    this.canvasGraphLinkRevision = 0;
    this.canvasGraphLinkIndex = null;
    this.canvasGraphLinkProjectionCache = new Map();
    this.canvasGraphNodes = {};
    this.canvasMemberships = {};
    this.hydration = null;
    this.hydrated = false;
    this.needsHydration = true;
    this.suppressHydrationRequests = false;
  }

  onload() {
    if (this.eventsRegistered) {
      return;
    }
    this.eventsRegistered = true;

    const app = this.plugin.app;
    this.plugin.registerEvent(app.vault.on("create", (file) => {
      if (file instanceof TFile) {
        this.requestHydrationForPaths([file.path]);
      }
    }));
    this.plugin.registerEvent(app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "canvas") {
        this.requestHydration({ canvasPaths: [file.path] });
      }
    }));
    this.plugin.registerEvent(app.vault.on("delete", (file) => {
      if (file instanceof TFile) {
        this.requestHydrationForPaths([file.path]);
      } else {
        this.requestHydration();
      }
    }));
    this.plugin.registerEvent(app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) {
        this.requestHydrationForPaths([oldPath, file.path]);
      } else {
        this.requestHydration();
      }
    }));
    this.plugin.registerEvent(app.workspace.on("css-change", () => {
      this.clearCanvasColorCache();
      if (this.hasOpenGraphView()) {
        this.renderOpenGraphViews();
      }
    }));
  }

  onunload() {
    if (this.hydrationTimer) {
      clearTimeout(this.hydrationTimer);
      this.hydrationTimer = null;
    }
    this.hydrationDeadline = null;
    this.pendingHydration = null;
    this.unloaded = true;
  }

  // Reload each Canvas that is a changed vault path or that refers to one.
  // The reload maps the paths to Canvases when it runs, so that it uses the newest references.
  requestHydrationForPaths(paths) {
    const changedPaths = paths.filter((path) => typeof path === "string" && path);
    if (changedPaths.length > 0) {
      this.requestHydration({ changedPaths });
    }
  }

  // Without a request, reload every Canvas. A request has canvasPaths to reload,
  // and changedPaths that go to the Canvases that refer to them.
  requestHydration(request) {
    if (this.suppressHydrationRequests || !this.hasOpenGraphView()) {
      if (this.isHydrationRequestRelevant(request)) {
        this.needsHydration = true;
      }
      return;
    }

    this.queueHydration(request);
    if (this.hydrationTimer) {
      clearTimeout(this.hydrationTimer);
    }
    // A stream of events cannot stop the reload for more than the maximum wait.
    const now = Date.now();
    this.hydrationDeadline ??= now + CANVAS_HYDRATION_MAX_WAIT_MS;
    const delay = Math.max(0, Math.min(CANVAS_HYDRATION_DEBOUNCE_MS, this.hydrationDeadline - now));
    this.hydrationTimer = setTimeout(() => {
      this.hydrationTimer = null;
      this.hydrationDeadline = null;
      void this.startHydration();
    }, delay);
  }

  // A request that cannot change the Canvas data does not make a full reload necessary later.
  isHydrationRequestRelevant(request) {
    return request === undefined
      || !this.hydrated
      || Boolean(this.hydration)
      || this.getHydrationCanvasPaths(request).length > 0;
  }

  queueHydration(request) {
    this.pendingHydration ??= { full: false, canvasPaths: new Set(), changedPaths: new Set() };
    if (request === undefined) {
      this.pendingHydration.full = true;
      return;
    }
    for (const path of request.canvasPaths ?? []) {
      this.pendingHydration.canvasPaths.add(path);
    }
    for (const path of request.changedPaths ?? []) {
      this.pendingHydration.changedPaths.add(path);
    }
  }

  getHydrationCanvasPaths(request) {
    const changedPaths = [...(request.changedPaths ?? [])];
    const canvasPaths = new Set([...(request.canvasPaths ?? []), ...this.getCanvasPathsReferencing(changedPaths)]);
    for (const path of changedPaths) {
      if (this.isCanvasPath(path)) {
        canvasPaths.add(path);
      }
    }
    return [...canvasPaths];
  }

  getCanvasPathsReferencing(paths) {
    const targets = new Set(paths.map((path) => this.getCanvasReferenceKey(path)));
    const canvasPaths = [];
    for (const [canvasPath, references] of Object.entries(this.canvasReferences ?? {})) {
      if (references.some((reference) => targets.has(reference))) {
        canvasPaths.push(canvasPath);
      }
    }
    return canvasPaths;
  }

  // Obsidian can resolve a link by its file name and without letter case, so match references by the
  // lower-case file name. A match on a file name in a different folder only causes an extra reload.
  getCanvasReferenceKey(path) {
    return String(path).split("/").pop().toLowerCase();
  }

  isCanvasPath(path) {
    return String(path).toLowerCase().endsWith(".canvas");
  }

  syncEngine(engine) {
    this.initializeOptions(engine);
    this.addFilterControls(engine);
    this.addDisplayControls(engine);
    this.patchRenderer(engine);

    if (!this.hydrated) {
      this.markRendererHydrating(engine?.renderer);
    }
    if (!this.hydration && (!this.hydrated || this.needsHydration)) {
      void this.hydrate();
    }
  }

  restoreEngine(engine) {
    const renderer = engine?.renderer;
    const patch = renderer ? this.rendererPatches.get(renderer) : null;
    if (patch) {
      renderer.setData = patch.setData;
      if (patch.changed) {
        renderer.changed = patch.changed;
      }
      this.rendererPatches.delete(renderer);
    }

    this.cancelRendererVisualRefresh(renderer);
    this.cancelRendererFade(renderer);
    this.cancelMembershipCloudSync(renderer);
    this.clearMembershipClouds(renderer);
    this.clearRendererLoadingState(renderer);
    this.zoneAttractionLinkKeys.delete(engine);
    this.injectedCanvasLinkKeys.delete(engine);
    if (renderer) {
      this.rendererEngines.delete(renderer);
      this.decoratedLinkRenderers.delete(renderer);
    }
    this.clearSearchMatches(engine);
    this.removeControls(engine);
    this.clearRendererMetadata(renderer);
    this.graphColorQueries.delete(engine);
  }

  initializeOptions(engine) {
    const savedOptions = this.plugin.getSavedGraphOptions(engine) ?? {};
    engine.options[CANVAS_LINK_MODE_OPTION] =
      this.parseLinkMode(engine.options?.[CANVAS_LINK_MODE_OPTION])
      ?? this.parseLinkMode(savedOptions[CANVAS_LINK_MODE_OPTION])
      ?? CANVAS_LINK_MODE_DEFAULT;
    engine.options[CANVAS_LINK_COLOR_OPTION] =
      this.plugin.normalizeHexColor(engine.options?.[CANVAS_LINK_COLOR_OPTION])
      ?? this.plugin.normalizeHexColor(savedOptions[CANVAS_LINK_COLOR_OPTION])
      ?? this.getDefaultCanvasLinkColor(engine);
    engine.options[CANVAS_CARDS_OPTION] =
      typeof engine.options?.[CANVAS_CARDS_OPTION] === "boolean"
        ? engine.options[CANVAS_CARDS_OPTION]
        : savedOptions[CANVAS_CARDS_OPTION] !== false;
    // Obsidian's native Canvas-link toggle is the single source of truth. Start
    // enabled only before its state has been synchronized; repeated engine
    // synchronization must preserve the user's current visible toggle value.
    engine.options[CANVAS_PARENT_MEMBERSHIPS_OPTION] =
      typeof engine.options?.[CANVAS_PARENT_MEMBERSHIPS_OPTION] === "boolean"
        ? engine.options[CANVAS_PARENT_MEMBERSHIPS_OPTION]
        : true;
    engine.options[CANVAS_GROUP_MEMBERSHIPS_OPTION] =
      typeof engine.options?.[CANVAS_GROUP_MEMBERSHIPS_OPTION] === "boolean"
        ? engine.options[CANVAS_GROUP_MEMBERSHIPS_OPTION]
        : savedOptions[CANVAS_GROUP_MEMBERSHIPS_OPTION] !== false;
    engine.options[CANVAS_MEMBERSHIP_CLOUDS_OPTION] =
      typeof engine.options?.[CANVAS_MEMBERSHIP_CLOUDS_OPTION] === "boolean"
        ? engine.options[CANVAS_MEMBERSHIP_CLOUDS_OPTION]
        : savedOptions[CANVAS_MEMBERSHIP_CLOUDS_OPTION] === true;
    engine.options[CANVAS_INHERIT_CARD_COLORS_OPTION] =
      typeof engine.options?.[CANVAS_INHERIT_CARD_COLORS_OPTION] === "boolean"
        ? engine.options[CANVAS_INHERIT_CARD_COLORS_OPTION]
        : savedOptions[CANVAS_INHERIT_CARD_COLORS_OPTION] !== false;

    for (const type of CANVAS_NODE_TYPES) {
      const option = CANVAS_NODE_SHAPE_OPTIONS[type];
      engine.options[option] =
        this.parseShape(engine.options?.[option])
        ?? this.parseShape(savedOptions[option])
        ?? CANVAS_NODE_SHAPE_DEFAULTS[type];
    }
  }

  addFilterControls(engine) {
    const filterOptions = engine.filterOptions;
    const childrenEl = filterOptions?.childrenEl;
    if (!childrenEl) {
      return;
    }

    const group = this.ensureCanvasOptionsGroup(engine, this.getCanvasOptionsParent(engine, childrenEl));
    group.nativeControlEl = this.syncNativeCanvasLinksControl(childrenEl, group.contentEl, engine);
    const contentEl = group.contentEl;

    const trackedControls = this.filterControls.get(engine);
    if (trackedControls?.every((setting) => setting.settingEl.parentElement === contentEl)) {
      return;
    }

    this.detachTrackedControls(trackedControls);
    this.removeExistingControls(
      childrenEl,
      [CANVAS_LINK_MODE_CLASS, CANVAS_CARDS_CLASS, LEGACY_CANVAS_PARENT_MEMBERSHIPS_CLASS, CANVAS_GROUP_MEMBERSHIPS_CLASS],
      []
    );
    this.removeExistingControls(
      contentEl,
      [CANVAS_LINK_MODE_CLASS, CANVAS_CARDS_CLASS, LEGACY_CANVAS_PARENT_MEMBERSHIPS_CLASS, CANVAS_GROUP_MEMBERSHIPS_CLASS],
      []
    );
    delete filterOptions.optionListeners[CANVAS_PARENT_MEMBERSHIPS_OPTION];

    const linkModeSetting = new Setting(contentEl)
      .setName("Edge links")
      .setClass(CANVAS_LINK_MODE_CLASS)
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(CANVAS_LINK_MODE_LABELS)) {
          dropdown.addOption(value, label);
        }

        dropdown
          .setValue(this.getLinkMode(engine))
          .onChange((value) => {
            engine.options[CANVAS_LINK_MODE_OPTION] = this.parseLinkMode(value) ?? CANVAS_LINK_MODE_DEFAULT;
            engine.render?.();
            engine.onOptionsChange?.();
          });

        filterOptions.optionListeners[CANVAS_LINK_MODE_OPTION] = (value) => {
          const mode = this.parseLinkMode(value);
          if (mode) {
            engine.options[CANVAS_LINK_MODE_OPTION] = mode;
            dropdown.setValue(mode);
            engine.render?.();
          }
          return this.getLinkMode(engine);
        };
      });

    const cardsSetting = new Setting(contentEl)
      .setName("Cards")
      .setClass("mod-toggle")
      .setClass(CANVAS_CARDS_CLASS)
      .addToggle((toggle) => {
        toggle
          .setValue(this.shouldShowCards(engine))
          .onChange((enabled) => {
            engine.options[CANVAS_CARDS_OPTION] = enabled;
            engine.render?.();
            engine.onOptionsChange?.();
          });

        filterOptions.optionListeners[CANVAS_CARDS_OPTION] = (value) => {
          if (typeof value === "boolean") {
            engine.options[CANVAS_CARDS_OPTION] = value;
            toggle.setValue(value);
            engine.render?.();
          }
          return this.shouldShowCards(engine);
        };
      });

    const groupMembershipSetting = new Setting(contentEl)
      .setName("Groups")
      .setClass("mod-toggle")
      .setClass(CANVAS_GROUP_MEMBERSHIPS_CLASS)
      .addToggle((toggle) => {
        toggle
          .setValue(this.shouldShowGroupMemberships(engine))
          .onChange((enabled) => {
            engine.options[CANVAS_GROUP_MEMBERSHIPS_OPTION] = enabled;
            engine.render?.();
            engine.onOptionsChange?.();
          });

        filterOptions.optionListeners[CANVAS_GROUP_MEMBERSHIPS_OPTION] = (value) => {
          if (typeof value === "boolean") {
            engine.options[CANVAS_GROUP_MEMBERSHIPS_OPTION] = value;
            toggle.setValue(value);
            engine.render?.();
          }
          return this.shouldShowGroupMemberships(engine);
        };
      });

    this.filterControls.set(engine, [linkModeSetting, cardsSetting, groupMembershipSetting]);
  }

  addDisplayControls(engine) {
    const displayOptions = engine.displayOptions;
    const childrenEl = displayOptions?.childrenEl;
    if (!childrenEl) {
      return;
    }

    this.removeLegacyCanvasDisplayGroup(engine, childrenEl);
    const group = this.ensureCanvasOptionsGroup(engine, this.getCanvasOptionsParent(engine, childrenEl));
    const contentEl = group.contentEl;

    const trackedControls = this.displayControls.get(engine);
    if (trackedControls?.every((setting) => setting.settingEl.parentElement === contentEl)) {
      return;
    }

    this.detachTrackedControls(trackedControls);
    this.removeExistingControls(
      childrenEl,
      [
        CANVAS_LINK_COLOR_CLASS,
        CANVAS_MEMBERSHIP_CLOUDS_CLASS,
        CANVAS_INHERIT_CARD_COLORS_CLASS,
        ...CANVAS_NODE_TYPES.map((type) => `${CANVAS_NODE_SHAPE_CLASS_PREFIX}-${type}`)
      ],
      []
    );
    this.removeExistingControls(
      contentEl,
      [
        CANVAS_LINK_COLOR_CLASS,
        CANVAS_MEMBERSHIP_CLOUDS_CLASS,
        CANVAS_INHERIT_CARD_COLORS_CLASS,
        ...CANVAS_NODE_TYPES.map((type) => `${CANVAS_NODE_SHAPE_CLASS_PREFIX}-${type}`)
      ],
      []
    );

    const colorSetting = new Setting(contentEl)
      .setName("Canvas link color")
      .setClass(CANVAS_LINK_COLOR_CLASS)
      .addColorPicker((colorPicker) => {
        colorPicker
          .setValue(this.getLinkColor(engine))
          .onChange((value) => {
            const color = this.plugin.normalizeHexColor(value);
            if (!color) {
              return;
            }

            engine.options[CANVAS_LINK_COLOR_OPTION] = color;
            engine.render?.();
            engine.onOptionsChange?.();
          });

        displayOptions.optionListeners[CANVAS_LINK_COLOR_OPTION] = (value) => {
          const color = this.plugin.normalizeHexColor(value);
          if (color) {
            engine.options[CANVAS_LINK_COLOR_OPTION] = color;
            colorPicker.setValue(color);
            engine.render?.();
          }
          return this.getLinkColor(engine);
        };
      });

    const membershipCloudsSetting = new Setting(contentEl)
      .setName("Canvas zones")
      .setDesc("Show compact Canvas membership regions and cluster same-Canvas members while enabled.")
      .setClass("mod-toggle")
      .setClass(CANVAS_MEMBERSHIP_CLOUDS_CLASS)
      .addToggle((toggle) => {
        toggle
          .setValue(this.shouldShowMembershipClouds(engine))
          .onChange((enabled) => {
            this.setMembershipCloudsOption(engine, enabled);
            engine.onOptionsChange?.();
          });

        displayOptions.optionListeners[CANVAS_MEMBERSHIP_CLOUDS_OPTION] = (value) => {
          if (typeof value === "boolean") {
            toggle.setValue(value);
            this.setMembershipCloudsOption(engine, value);
          }
          return this.shouldShowMembershipClouds(engine);
        };
      });

    const inheritCardColorsSetting = new Setting(contentEl)
      .setName("Inherit card colors")
      .setDesc("Use the parent Canvas node color for Canvas card and group nodes. Turn off to use graph group colors.")
      .setClass("mod-toggle")
      .setClass(CANVAS_INHERIT_CARD_COLORS_CLASS)
      .addToggle((toggle) => {
        toggle
          .setValue(this.shouldInheritCardColors(engine))
          .onChange((enabled) => {
            engine.options[CANVAS_INHERIT_CARD_COLORS_OPTION] = enabled;
            engine.render?.();
            engine.onOptionsChange?.();
          });

        displayOptions.optionListeners[CANVAS_INHERIT_CARD_COLORS_OPTION] = (value) => {
          if (typeof value === "boolean") {
            engine.options[CANVAS_INHERIT_CARD_COLORS_OPTION] = value;
            toggle.setValue(value);
            engine.render?.();
          }
          return this.shouldInheritCardColors(engine);
        };
      });

    const shapeSettings = CANVAS_NODE_TYPES.map((type) => this.addShapeControl(engine, displayOptions, contentEl, type));
    this.displayControls.set(engine, [colorSetting, membershipCloudsSetting, inheritCardColorsSetting, ...shapeSettings]);
  }

  addShapeControl(engine, displayOptions, childrenEl, type) {
    const option = CANVAS_NODE_SHAPE_OPTIONS[type];
    const setting = new Setting(childrenEl)
      .setName(CANVAS_NODE_TYPE_LABELS[type] ?? `${this.toTitleCase(type)} nodes`)
      .setClass(`${CANVAS_NODE_SHAPE_CLASS_PREFIX}-${type}`)
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(CANVAS_SHAPE_LABELS)) {
          dropdown.addOption(value, label);
        }

        dropdown
          .setValue(this.getNodeShape(engine, type))
          .onChange((value) => {
            engine.options[option] = this.parseShape(value) ?? CANVAS_NODE_SHAPE_DEFAULTS[type];
            engine.render?.();
            engine.onOptionsChange?.();
          });

        displayOptions.optionListeners[option] = (value) => {
          const shape = this.parseShape(value);
          if (shape) {
            engine.options[option] = shape;
            dropdown.setValue(shape);
            engine.render?.();
          }
          return this.getNodeShape(engine, type);
        };
      });

    return setting;
  }

  removeControls(engine) {
    for (const setting of this.filterControls.get(engine) ?? []) {
      this.plugin.detachElement(setting.settingEl);
    }
    for (const setting of this.displayControls.get(engine) ?? []) {
      this.plugin.detachElement(setting.settingEl);
    }
    this.filterControls.delete(engine);
    this.displayControls.delete(engine);
    this.disconnectCanvasOptionsVisibilityObserver(engine);
    this.removeCanvasFilterGroup(engine);

    delete engine?.filterOptions?.optionListeners?.[CANVAS_LINK_MODE_OPTION];
    delete engine?.filterOptions?.optionListeners?.[CANVAS_CARDS_OPTION];
    delete engine?.filterOptions?.optionListeners?.[CANVAS_PARENT_MEMBERSHIPS_OPTION];
    delete engine?.filterOptions?.optionListeners?.[CANVAS_GROUP_MEMBERSHIPS_OPTION];
    delete engine?.displayOptions?.optionListeners?.[CANVAS_LINK_COLOR_OPTION];
    delete engine?.displayOptions?.optionListeners?.[CANVAS_MEMBERSHIP_CLOUDS_OPTION];
    delete engine?.displayOptions?.optionListeners?.[CANVAS_INHERIT_CARD_COLORS_OPTION];
    for (const option of Object.values(CANVAS_NODE_SHAPE_OPTIONS)) {
      delete engine?.displayOptions?.optionListeners?.[option];
    }
  }

  removeExistingControls(childrenEl, controlClasses, trackedControls) {
    const trackedEls = new Set((trackedControls ?? []).map((setting) => setting.settingEl));
    for (const controlClass of controlClasses) {
      for (const existingEl of childrenEl.querySelectorAll?.(`.${controlClass}`) ?? []) {
        if (!trackedEls.has(existingEl)) {
          this.plugin.detachElement(existingEl);
        }
      }
    }
  }

  detachTrackedControls(trackedControls) {
    for (const setting of trackedControls ?? []) {
      this.plugin.detachElement(setting.settingEl);
    }
  }

  setParentMembershipsOption(engine, enabled) {
    engine.options[CANVAS_PARENT_MEMBERSHIPS_OPTION] = enabled;
    this.zoneAttractionLinkKeys.delete(engine);
    if (this.shouldShowMembershipClouds(engine)) {
      this.reinitializeMembershipZones(engine);
      return;
    }
    engine.render?.();
  }

  setMembershipCloudsOption(engine, enabled) {
    const wasEnabled = this.shouldShowMembershipClouds(engine);
    engine.options[CANVAS_MEMBERSHIP_CLOUDS_OPTION] = enabled;
    if (engine?.renderer) {
      engine.renderer[CANVAS_CLOUDS_ACTIVE_PROPERTY] = enabled;
    }

    if (enabled) {
      this.reinitializeMembershipZones(engine);
      return;
    }

    this.zoneAttractionLinkKeys.delete(engine);
    this.cancelMembershipCloudSync(engine?.renderer);
    this.clearMembershipClouds(engine?.renderer);
    if (wasEnabled) {
      engine.render?.();
    }
    // A rebuild wakes the render loop only for a graph change, so wake it here to remove the old clouds.
    engine.renderer?.changed?.();
  }

  reinitializeMembershipZones(engine) {
    this.markMembershipCloudsSettling(engine?.renderer);
    engine?.render?.();
    this.restartGraphSimulation(engine?.renderer);
    this.requestMembershipCloudSync(engine?.renderer);
    engine?.renderer?.changed?.();
  }

  restartGraphSimulation(renderer) {
    for (const target of [
      renderer,
      renderer?.simulation,
      renderer?.forceSimulation,
      renderer?.sim,
      renderer?.engine?.simulation
    ]) {
      if (!target) {
        continue;
      }
      if (typeof target.alpha === "function") {
        target.alpha(1);
      }
      if (typeof target.alphaTarget === "function") {
        target.alphaTarget(0);
      }
      if (typeof target.restart === "function") {
        target.restart();
      }
    }
  }

  getCanvasOptionsParent(engine, fallbackEl) {
    return engine?.controlsEl ?? fallbackEl;
  }

  ensureCanvasOptionsGroup(engine, parentEl) {
    const existing = this.filterGroups.get(engine);
    if (existing?.groupEl && existing.contentEl) {
      if (existing.groupEl.parentElement !== parentEl) {
        parentEl.appendChild(existing.groupEl);
      } else if (parentEl.lastElementChild !== existing.groupEl) {
        parentEl.appendChild(existing.groupEl);
      }
      return existing;
    }

    const doc = parentEl.ownerDocument ?? document;
    let groupEl = parentEl.querySelector?.(`.${CANVAS_FILTER_GROUP_CLASS}`);
    if (groupEl?.tagName?.toLowerCase?.() === "details" || !groupEl?.querySelector?.(".tree-item-self")) {
      const replacement = this.createCanvasOptionsGroup(doc);
      const oldContentEl = groupEl?.querySelector?.(`.${CANVAS_OPTIONS_GROUP_CONTENT_CLASS}`);
      while (oldContentEl?.firstChild) {
        replacement.contentEl.appendChild(oldContentEl.firstChild);
      }

      if (groupEl) {
        groupEl.replaceWith(replacement.groupEl);
      } else {
        parentEl.appendChild(replacement.groupEl);
      }
      groupEl = replacement.groupEl;
    }

    if (!groupEl) {
      groupEl = this.createCanvasOptionsGroup(doc).groupEl;
      parentEl.appendChild(groupEl);
    } else if (parentEl.lastElementChild !== groupEl) {
      parentEl.appendChild(groupEl);
    }

    const group = this.configureCanvasOptionsGroup(groupEl, doc);
    this.filterGroups.set(engine, group);
    this.observeCanvasOptionsVisibility(engine, group);
    return group;
  }

  observeCanvasOptionsVisibility(engine, group) {
    const controlsEl = engine?.controlsEl;
    if (!controlsEl || !group?.groupEl) {
      return;
    }

    let record = this.groupVisibilityObservers.get(engine);
    if (!record || record.controlsEl !== controlsEl) {
      this.disconnectCanvasOptionsVisibilityObserver(engine);

      const ownerWindow = controlsEl.ownerDocument?.defaultView ?? globalThis;
      const MutationObserverCtor = ownerWindow.MutationObserver ?? globalThis.MutationObserver;
      const requestFrame = ownerWindow.requestAnimationFrame?.bind(ownerWindow)
        ?? ((callback) => ownerWindow.setTimeout(callback, 16));
      const cancelFrame = ownerWindow.cancelAnimationFrame?.bind(ownerWindow)
        ?? ownerWindow.clearTimeout?.bind(ownerWindow);

      record = {
        controlsEl,
        group,
        frameId: null,
        cancelFrame,
        observer: null,
        schedule: () => {
          if (record.frameId !== null) {
            return;
          }
          record.frameId = requestFrame(() => {
            record.frameId = null;
            this.syncCanvasOptionsBankVisibility(engine, record.group);
          });
        }
      };

      if (MutationObserverCtor) {
        record.observer = new MutationObserverCtor(record.schedule);
        const observerOptions = {
          attributes: true,
          attributeFilter: ["aria-expanded", "aria-hidden", "class", "hidden", "style"],
          childList: true,
          subtree: true
        };
        record.observer.observe(controlsEl, observerOptions);
        if (controlsEl.parentElement) {
          record.observer.observe(controlsEl.parentElement, observerOptions);
        }
      }

      this.groupVisibilityObservers.set(engine, record);
    }

    record.group = group;
    record.schedule();
  }

  disconnectCanvasOptionsVisibilityObserver(engine) {
    const record = this.groupVisibilityObservers.get(engine);
    if (!record) {
      return;
    }

    record.observer?.disconnect?.();
    if (record.frameId !== null) {
      record.cancelFrame?.(record.frameId);
    }
    this.groupVisibilityObservers.delete(engine);
  }

  syncCanvasOptionsBankVisibility(engine, group) {
    const controlsEl = engine?.controlsEl;
    const groupEl = group?.groupEl;
    if (!controlsEl || !groupEl) {
      return;
    }

    const hasVisibleNativeOptions = Array.from(
      controlsEl.querySelectorAll(".setting-item, .tree-item-self, .search-input-container")
    ).some((candidateEl) => {
      if (groupEl.contains(candidateEl)) {
        return false;
      }
      return this.isElementRendered(candidateEl);
    });

    groupEl.classList.toggle("cluddlegraphs-canvas-options-group-hidden", !hasVisibleNativeOptions);
  }

  isElementRendered(el) {
    if (!el?.isConnected || el.hidden || el.getAttribute("aria-hidden") === "true") {
      return false;
    }

    const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if (style && (style.display === "none" || style.visibility === "hidden")) {
      return false;
    }

    return (el.getClientRects?.().length ?? 1) > 0;
  }

  createCanvasOptionsGroup(doc) {
    const groupEl = doc.createElement("div");
    groupEl.classList.add(CANVAS_OPTIONS_GROUP_CLASS, CANVAS_FILTER_GROUP_CLASS, "tree-item");
    return this.configureCanvasOptionsGroup(groupEl, doc);
  }

  configureCanvasOptionsGroup(groupEl, doc) {
    groupEl.classList.add(CANVAS_OPTIONS_GROUP_CLASS, CANVAS_FILTER_GROUP_CLASS, "tree-item");
    if (groupEl.dataset.cluddlegraphsCollapseInitialized !== "true") {
      groupEl.classList.add("is-collapsed");
      groupEl.dataset.cluddlegraphsCollapseInitialized = "true";
    }

    let summaryEl = groupEl.querySelector?.(`.${CANVAS_OPTIONS_GROUP_SUMMARY_CLASS}`);
    if (!summaryEl) {
      summaryEl = doc.createElement("div");
      groupEl.insertBefore(summaryEl, groupEl.firstChild);
    }
    summaryEl.classList.add(CANVAS_OPTIONS_GROUP_SUMMARY_CLASS, "tree-item-self", "is-clickable", "mod-collapsible");

    let iconEl = summaryEl.querySelector?.(".collapse-icon");
    if (!iconEl) {
      iconEl = doc.createElement("div");
      summaryEl.insertBefore(iconEl, summaryEl.firstChild);
    }
    iconEl.classList.add("tree-item-icon", "collapse-icon");
    setIcon(iconEl, "right-triangle");

    let titleEl = summaryEl.querySelector?.(".tree-item-inner");
    if (!titleEl) {
      titleEl = doc.createElement("div");
      summaryEl.appendChild(titleEl);
    }
    titleEl.classList.add("tree-item-inner");
    titleEl.textContent = CANVAS_OPTIONS_GROUP_TITLE;

    let contentEl = groupEl.querySelector?.(`.${CANVAS_OPTIONS_GROUP_CONTENT_CLASS}`);
    if (!contentEl) {
      contentEl = doc.createElement("div");
      groupEl.appendChild(contentEl);
    }
    contentEl.classList.add(CANVAS_OPTIONS_GROUP_CONTENT_CLASS, "tree-item-children");

    const cleanSummaryEl = summaryEl.cloneNode(true);
    summaryEl.replaceWith(cleanSummaryEl);
    summaryEl = cleanSummaryEl;
    iconEl = summaryEl.querySelector?.(".collapse-icon");
    if (iconEl) {
      setIcon(iconEl, "right-triangle");
    }
    titleEl = summaryEl.querySelector?.(".tree-item-inner");
    if (titleEl) {
      titleEl.textContent = CANVAS_OPTIONS_GROUP_TITLE;
    }

    const syncCollapsedState = () => {
      const collapsed = groupEl.classList.contains("is-collapsed");
      summaryEl.classList.toggle("is-collapsed", collapsed);
      iconEl?.classList.toggle("is-collapsed", collapsed);
      contentEl.style.display = collapsed ? "none" : "";
      summaryEl.setAttribute("aria-expanded", String(!collapsed));
      contentEl.setAttribute("aria-hidden", String(collapsed));
    };

    summaryEl.addEventListener("click", (event) => {
      event.preventDefault();
      groupEl.classList.toggle("is-collapsed");
      syncCollapsedState();
    });
    syncCollapsedState();

    return { groupEl, contentEl };
  }

  syncNativeCanvasLinksControl(childrenEl, contentEl, engine) {
    const settingEl = this.findNativeCanvasLinksControl(contentEl)
      ?? this.findNativeCanvasLinksControl(childrenEl);
    if (!settingEl) {
      return null;
    }

    this.compactNativeCanvasLinksControl(settingEl);
    this.bindNativeCanvasLinksControl(settingEl, engine);
    this.syncParentMembershipsFromNativeControl(settingEl, engine, false);
    if (settingEl.parentElement !== contentEl) {
      contentEl.insertBefore(settingEl, contentEl.firstChild);
    }
    return settingEl;
  }

  bindNativeCanvasLinksControl(settingEl, engine) {
    const existing = this.nativeCanvasLinksControlBindings.get(settingEl);
    if (existing?.engine === engine) {
      return;
    }
    if (existing) {
      settingEl.removeEventListener("click", existing.listener);
      settingEl.removeEventListener("change", existing.listener, true);
    }

    const listener = () => {
      const ownerWindow = settingEl.ownerDocument?.defaultView ?? globalThis;
      const setTimer = ownerWindow.setTimeout?.bind(ownerWindow) ?? setTimeout;
      setTimer(() => {
        this.syncParentMembershipsFromNativeControl(settingEl, engine, true);
      }, 0);
    };

    settingEl.addEventListener("click", listener);
    settingEl.addEventListener("change", listener, true);
    this.nativeCanvasLinksControlBindings.set(settingEl, { engine, listener });
  }

  syncParentMembershipsFromNativeControl(settingEl, engine, shouldRender) {
    const enabled = this.getNativeCanvasLinksControlValue(settingEl);
    if (typeof enabled !== "boolean"
      || engine.options?.[CANVAS_PARENT_MEMBERSHIPS_OPTION] === enabled) {
      return;
    }

    if (shouldRender) {
      this.setParentMembershipsOption(engine, enabled);
    } else {
      engine.options[CANVAS_PARENT_MEMBERSHIPS_OPTION] = enabled;
    }
  }

  getNativeCanvasLinksControlValue(settingEl) {
    const checkbox = settingEl.querySelector?.(".checkbox-container");
    if (checkbox) {
      return checkbox.classList.contains("is-enabled");
    }

    const ariaToggle = settingEl.querySelector?.("[aria-checked]");
    if (ariaToggle) {
      return ariaToggle.getAttribute("aria-checked") === "true";
    }

    const input = settingEl.querySelector?.("input[type='checkbox']");
    if (input) {
      return input.checked;
    }
    return null;
  }

  findNativeCanvasLinksControl(childrenEl) {
    const existing = childrenEl.querySelector?.(`.${NATIVE_CANVAS_LINKS_CLASS}`);
    if (existing) {
      return existing;
    }

    for (const settingEl of childrenEl.querySelectorAll?.(".setting-item") ?? []) {
      if (settingEl.classList.contains(CANVAS_OPTIONS_GROUP_CLASS)
        || settingEl.classList.contains(CANVAS_LINK_MODE_CLASS)
        || settingEl.classList.contains(CANVAS_CARDS_CLASS)
        || settingEl.classList.contains(LEGACY_CANVAS_PARENT_MEMBERSHIPS_CLASS)
        || settingEl.classList.contains(CANVAS_GROUP_MEMBERSHIPS_CLASS)) {
        continue;
      }

      const descText = settingEl.querySelector(".setting-item-description")?.textContent ?? "";
      if (/canvas/i.test(descText)
        && (/show links created/i.test(descText) || /point to other canvases/i.test(descText))) {
        return settingEl;
      }
    }

    return null;
  }

  compactNativeCanvasLinksControl(settingEl) {
    const nameEl = settingEl.querySelector(".setting-item-name");
    if (nameEl && !settingEl.dataset.cluddlegraphsOriginalName) {
      settingEl.dataset.cluddlegraphsOriginalName = nameEl.textContent ?? "";
    }
    if (nameEl) {
      nameEl.textContent = "Canvas parent links";
    }
    settingEl.classList.add(NATIVE_CANVAS_LINKS_CLASS);
  }

  restoreNativeCanvasLinksControl(settingEl) {
    if (!settingEl) {
      return;
    }

    const binding = this.nativeCanvasLinksControlBindings.get(settingEl);
    if (binding) {
      settingEl.removeEventListener("click", binding.listener);
      settingEl.removeEventListener("change", binding.listener, true);
      this.nativeCanvasLinksControlBindings.delete(settingEl);
    }

    const nameEl = settingEl.querySelector(".setting-item-name");
    if (nameEl && settingEl.dataset.cluddlegraphsOriginalName !== undefined) {
      nameEl.textContent = settingEl.dataset.cluddlegraphsOriginalName;
      delete settingEl.dataset.cluddlegraphsOriginalName;
    }
    settingEl.classList.remove(NATIVE_CANVAS_LINKS_CLASS);
  }

  removeCanvasFilterGroup(engine) {
    const group = this.filterGroups.get(engine);
    if (!group) {
      return;
    }

    this.restoreNativeCanvasLinksControl(group.nativeControlEl);
    if (group.nativeControlEl?.parentElement === group.contentEl && group.groupEl.parentElement) {
      group.groupEl.parentElement.insertBefore(group.nativeControlEl, group.groupEl);
    }
    this.plugin.detachElement(group.groupEl);
    this.filterGroups.delete(engine);
  }

  removeLegacyCanvasDisplayGroup(engine, childrenEl) {
    const legacyGroup = this.displayGroups.get(engine)?.groupEl
      ?? childrenEl.querySelector?.(`.${CANVAS_DISPLAY_GROUP_CLASS}`);
    if (legacyGroup) {
      this.plugin.detachElement(legacyGroup);
    }
    this.displayGroups.delete(engine);
  }

  toTitleCase(value) {
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  }

  patchRenderer(engine) {
    const renderer = engine?.renderer;
    if (!renderer) {
      return;
    }

    this.rendererEngines.set(renderer, engine);
    if (this.rendererPatches.has(renderer) || typeof renderer.setData !== "function") {
      return;
    }

    const originalSetData = renderer.setData;
    const originalChanged = typeof renderer.changed === "function" ? renderer.changed : null;
    const controller = this;
    renderer.setData = function(data) {
      if (!controller.hydrated) {
        controller.markRendererHydrating(this);
        controller.prepareNativeGraphDataWhileHydrating(data, engine);
        return originalSetData.call(this, data);
      }

      controller.beginCanvasColorRebuild();
      const canvasLinks = controller.applyCanvasLinksToGraphData(data, engine);
      controller.applyCanvasCardColors(data, engine);
      const result = originalSetData.call(this, data);
      controller.syncRenderer(engine, canvasLinks);
      controller.revealRendererAfterHydration(this);
      return result;
    };
    if (originalChanged) {
      renderer.changed = function(...args) {
        const result = originalChanged.apply(this, args);
        controller.requestMembershipCloudSync(this);
        return result;
      };
    }

    this.rendererPatches.set(renderer, { setData: originalSetData, changed: originalChanged });
  }

  prepareNativeGraphDataWhileHydrating(data, engine) {
    const removedInjectedLinks = this.removeInjectedCanvasLinks(data, engine);
    this.zoneAttractionLinkKeys.delete(engine);

    if (removedInjectedLinks && !engine.options.showOrphans) {
      this.removeOrphanNodes(data);
    }
    if (removedInjectedLinks) {
      data.numLinks = this.countGraphLinks(data);
    }
  }

  markRendererHydrating(renderer) {
    const containerEl = renderer?.containerEl;
    if (!containerEl?.classList || this.hydrated) {
      return;
    }

    this.cancelRendererFade(renderer);
    containerEl.classList.add(CANVAS_RENDER_LOADING_CLASS);
    containerEl.classList.remove(CANVAS_RENDER_READY_CLASS);
  }

  revealRendererAfterHydration(renderer) {
    const containerEl = renderer?.containerEl;
    if (!containerEl?.classList || !containerEl.classList.contains(CANVAS_RENDER_LOADING_CLASS)) {
      return;
    }

    this.cancelRendererFade(renderer);
    const ownerWindow = containerEl.ownerDocument?.defaultView ?? globalThis;
    const requestFrame = ownerWindow.requestAnimationFrame?.bind(ownerWindow)
      ?? ((callback) => ownerWindow.setTimeout?.(callback, 16) ?? setTimeout(callback, 16));
    const cancelFrame = ownerWindow.cancelAnimationFrame?.bind(ownerWindow)
      ?? ownerWindow.clearTimeout?.bind(ownerWindow)
      ?? clearTimeout;
    const clearTimer = ownerWindow.clearTimeout?.bind(ownerWindow) ?? clearTimeout;
    const setTimer = ownerWindow.setTimeout?.bind(ownerWindow) ?? setTimeout;

    const firstFrame = requestFrame(() => {
      const secondFrame = requestFrame(() => {
        containerEl.classList.remove(CANVAS_RENDER_LOADING_CLASS);
        containerEl.classList.add(CANVAS_RENDER_READY_CLASS);
        const timeoutId = setTimer(() => {
          containerEl.classList.remove(CANVAS_RENDER_READY_CLASS);
          this.rendererFadeFrames.delete(renderer);
        }, CANVAS_RENDER_FADE_MS);
        this.rendererFadeFrames.set(renderer, { timeoutId, clearTimer });
      });
      this.rendererFadeFrames.set(renderer, { frameId: secondFrame, cancelFrame });
    });

    this.rendererFadeFrames.set(renderer, { frameId: firstFrame, cancelFrame });
  }

  cancelRendererFade(renderer) {
    const frame = this.rendererFadeFrames.get(renderer);
    if (!frame) {
      return;
    }

    if (frame.frameId !== undefined) {
      frame.cancelFrame?.(frame.frameId);
    }
    if (frame.timeoutId !== undefined) {
      frame.clearTimer?.(frame.timeoutId);
    }
    this.rendererFadeFrames.delete(renderer);
  }

  clearRendererLoadingState(renderer) {
    const containerEl = renderer?.containerEl;
    if (!containerEl?.classList) {
      return;
    }

    containerEl.classList.remove(CANVAS_RENDER_LOADING_CLASS, CANVAS_RENDER_READY_CLASS);
  }

  requestRendererVisualRefresh(renderer) {
    if (!renderer || typeof renderer.changed !== "function" || this.rendererRefreshFrames.has(renderer)) {
      return;
    }

    const ownerWindow = renderer.containerEl?.ownerDocument?.defaultView ?? globalThis;
    const requestFrame = ownerWindow.requestAnimationFrame?.bind(ownerWindow)
      ?? ((callback) => ownerWindow.setTimeout?.(callback, 16) ?? setTimeout(callback, 16));
    const cancelFrame = ownerWindow.cancelAnimationFrame?.bind(ownerWindow)
      ?? ownerWindow.clearTimeout?.bind(ownerWindow)
      ?? clearTimeout;
    const frameId = requestFrame(() => {
      this.rendererRefreshFrames.delete(renderer);
      renderer.changed?.();
    });
    this.rendererRefreshFrames.set(renderer, {
      frameId,
      cancelFrame
    });
  }

  cancelRendererVisualRefresh(renderer) {
    const frame = this.rendererRefreshFrames.get(renderer);
    if (!frame) {
      return;
    }

    frame.cancelFrame?.(frame.frameId);
    this.rendererRefreshFrames.delete(renderer);
  }

  syncSearchMatches(engine, matchValue = true) {
    this.clearSearchMatches(engine);
    if (!engine?.fileFilter || !this.shouldShowCards(engine)) {
      return;
    }

    const searchQuery = this.getCanvasSearchQuery(engine);
    if (!searchQuery) {
      return;
    }

    const matches = new Set();
    for (const [nodeId, metadata] of Object.entries(this.canvasGraphNodes)) {
      if (metadata.type === "file" || !this.doesCanvasGraphNodeMatchSearch(metadata, searchQuery)) {
        continue;
      }

      engine.fileFilter[nodeId] = matchValue;
      matches.add(nodeId);
    }

    if (matches.size > 0) {
      this.searchMatches.set(engine, matches);
    }
  }

  clearSearchMatches(engine) {
    const matches = this.searchMatches.get(engine);
    if (!matches || !engine?.fileFilter) {
      this.searchMatches.delete(engine);
      return;
    }

    for (const nodeId of matches) {
      delete engine.fileFilter[nodeId];
    }
    this.searchMatches.delete(engine);
  }

  requestMembershipCloudSync(renderer) {
    const engine = this.rendererEngines.get(renderer);
    if (!engine || !this.shouldShowMembershipClouds(engine) || this.cloudSyncFrames.has(renderer)) {
      return;
    }

    const ownerWindow = renderer?.containerEl?.ownerDocument?.defaultView ?? globalThis;
    const requestFrame = ownerWindow.requestAnimationFrame?.bind(ownerWindow)
      ?? ((callback) => ownerWindow.setTimeout(callback, 16));
    const frameId = requestFrame(() => {
      this.cloudSyncFrames.delete(renderer);
      this.syncMembershipClouds(engine);
    });
    this.cloudSyncFrames.set(renderer, frameId);
  }

  markMembershipCloudsSettling(renderer) {
    if (!renderer) {
      return;
    }

    this.cancelMembershipCloudSync(renderer);
    this.clearMembershipClouds(renderer);
    this.cloudReadyAt.set(renderer, Date.now() + CANVAS_ZONE_SETTLE_MS);
    this.scheduleMembershipCloudSync(renderer, CANVAS_ZONE_SETTLE_MS);
  }

  scheduleMembershipCloudSync(renderer, delay) {
    if (!renderer || this.cloudSyncTimers.has(renderer)) {
      return;
    }

    const ownerWindow = renderer?.containerEl?.ownerDocument?.defaultView ?? globalThis;
    const setTimer = ownerWindow.setTimeout?.bind(ownerWindow) ?? setTimeout;
    const clearTimer = ownerWindow.clearTimeout?.bind(ownerWindow) ?? clearTimeout;
    const timeoutId = setTimer(() => {
      this.cloudSyncTimers.delete(renderer);
      this.requestMembershipCloudSync(renderer);
    }, Math.max(0, delay));
    this.cloudSyncTimers.set(renderer, { timeoutId, clearTimer });
  }

  getMembershipCloudSettleDelay(renderer) {
    const readyAt = this.cloudReadyAt.get(renderer);
    if (!readyAt) {
      return 0;
    }

    const delay = readyAt - Date.now();
    if (delay <= 0) {
      this.cloudReadyAt.delete(renderer);
      return 0;
    }
    return delay;
  }

  cancelMembershipCloudSync(renderer) {
    const frameId = renderer ? this.cloudSyncFrames.get(renderer) : null;
    const ownerWindow = renderer?.containerEl?.ownerDocument?.defaultView ?? globalThis;
    if (frameId) {
      const cancelFrame = ownerWindow.cancelAnimationFrame?.bind(ownerWindow)
        ?? ownerWindow.clearTimeout.bind(ownerWindow);
      cancelFrame(frameId);
      this.cloudSyncFrames.delete(renderer);
    }

    const timer = renderer ? this.cloudSyncTimers.get(renderer) : null;
    if (timer) {
      timer.clearTimer?.(timer.timeoutId);
      this.cloudSyncTimers.delete(renderer);
    }
    if (renderer) {
      this.cloudReadyAt.delete(renderer);
    }
  }

  syncMembershipClouds(engine) {
    const renderer = engine?.renderer;
    if (!renderer) {
      return;
    }
    if (!this.shouldShowMembershipClouds(engine)) {
      this.clearMembershipClouds(renderer);
      return;
    }

    const settleDelay = this.getMembershipCloudSettleDelay(renderer);
    if (settleDelay > 0) {
      this.clearMembershipClouds(renderer);
      this.scheduleMembershipCloudSync(renderer, settleDelay);
      return;
    }

    const layer = this.getMembershipCloudLayer(renderer);
    if (!layer) {
      return;
    }

    const clouds = this.getVisibleCanvasMembershipClouds(renderer);
    const signature = this.getMembershipCloudSignature(clouds);
    this.cloudSignatures ??= new WeakMap();
    if (this.isSameMembershipCloudSignature(this.cloudSignatures.get(layer), signature)) {
      return;
    }

    layer.clear?.();
    for (const cloud of clouds) {
      this.drawMembershipCloud(layer, cloud.points, cloud.color, cloud.padding);
    }
    this.cloudSignatures.set(layer, signature);
  }

  clearMembershipClouds(renderer) {
    const layer = renderer ? this.cloudLayers.get(renderer) : null;
    layer?.clear?.();
    if (layer) {
      this.cloudSignatures?.delete(layer);
    }
  }

  getMembershipCloudSignature(clouds) {
    const values = [];
    for (const cloud of clouds) {
      values.push(cloud.points.length, cloud.color, cloud.padding);
      for (const point of cloud.points) {
        values.push(point.x, point.y);
      }
    }
    return values;
  }

  isSameMembershipCloudSignature(previous, next) {
    if (!previous || previous.length !== next.length) {
      return false;
    }
    for (let index = 0; index < next.length; index++) {
      if (previous[index] !== next[index]) {
        return false;
      }
    }
    return true;
  }

  getMembershipCloudLayer(renderer) {
    const existingLayer = this.cloudLayers.get(renderer);
    if (existingLayer?.parent) {
      return existingLayer;
    }

    const parent = this.getMembershipCloudParent(renderer);
    const Graphics = this.getGraphicsConstructor(renderer);
    if (!parent || !Graphics) {
      return null;
    }

    const layer = new Graphics();
    layer.name = "CluddleGraphsCanvasMembershipClouds";
    layer.zIndex = -1000;
    layer.interactive = false;
    layer.eventMode = "none";
    if (parent.sortableChildren !== undefined) {
      parent.sortableChildren = true;
    }
    if (typeof parent.addChildAt === "function") {
      parent.addChildAt(layer, 0);
    } else {
      parent.addChild?.(layer);
    }
    this.cloudLayers.set(renderer, layer);
    return layer;
  }

  getMembershipCloudParent(renderer) {
    const firstNodeCircle = (renderer.nodes ?? []).find((node) => node?.circle?.parent)?.circle;
    return firstNodeCircle?.parent?.parent
      ?? firstNodeCircle?.parent
      ?? renderer.stage
      ?? renderer.scene
      ?? renderer.root
      ?? null;
  }

  getGraphicsConstructor(renderer) {
    return (renderer.nodes ?? []).find((node) => node?.circle?.constructor)?.circle?.constructor ?? null;
  }

  getVisibleCanvasMembershipClouds(renderer) {
    const transform = this.getHangerToCloudLayerTransform(renderer, this.cloudLayers.get(renderer));
    const clouds = [];
    for (const [canvasPath, nodeIds] of Object.entries(this.canvasMemberships)) {
      const points = [];
      const radii = [];
      const seen = new Set();
      for (const nodeId of nodeIds) {
        if (seen.has(nodeId)) {
          continue;
        }
        seen.add(nodeId);

        const node = renderer.nodeLookup?.[nodeId];
        const point = this.getRendererNodePoint(renderer, node, transform);
        if (point) {
          points.push(point);
          const radius = this.getRendererNodeRadius(renderer, node, transform);
          if (radius !== null) {
            radii.push(radius);
          }
        }
      }

      if (points.length === 0) {
        continue;
      }

      clouds.push({
        canvasPath,
        points,
        padding: this.getMembershipCloudPadding(radii),
        color: this.getCanvasMembershipCloudColor(renderer, canvasPath)
      });
    }
    return clouds;
  }

  // Return the PIXI matrix that maps graph (hanger) coordinates into the cloud layer, from the
  // current world transforms. This replaces a recursive toGlobal/toLocal call for each node.
  getHangerToCloudLayerTransform(renderer, layer) {
    // PIXI updates worldTransform only in a stage render or in toGlobal. A drag-pan moves the hanger
    // between frames, so update the two transforms one time before they are read.
    try {
      renderer?.hanger?.toGlobal?.({ x: 0, y: 0 });
      layer?.toGlobal?.({ x: 0, y: 0 });
    } catch {
      // PIXI destroyed the hanger or the layer. The guarded fallback for each node applies.
      return null;
    }
    const hanger = renderer?.hanger?.worldTransform;
    const local = layer?.worldTransform;
    if (!this.isAffineMatrix(hanger) || !this.isAffineMatrix(local)) {
      return null;
    }

    const determinant = local.a * local.d - local.b * local.c;
    if (!Number.isFinite(determinant) || determinant === 0) {
      return null;
    }

    const inverse = {
      a: local.d / determinant,
      b: -local.b / determinant,
      c: -local.c / determinant,
      d: local.a / determinant,
      tx: (local.c * local.ty - local.d * local.tx) / determinant,
      ty: (local.b * local.tx - local.a * local.ty) / determinant
    };
    return {
      a: inverse.a * hanger.a + inverse.c * hanger.b,
      b: inverse.b * hanger.a + inverse.d * hanger.b,
      c: inverse.a * hanger.c + inverse.c * hanger.d,
      d: inverse.b * hanger.c + inverse.d * hanger.d,
      tx: inverse.a * hanger.tx + inverse.c * hanger.ty + inverse.tx,
      ty: inverse.b * hanger.tx + inverse.d * hanger.ty + inverse.ty
    };
  }

  isAffineMatrix(matrix) {
    return !!matrix && ["a", "b", "c", "d", "tx", "ty"].every((key) => Number.isFinite(matrix[key]));
  }

  getRendererNodePoint(renderer, node, transform = null) {
    if (!node) {
      return null;
    }

    if (transform && Number.isFinite(node.x) && Number.isFinite(node.y)) {
      return {
        x: transform.a * node.x + transform.c * node.y + transform.tx,
        y: transform.b * node.x + transform.d * node.y + transform.ty
      };
    }

    const layer = this.cloudLayers.get(renderer);
    const circle = node.circle;
    if (circle && layer && typeof circle.toGlobal === "function" && typeof layer.toLocal === "function") {
      try {
        const globalPoint = circle.toGlobal({ x: GRAPH_NODE_CENTER, y: GRAPH_NODE_CENTER });
        const localPoint = layer.toLocal(globalPoint);
        return this.toGraphPoint(localPoint?.x, localPoint?.y);
      } catch {
        // Fall back to direct graph coordinates below.
      }
    }

    if (circle) {
      const x = this.toFiniteNumber(circle.x);
      const y = this.toFiniteNumber(circle.y);
      if (x !== null && y !== null) {
        return { x: x + GRAPH_NODE_CENTER, y: y + GRAPH_NODE_CENTER };
      }
    }

    return this.toGraphPoint(node.x, node.y);
  }

  getRendererNodeRadius(renderer, node, transform = null) {
    const circle = node?.circle;
    const circleScale = circle?.scale?.x;
    if (transform && Number.isFinite(circleScale)) {
      const radius = circleScale * GRAPH_NODE_CENTER * Math.hypot(transform.a, transform.b);
      return Number.isFinite(radius) && radius > 0 ? radius : null;
    }

    const layer = this.cloudLayers.get(renderer);
    if (circle && layer && typeof circle.toGlobal === "function" && typeof layer.toLocal === "function") {
      try {
        const center = layer.toLocal(circle.toGlobal({ x: GRAPH_NODE_CENTER, y: GRAPH_NODE_CENTER }));
        const edge = layer.toLocal(circle.toGlobal({ x: GRAPH_NODE_CENTER * 2, y: GRAPH_NODE_CENTER }));
        return this.getPointDistance(center, edge);
      } catch {
        // Fall back to unscaled graph radius below.
      }
    }

    return GRAPH_NODE_CENTER;
  }

  getPointDistance(first, second) {
    const firstPoint = this.toGraphPoint(first?.x, first?.y);
    const secondPoint = this.toGraphPoint(second?.x, second?.y);
    if (!firstPoint || !secondPoint) {
      return null;
    }

    const distance = Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);
    return Number.isFinite(distance) && distance > 0 ? distance : null;
  }

  getMembershipCloudPadding(radii) {
    const sortedRadii = radii
      .filter((radius) => Number.isFinite(radius) && radius > 0)
      .sort((a, b) => a - b);
    if (sortedRadii.length === 0) {
      return CANVAS_CLOUD_PADDING;
    }

    const radius = sortedRadii[Math.floor(sortedRadii.length / 2)];
    return radius + Math.max(CANVAS_CLOUD_MIN_MARGIN, radius * CANVAS_CLOUD_MARGIN_RATIO);
  }

  toGraphPoint(x, y) {
    const pointX = this.toFiniteNumber(x);
    const pointY = this.toFiniteNumber(y);
    return pointX === null || pointY === null ? null : { x: pointX, y: pointY };
  }

  getCanvasMembershipCloudColor(renderer, canvasPath) {
    const canvasNode = renderer.nodeLookup?.[canvasPath];
    return this.getGraphNodeColor(canvasNode)
      ?? this.getGraphRendererColor(renderer, "fill")
      ?? this.plugin.hexToRgb(CANVAS_LINK_COLOR_DEFAULT);
  }

  // Set card colours in the graph data. Native setData then copies them to node.color, and the
  // native render applies them, with hover highlight included.
  applyCanvasCardColors(data, engine) {
    if (!this.shouldShowCards(engine)) {
      return;
    }

    for (const [nodeId, metadata] of Object.entries(this.canvasGraphNodes)) {
      const dataNode = data.nodes?.[nodeId];
      if (!dataNode || metadata.type === "file") {
        continue;
      }

      const color = this.getCanvasCardColor(engine, data, metadata);
      if (color === null) {
        delete dataNode.color;
      } else {
        dataNode.color = this.getCanvasCardColorStyle(color);
      }
    }
  }

  getCanvasCardColor(engine, data, metadata) {
    const ownColor = this.shouldInheritCardColors(engine)
      ? this.getCanvasGraphNodeMetadataColor(engine, metadata)
      : this.getGraphGroupColorForPath(engine, metadata.canvasPath);
    return ownColor ?? this.getCanvasNodeInheritedColor(engine, data, metadata.canvasPath);
  }

  // Native setData compares node colours by identity, so reuse one style object for each colour.
  getCanvasCardColorStyle(color) {
    this.canvasCardColorStyles ??= new Map();
    let style = this.canvasCardColorStyles.get(color);
    if (!style) {
      style = { a: 1, rgb: color };
      this.canvasCardColorStyles.set(color, style);
    }
    return style;
  }

  getCanvasNodeInheritedColor(engine, data, canvasPath) {
    if (!canvasPath) {
      return null;
    }

    return this.toRgbNumber(data?.nodes?.[canvasPath]?.color)
      ?? this.getGraphGroupColorForPath(engine, canvasPath);
  }

  getCanvasGraphNodeMetadataColor(engine, metadata) {
    const doc = this.getRendererDocument(engine?.renderer);
    for (const color of [metadata?.canvasColor, metadata?.inheritedColor]) {
      const resolvedColor = this.resolveCanvasColorCached(color, doc);
      if (resolvedColor !== null) {
        return resolvedColor;
      }
    }
    return null;
  }

  getRendererDocument(renderer) {
    return renderer?.containerEl?.ownerDocument
      ?? renderer?.containerEl?.doc
      ?? globalThis.document;
  }

  // Keep resolved palette colours across graph rebuilds. A css-change event clears them.
  // Keep an unresolved colour only until the next graph rebuild, so that a palette that loads later still resolves.
  resolveCanvasColorCached(color, doc) {
    if (color === undefined || color === null || color === "") {
      return null;
    }
    if (!doc || typeof doc !== "object") {
      return this.resolveCanvasColor(color, doc);
    }

    this.canvasColorCache ??= new WeakMap();
    let documentCache = this.canvasColorCache.get(doc);
    if (!documentCache) {
      documentCache = new Map();
      this.canvasColorCache.set(doc, documentCache);
    }

    const key = String(color);
    if (documentCache.has(key)) {
      return documentCache.get(key);
    }

    this.unresolvedCanvasColors ??= new WeakMap();
    let unresolvedColors = this.unresolvedCanvasColors.get(doc);
    if (!unresolvedColors) {
      unresolvedColors = new Set();
      this.unresolvedCanvasColors.set(doc, unresolvedColors);
    }
    if (unresolvedColors.has(key)) {
      return null;
    }

    const resolvedColor = this.resolveCanvasColor(color, doc);
    if (resolvedColor === null) {
      unresolvedColors.add(key);
    } else {
      documentCache.set(key, resolvedColor);
    }
    return resolvedColor;
  }

  // Look up the unresolved palette colours again in the next graph rebuild.
  beginCanvasColorRebuild() {
    this.unresolvedCanvasColors = new WeakMap();
  }

  clearCanvasColorCache() {
    this.canvasColorCache = new WeakMap();
    this.beginCanvasColorRebuild();
  }

  cacheGraphColorQueries(engine, queries) {
    if (!engine || !Array.isArray(queries)) {
      return;
    }

    if (queries.length > 0
      && !queries.some((query) => this.toRgbNumber(query?.color) !== null
        && !this.plugin.isSearchHighlightSentinel?.(query.color))) {
      return;
    }

    const colorQueries = queries
      .filter((query) => this.toRgbNumber(query?.color) !== null
        && !this.plugin.isSearchHighlightSentinel?.(query.color)
        && this.getGraphQueryText(query))
      .map((query) => ({
        query: this.getGraphQueryText(query),
        color: query.color
      }));

    this.graphColorQueries.set(engine, colorQueries);
  }

  getGraphGroupColorForPath(engine, path) {
    if (!engine || !path) {
      return null;
    }

    const directColor = this.toRgbNumber(engine.fileFilter?.[path]);
    if (directColor !== null) {
      return directColor;
    }

    const metadata = this.getPathSearchMetadata(path);
    for (const query of this.getGraphColorQueries(engine)) {
      const color = this.toRgbNumber(query.color);
      if (color !== null && this.doesCanvasGraphNodeMatchSearch(metadata, query.query)) {
        return color;
      }
    }
    return null;
  }

  getGraphColorQueries(engine) {
    const cachedQueries = this.graphColorQueries.get(engine);
    if (cachedQueries) {
      return cachedQueries;
    }

    const savedOptions = this.plugin.getSavedGraphOptions(engine) ?? {};
    const candidates = [
      engine?.colorGroupOptions?.getColoredQueries?.(),
      engine?.colorGroupOptions?.getColorQueries?.(),
      engine?.colorGroupOptions?.queries,
      engine?.colorGroupOptions?.colorQueries,
      engine?.options?.colorGroups,
      savedOptions.colorGroups
    ];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }
      const colorQueries = candidate
        .filter((query) => this.toRgbNumber(query?.color) !== null && this.getGraphQueryText(query))
        .map((query) => ({
          query: this.getGraphQueryText(query),
          color: query.color
        }));
      if (colorQueries.length > 0) {
        return colorQueries;
      }
    }
    return [];
  }

  getGraphQueryText(query) {
    return String(query?.query ?? query?.text ?? query?.source ?? query?.value ?? "").trim();
  }

  getPathSearchMetadata(path) {
    const basename = String(path).split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
    return {
      canvasPath: path,
      label: basename,
      searchPath: path,
      searchText: `${basename} ${path}`,
      type: "file"
    };
  }

  getGraphNodeColor(node) {
    for (const value of [
      node?.color?.rgb,
      node?.color,
      node?.fill?.rgb,
      node?.fill,
      node?.fillColor?.rgb,
      node?.fillColor,
      node?.colorRgb,
      node?.circle?.tint,
      node?.circle?._fillStyle?.color
    ]) {
      const color = this.toRgbNumber(value);
      if (color !== null && color !== 0xffffff) {
        return color;
      }
    }
    return null;
  }

  getGraphRendererColor(renderer, colorName) {
    return this.toRgbNumber(renderer?.colors?.[colorName]?.rgb ?? renderer?.colors?.[colorName]);
  }

  toRgbNumber(value) {
    if (value && typeof value === "object" && "rgb" in value) {
      return this.toRgbNumber(value.rgb);
    }
    if (value && typeof value === "object" && "color" in value) {
      return this.toRgbNumber(value.color);
    }
    if (value && typeof value === "object" && "value" in value) {
      return this.toRgbNumber(value.value);
    }
    if (typeof value === "string") {
      const color = this.plugin.normalizeHexColor(value);
      return color ? this.plugin.hexToRgb(color) : null;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(0xffffff, Math.round(value)));
  }

  drawMembershipCloud(graphics, points, color, padding = CANVAS_CLOUD_PADDING) {
    const polygon = this.createMembershipCloudPolygon(points, padding);
    if (polygon.length < 3) {
      return;
    }

    this.drawMembershipCloudPolygon(graphics, polygon, color);
  }

  drawMembershipCloudPolygon(graphics, polygon, color) {
    this.beginMembershipCloud(graphics, color);
    graphics.moveTo?.(polygon[0].x, polygon[0].y);
    for (const point of polygon.slice(1)) {
      graphics.lineTo?.(point.x, point.y);
    }
    graphics.lineTo?.(polygon[0].x, polygon[0].y);
    graphics.closePath?.();
    graphics.endFill?.();
  }

  createMembershipCloudPolygon(points, padding) {
    if (points.length === 1) {
      return this.createCirclePolygon(points[0], padding, CANVAS_CLOUD_CIRCLE_SEGMENTS);
    }
    if (points.length === 2) {
      return this.createCapsulePolygon(points[0], points[1], padding);
    }

    const hull = this.getConvexHull(points);
    if (hull.length === 1) {
      return this.createCirclePolygon(hull[0], padding, CANVAS_CLOUD_CIRCLE_SEGMENTS);
    }
    if (hull.length === 2) {
      return this.createCapsulePolygon(hull[0], hull[1], padding);
    }
    return this.createRoundedHullPolygon(hull, padding);
  }

  createCirclePolygon(center, radius, segments) {
    const points = [];
    for (let index = 0; index < segments; index++) {
      const angle = (Math.PI * 2 * index) / segments;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }
    return points;
  }

  createCapsulePolygon(first, second, radius) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      return this.createCirclePolygon(first, radius, CANVAS_CLOUD_CIRCLE_SEGMENTS);
    }

    const angle = Math.atan2(dy, dx);
    const points = [];
    for (let index = 0; index <= CANVAS_CLOUD_CIRCLE_SEGMENTS / 2; index++) {
      const theta = angle - Math.PI / 2 + (Math.PI * index) / (CANVAS_CLOUD_CIRCLE_SEGMENTS / 2);
      points.push({
        x: second.x + Math.cos(theta) * radius,
        y: second.y + Math.sin(theta) * radius
      });
    }
    for (let index = 0; index <= CANVAS_CLOUD_CIRCLE_SEGMENTS / 2; index++) {
      const theta = angle + Math.PI / 2 + (Math.PI * index) / (CANVAS_CLOUD_CIRCLE_SEGMENTS / 2);
      points.push({
        x: first.x + Math.cos(theta) * radius,
        y: first.y + Math.sin(theta) * radius
      });
    }
    return points;
  }

  createRoundedHullPolygon(points, radius) {
    const hull = this.ensureCounterClockwise(points);
    const polygon = [];
    for (let index = 0; index < hull.length; index++) {
      const previous = hull[(index - 1 + hull.length) % hull.length];
      const current = hull[index];
      const next = hull[(index + 1) % hull.length];
      const previousNormal = this.getOutwardNormal(previous, current);
      const nextNormal = this.getOutwardNormal(current, next);
      const startAngle = Math.atan2(previousNormal.y, previousNormal.x);
      const endAngle = this.normalizeAngleForward(startAngle, Math.atan2(nextNormal.y, nextNormal.x));
      const span = endAngle - startAngle;
      const steps = Math.max(1, Math.ceil((span / (Math.PI / 2)) * CANVAS_CLOUD_CORNER_SEGMENTS));

      for (let step = 0; step <= steps; step++) {
        if (index > 0 && step === 0) {
          continue;
        }
        const angle = startAngle + (span * step) / steps;
        polygon.push({
          x: current.x + Math.cos(angle) * radius,
          y: current.y + Math.sin(angle) * radius
        });
      }
    }
    return polygon;
  }

  beginMembershipCloud(graphics, color) {
    graphics.lineStyle?.(CANVAS_CLOUD_LINE_WIDTH, color, CANVAS_CLOUD_LINE_ALPHA);
    graphics.beginFill?.(color, CANVAS_CLOUD_ALPHA);
  }

  getConvexHull(points) {
    const sortedPoints = [...points]
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .filter((point, index, sorted) => index === 0
        || point.x !== sorted[index - 1].x
        || point.y !== sorted[index - 1].y);
    if (sortedPoints.length <= 2) {
      return sortedPoints;
    }

    const lower = [];
    for (const point of sortedPoints) {
      while (lower.length >= 2
        && this.crossProduct(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }

    const upper = [];
    for (let index = sortedPoints.length - 1; index >= 0; index--) {
      const point = sortedPoints[index];
      while (upper.length >= 2
        && this.crossProduct(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  crossProduct(origin, first, second) {
    return (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
  }

  ensureCounterClockwise(points) {
    return this.getSignedPolygonArea(points) >= 0 ? points : [...points].reverse();
  }

  getSignedPolygonArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      area += current.x * next.y - next.x * current.y;
    }
    return area / 2;
  }

  getOutwardNormal(first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      return { x: 1, y: 0 };
    }
    return { x: dy / length, y: -dx / length };
  }

  normalizeAngleForward(startAngle, endAngle) {
    let normalizedEnd = endAngle;
    while (normalizedEnd < startAngle) {
      normalizedEnd += Math.PI * 2;
    }
    return normalizedEnd;
  }

  getCanvasSearchQuery(engine) {
    return String(engine?.filterOptions?.search?.getValue?.() ?? "").trim();
  }

  doesCanvasGraphNodeMatchSearch(metadata, searchQuery) {
    const tokens = this.parseCanvasSearchTokens(searchQuery);
    if (tokens.length === 0) {
      return false;
    }

    for (const token of tokens) {
      const matched = this.doesCanvasSearchTokenMatch(metadata, token);
      if (token.negated) {
        if (matched) {
          return false;
        }
        continue;
      }

      if (!matched) {
        return false;
      }
    }

    return true;
  }

  parseCanvasSearchTokens(searchQuery) {
    const tokens = [];
    const tokenPattern = /(-)?(?:(\w+):)?(?:"([^"]+)"|(\S+))/g;
    for (const match of searchQuery.matchAll(tokenPattern)) {
      const value = String(match[3] ?? match[4] ?? "").trim().toLowerCase();
      if (!value) {
        continue;
      }

      tokens.push({
        negated: match[1] === "-",
        operator: match[2]?.toLowerCase() ?? "",
        value
      });
    }
    return tokens;
  }

  doesCanvasSearchTokenMatch(metadata, token) {
    const operator = token.operator;
    if (operator === "path") {
      return this.normalizeSearchText(metadata.searchPath ?? metadata.canvasPath).includes(token.value);
    }
    if (operator === "file" || operator === "name") {
      return this.normalizeSearchText(metadata.label).includes(token.value);
    }
    if (operator) {
      return false;
    }

    return this.normalizeSearchText(`${metadata.label ?? ""} ${metadata.searchText ?? ""}`).includes(token.value);
  }

  normalizeSearchText(value) {
    return String(value ?? "").toLowerCase();
  }

  applyCanvasLinksToGraphData(data, engine) {
    const removedInjectedLinks = this.removeInjectedCanvasLinks(data, engine);
    const removedNativeParentLinks = this.removeNativeCanvasParentLinks(data, engine);
    const mode = this.getLinkMode(engine);
    this.zoneAttractionLinkKeys.delete(engine);

    if (mode === "hide") {
      if ((removedInjectedLinks || removedNativeParentLinks) && !engine.options.showOrphans) {
        this.removeOrphanNodes(data);
      }
      if (removedInjectedLinks || removedNativeParentLinks) {
        data.numLinks = this.countGraphLinks(data);
      }
      return {};
    }

    const canvasLinks = this.getCanvasGraphLinks(data, engine);
    const injectedLinkKeys = new Set();

    if (mode !== "hide") {
      for (const linkKey of this.addCanvasGraphLinks(data, engine, canvasLinks)) {
        injectedLinkKeys.add(linkKey);
      }
      this.addCanvasSearchResultNodes(data, engine);
    }
    if (mode === "only") {
      this.keepOnlyCanvasGraphLinks(data, canvasLinks);
    }

    if (mode !== "all" && !engine.options.showOrphans) {
      this.removeOrphanNodes(data);
    }

    if (this.shouldShowMembershipClouds(engine) && mode !== "hide") {
      for (const linkKey of this.addCanvasZoneAttractionLinks(data, engine)) {
        injectedLinkKeys.add(linkKey);
      }
    }

    if (injectedLinkKeys.size > 0) {
      this.injectedCanvasLinkKeys.set(engine, injectedLinkKeys);
    }
    data.numLinks = this.countGraphLinks(data);
    return canvasLinks;
  }

  removeInjectedCanvasLinks(data, engine) {
    const injectedLinkKeys = this.injectedCanvasLinkKeys.get(engine);
    if (!injectedLinkKeys?.size) {
      return false;
    }

    this.removeGraphLinksByKeys(data, injectedLinkKeys);
    this.injectedCanvasLinkKeys.delete(engine);
    return true;
  }

  removeNativeCanvasParentLinks(data, engine) {
    if (this.shouldShowParentMemberships(engine)) {
      return false;
    }

    let removed = false;
    for (const [canvasPath, canvasLinks] of Object.entries(this.canvasGraphLinks)) {
      const targets = canvasLinks?.[canvasPath];
      const sourceNode = data.nodes?.[canvasPath];
      if (!sourceNode?.links) {
        continue;
      }

      for (const [targetPath, link] of Object.entries(targets ?? {})) {
        if ((link.parentMembershipCount ?? 0) <= 0
          || this.getCanvasGraphEdgeCount(link) > 0
          || (link.groupMembershipCount ?? 0) > 0
          || !Object.prototype.hasOwnProperty.call(sourceNode.links, targetPath)) {
          continue;
        }

        delete sourceNode.links[targetPath];
        removed = true;
      }
    }
    return removed;
  }

  syncRenderer(engine, canvasLinks) {
    const renderer = engine?.renderer;
    if (!renderer) {
      return;
    }

    const defaultColor = this.plugin.hexToRgb(this.getLinkColor(engine));
    const doc = this.getRendererDocument(renderer);
    renderer[CANVAS_CLOUDS_ACTIVE_PROPERTY] = this.shouldShowMembershipClouds(engine);

    let visibleChange = false;
    for (const node of renderer.nodes ?? []) {
      if (this.syncNode(engine, node)) {
        visibleChange = true;
      }
      this.plugin.patchGraphNode(node);
      if (this.plugin.drawCanvasGraphNodeShape(node)) {
        visibleChange = true;
      }
    }

    const zoneAttractionLinkKeys = this.zoneAttractionLinkKeys.get(engine);
    const hasLinkDecorations = Object.keys(canvasLinks).length > 0 || (zoneAttractionLinkKeys?.size ?? 0) > 0;
    if (hasLinkDecorations || this.decoratedLinkRenderers.has(renderer)) {
      for (const link of renderer.links ?? []) {
        const linkKey = this.getLinkKey(link.source?.id, link.target?.id);
        const canvasLink = canvasLinks[linkKey];
        const zone = zoneAttractionLinkKeys?.has(linkKey) === true;
        const color = !zone && canvasLink ? this.getRenderedLinkColor(canvasLink, defaultColor, doc) : undefined;
        if ((link[CANVAS_ZONE_ATTRACTION_PROPERTY] === true) !== zone || link[CANVAS_LINK_COLOR_PROPERTY] !== color) {
          visibleChange = true;
          if (zone) {
            link[CANVAS_ZONE_ATTRACTION_PROPERTY] = true;
          } else {
            delete link[CANVAS_ZONE_ATTRACTION_PROPERTY];
          }
          if (color === undefined) {
            delete link[CANVAS_LINK_COLOR_PROPERTY];
          } else {
            link[CANVAS_LINK_COLOR_PROPERTY] = color;
          }
        }
        this.plugin.patchGraphLink(link);
      }
      if (hasLinkDecorations) {
        this.decoratedLinkRenderers.add(renderer);
      } else {
        this.decoratedLinkRenderers.delete(renderer);
      }
    }

    this.requestMembershipCloudSync(renderer);
    // Native setData wakes the render loop for its own changes. Each wake draws the full graph for
    // 61 frames, also in a hidden tab, so wake it here only for a change that the plugin made.
    if (visibleChange) {
      this.requestRendererVisualRefresh(renderer);
    }
  }

  // Card colours go into the graph data (applyCanvasCardColors). Here, set only the label and the shape.
  // Return true when the label or its font changes. drawCanvasGraphNodeShape reports a shape change.
  syncNode(engine, node) {
    const metadata = this.canvasGraphNodes[node?.id];
    if (!metadata || (metadata.type !== "file" && !this.shouldShowCards(engine))) {
      const hadLabel = node?.[CANVAS_NODE_LABEL_PROPERTY] !== undefined;
      delete node?.[CANVAS_NODE_LABEL_PROPERTY];
      if (node?.[CANVAS_NODE_SHAPE_PROPERTY]) {
        node[CANVAS_NODE_SHAPE_PROPERTY] = "circle";
      }
      return hadLabel;
    }

    const label = metadata.type === "file" ? undefined : metadata.label;
    const size = node.getSize?.();
    this.labelSizes ??= new WeakMap();
    const fontChanged = node[CANVAS_NODE_LABEL_PROPERTY] !== label || this.labelSizes.get(node) !== size;
    node[CANVAS_NODE_LABEL_PROPERTY] = label;
    this.labelSizes.set(node, size);
    node[CANVAS_NODE_SHAPE_PROPERTY] = this.getNodeShape(engine, metadata.type);
    let textChanged = false;
    if (node.text && label !== undefined && node.text.text !== label) {
      node.text.text = label;
      textChanged = true;
    }
    // A dirty font makes PIXI draw the label text again. The native font size uses the node size,
    // so set it only for a new label or a new node size.
    if (fontChanged) {
      node.fontDirty = true;
    }
    return fontChanged || textChanged;
  }

  clearRendererMetadata(renderer) {
    for (const node of renderer?.nodes ?? []) {
      delete node[CANVAS_NODE_LABEL_PROPERTY];
      delete node[CANVAS_NODE_SHAPE_PROPERTY];
      this.plugin.drawCanvasGraphNodeShape?.(node);
    }
    for (const link of renderer?.links ?? []) {
      delete link[CANVAS_ZONE_ATTRACTION_PROPERTY];
      delete link[CANVAS_LINK_COLOR_PROPERTY];
    }
    if (renderer) {
      delete renderer[CANVAS_CLOUDS_ACTIVE_PROPERTY];
    }
    renderer?.changed?.();
  }

  // Reload Canvas data now. Without a request, reload every Canvas.
  hydrate(request) {
    this.queueHydration(request);
    return this.startHydration();
  }

  startHydration() {
    if (!this.hydration && this.pendingHydration) {
      const hydration = this.drainHydration();
      // A drain that ends before its first await has already run its finally block. Do not keep its promise.
      if (this.hydrationRunning) {
        this.hydration = hydration;
      }
    }
    return this.hydration ?? Promise.resolve();
  }

  // Run queued reloads one at a time. The finally block clears the promise in the same turn as the
  // last queue check, so a request cannot stay in the queue without a run.
  async drainHydration() {
    this.hydrationRunning = true;
    let failed = false;
    try {
      for (;;) {
        if (this.unloaded) {
          return;
        }
        if (!this.pendingHydration && !failed && this.needsHydration && this.canRunOwedHydration()) {
          this.queueHydration();
        }
        const pending = this.pendingHydration;
        if (!pending) {
          return;
        }
        this.pendingHydration = null;

        const full = pending.full || !this.hydrated;
        const canvasPaths = full ? undefined : this.getHydrationCanvasPaths(pending);
        if (canvasPaths?.length === 0) {
          continue;
        }
        if (full) {
          this.needsHydration = false;
        }
        try {
          await this.loadCanvasGraphData(canvasPaths);
        } catch (error) {
          // Do not try again in this drain. The next request or graph sync tries a full reload.
          failed = true;
          this.needsHydration = true;
          console.error("Cluddle Graphs: failed to load canvas graph data", error);
        }
      }
    } finally {
      this.hydrationRunning = false;
      this.hydration = null;
    }
  }

  // A request that came while no graph was open needs a full reload when a graph is open again.
  canRunOwedHydration() {
    return !this.suppressHydrationRequests && this.hasOpenGraphView();
  }

  // Without paths, reload every Canvas.
  async loadCanvasGraphData(paths) {
    const vault = this.plugin.app.vault;
    const full = paths === undefined;
    const wasHydrated = this.hydrated;
    const previousSignatures = this.canvasSignatures ?? {};
    const canvasPaths = full
      ? vault.getFiles().filter((vaultFile) => vaultFile.extension === "canvas").map((vaultFile) => vaultFile.path)
      : [...new Set(paths)];
    // Keep the nodes of each Canvas apart, so that a partial reload can merge them again.
    const state = {
      links: full ? {} : { ...this.canvasGraphLinks },
      memberships: full ? {} : { ...this.canvasMemberships },
      references: full ? {} : { ...(this.canvasReferences ?? {}) },
      signatures: full ? {} : { ...previousSignatures },
      nodeMaps: full ? {} : { ...(this.canvasNodeMaps ?? {}) }
    };

    for (const canvasPath of canvasPaths) {
      if (this.unloaded) {
        return;
      }
      let entries;
      try {
        entries = await this.readCanvasEntries(canvasPath);
      } catch (error) {
        // Keep the loaded data of this Canvas. Its next modify event reads it again.
        console.error("Cluddle Graphs: failed to read canvas graph data", canvasPath, error);
        entries = this.getLoadedCanvasEntries(canvasPath);
      }
      this.setCanvasEntries(state, canvasPath, entries);
    }

    if (this.unloaded) {
      return;
    }
    this.canvasReferences = state.references;
    this.hydrated = true;
    if (wasHydrated && !this.hasCanvasSignatureChange(previousSignatures, state.signatures)) {
      return;
    }

    this.canvasGraphLinks = state.links;
    this.invalidateCanvasGraphLinkCache();
    this.canvasNodeMaps = state.nodeMaps;
    this.canvasGraphNodes = this.mergeCanvasNodeMaps(state.nodeMaps);
    this.canvasMemberships = state.memberships;
    this.canvasSignatures = state.signatures;
    this.renderOpenGraphViews();
  }

  // Return the parsed entries of one Canvas, or null when the path is not a Canvas file.
  async readCanvasEntries(canvasPath) {
    const vault = this.plugin.app.vault;
    const canvasFile = vault.getAbstractFileByPath(canvasPath);
    if (!(canvasFile instanceof TFile) || canvasFile.extension !== "canvas") {
      return null;
    }

    const graphData = this.parseCanvasGraphData(canvasPath, await vault.cachedRead(canvasFile));
    return {
      links: graphData.links,
      memberships: graphData.memberships,
      references: graphData.references,
      signature: this.getCanvasGraphDataSignature(graphData),
      nodes: graphData.nodes
    };
  }

  // Return the loaded entries of one Canvas, or null when no data of that Canvas is loaded.
  getLoadedCanvasEntries(canvasPath) {
    if (!Object.hasOwn(this.canvasSignatures ?? {}, canvasPath)) {
      return null;
    }
    return {
      links: this.canvasGraphLinks[canvasPath],
      memberships: this.canvasMemberships[canvasPath],
      references: this.canvasReferences?.[canvasPath] ?? [],
      signature: this.canvasSignatures[canvasPath],
      nodes: this.canvasNodeMaps?.[canvasPath] ?? {}
    };
  }

  // Without entries, remove the Canvas.
  setCanvasEntries(state, canvasPath, entries) {
    if (!entries) {
      delete state.links[canvasPath];
      delete state.memberships[canvasPath];
      delete state.references[canvasPath];
      delete state.signatures[canvasPath];
      delete state.nodeMaps[canvasPath];
      return;
    }
    state.links[canvasPath] = entries.links;
    state.memberships[canvasPath] = entries.memberships;
    state.references[canvasPath] = entries.references;
    state.signatures[canvasPath] = entries.signature;
    state.nodeMaps[canvasPath] = entries.nodes;
  }

  // Merge in Canvas path order, so that a node that two Canvases share does not depend on the reload history.
  mergeCanvasNodeMaps(nodeMaps) {
    const nodes = {};
    for (const canvasPath of Object.keys(nodeMaps).sort()) {
      Object.assign(nodes, nodeMaps[canvasPath]);
    }
    return nodes;
  }

  // The signature holds only the parsed graph output, so a move that keeps the group memberships is not a change.
  getCanvasGraphDataSignature(graphData) {
    return JSON.stringify([graphData.links, graphData.nodes, graphData.memberships]);
  }

  hasCanvasSignatureChange(previous, next) {
    const canvasPaths = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const canvasPath of canvasPaths) {
      if (previous[canvasPath] !== next[canvasPath]) {
        return true;
      }
    }
    return false;
  }

  parseCanvasGraphData(canvasPath, source) {
    let data;
    try {
      data = JSON.parse(source);
    } catch {
      return { links: {}, nodes: {}, memberships: [], references: [] };
    }

    const rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
    // Keep the raw and resolved paths of file nodes as reference keys, so that a change to one of
    // these paths reloads this Canvas.
    const references = new Set();
    const groupMembership = this.getCanvasGroupMembership(data);
    const parentGroupByNodeId = this.getCanvasParentGroupByNodeId(groupMembership);
    const inheritedGroupColors = this.getCanvasInheritedGroupColors(rawNodes, parentGroupByNodeId);
    const canvasNode = this.toCanvasFileGraphNode(canvasPath);
    const graphNodes = new Map();
    for (const node of rawNodes) {
      if (node?.type === "file" && typeof node.file === "string" && node.file) {
        references.add(this.getCanvasReferenceKey(node.file));
      }
      const graphNode = this.toCanvasGraphNode(canvasPath, node, {
        inheritedColor: this.getCanvasParentGroupColor(node.id, parentGroupByNodeId, inheritedGroupColors)
      });
      if (graphNode) {
        graphNodes.set(node.id, graphNode);
        if (graphNode.type === "file") {
          references.add(this.getCanvasReferenceKey(graphNode.id));
        }
      }
    }

    const links = {};
    const nodes = {};
    const memberships = new Set([canvasNode.id]);
    nodes[canvasNode.id] = this.toGraphNodeMetadata(canvasNode);
    for (const graphNode of graphNodes.values()) {
      nodes[graphNode.id] ??= this.toGraphNodeMetadata(graphNode);
      memberships.add(graphNode.id);
      this.addCanvasGraphLink(links, canvasNode.id, graphNode.id, {
        kind: "parentMembership"
      });
    }

    for (const edge of data.edges ?? []) {
      const sourceNode = graphNodes.get(edge.fromNode);
      const targetNode = graphNodes.get(edge.toNode);
      if (!sourceNode || !targetNode) {
        continue;
      }

      nodes[sourceNode.id] = this.toGraphNodeMetadata(sourceNode);
      nodes[targetNode.id] = this.toGraphNodeMetadata(targetNode);
      this.addCanvasGraphLink(links, sourceNode.id, targetNode.id, {
        kind: "edge",
        color: edge.color
      });
    }

    for (const [groupNodeId, group] of Object.entries(groupMembership.groups)) {
      const sourceNode = graphNodes.get(groupNodeId);
      if (!sourceNode) {
        continue;
      }

      for (const memberNodeId of group.memberIds ?? []) {
        const targetNode = graphNodes.get(memberNodeId);
        if (!targetNode) {
          continue;
        }

        nodes[sourceNode.id] = this.toGraphNodeMetadata(sourceNode);
        nodes[targetNode.id] = this.toGraphNodeMetadata(targetNode);
        this.addCanvasGraphLink(links, sourceNode.id, targetNode.id, {
          kind: "groupMembership"
        });
      }
    }

    return { links, nodes, memberships: [...memberships], references: [...references] };
  }

  addCanvasGraphLink(links, sourceId, targetId, options = {}) {
    const sourceLinks = links[sourceId] ??= {};
    const resolvedLink = sourceLinks[targetId] ??= {
      count: 0,
      colors: [],
      edgeCount: 0,
      parentMembershipCount: 0,
      groupMembershipCount: 0
    };

    resolvedLink.count++;
    if (options.kind === "parentMembership") {
      resolvedLink.parentMembershipCount++;
    } else if (options.kind === "groupMembership") {
      resolvedLink.groupMembershipCount++;
    } else {
      resolvedLink.edgeCount++;
    }

    if (options.color && !resolvedLink.colors.includes(options.color)) {
      resolvedLink.colors.push(options.color);
    }
  }

  getCanvasGroupMembership(data) {
    const geometryHash = this.getGroupMembershipGeometryHash(data);
    const cachedMembership = data.metadata?.cluddlegraphs?.groupMembership;
    if (this.isValidGroupMembershipMetadata(cachedMembership, geometryHash)) {
      return cachedMembership;
    }

    return this.calculateGroupMembershipMetadata(data, geometryHash);
  }

  getCanvasParentGroupByNodeId(groupMembership) {
    const parentGroupByNodeId = {};
    for (const [groupNodeId, group] of Object.entries(groupMembership?.groups ?? {})) {
      for (const memberId of group.memberIds ?? []) {
        parentGroupByNodeId[memberId] = groupNodeId;
      }
    }
    return parentGroupByNodeId;
  }

  getCanvasInheritedGroupColors(nodes, parentGroupByNodeId) {
    const nodeById = new Map();
    for (const node of nodes) {
      if (node?.id) {
        nodeById.set(node.id, node);
      }
    }

    const groupColors = new Map();
    const resolving = new Set();
    const resolveGroupColor = (groupNodeId) => {
      if (groupColors.has(groupNodeId)) {
        return groupColors.get(groupNodeId);
      }
      if (resolving.has(groupNodeId)) {
        return null;
      }

      resolving.add(groupNodeId);
      const groupNode = nodeById.get(groupNodeId);
      const parentGroupId = parentGroupByNodeId[groupNodeId];
      const color = this.getCanvasNodeColor(groupNode)
        ?? (parentGroupId ? resolveGroupColor(parentGroupId) : null);
      resolving.delete(groupNodeId);
      groupColors.set(groupNodeId, color);
      return color;
    };

    for (const node of nodes) {
      if (this.isCanvasGroupNode(node)) {
        resolveGroupColor(node.id);
      }
    }
    return groupColors;
  }

  getCanvasParentGroupColor(nodeId, parentGroupByNodeId, inheritedGroupColors) {
    const parentGroupId = parentGroupByNodeId?.[nodeId];
    return parentGroupId ? inheritedGroupColors.get(parentGroupId) ?? null : null;
  }

  calculateGroupMembershipMetadata(data, geometryHash = this.getGroupMembershipGeometryHash(data)) {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const groupEntries = [];
    const groups = {};

    for (const node of nodes) {
      if (!this.isCanvasGroupNode(node)) {
        continue;
      }

      const bbox = this.getCanvasGroupBBox(node);
      if (!bbox) {
        continue;
      }

      groupEntries.push({
        id: node.id,
        bbox,
        area: this.getBBoxArea(bbox)
      });
      groups[node.id] = {
        label: this.cleanLabel(node.label) || "Group",
        memberIds: []
      };
    }

    for (const node of nodes) {
      if (!this.isGroupMembershipNode(node)) {
        continue;
      }

      const nodeBBox = this.getCanvasNodeBBox(node);
      if (!nodeBBox) {
        continue;
      }

      let containingGroup = null;
      for (const group of groupEntries) {
        if (group.id === node.id || !this.isBBoxInside(nodeBBox, group.bbox)) {
          continue;
        }

        if (!containingGroup
          || group.area < containingGroup.area
          || (group.area === containingGroup.area && group.id < containingGroup.id)) {
          containingGroup = group;
        }
      }

      if (containingGroup) {
        groups[containingGroup.id].memberIds.push(node.id);
      }
    }

    for (const group of Object.values(groups)) {
      group.memberIds.sort();
    }

    return {
      version: GROUP_MEMBERSHIP_METADATA_VERSION,
      updatedAt: new Date().toISOString(),
      geometryHash,
      groups
    };
  }

  isValidGroupMembershipMetadata(metadata, geometryHash) {
    return !!metadata
      && metadata.version === GROUP_MEMBERSHIP_METADATA_VERSION
      && metadata.geometryHash === geometryHash
      && metadata.groups
      && typeof metadata.groups === "object"
      && !Array.isArray(metadata.groups);
  }

  isGroupMembershipNode(node) {
    return !!node?.id
      && (node.type === "file" || node.type === "text" || node.type === "link" || node.type === "group");
  }

  isCanvasGroupNode(node) {
    return !!node?.id && node.type === "group";
  }

  getCanvasGroupBBox(node) {
    const bbox = this.getCanvasNodeBBox(node);
    return bbox ? { ...bbox, minY: bbox.minY - CANVAS_GROUP_TOP_EXTENSION } : null;
  }

  getCanvasNodeBBox(node) {
    const x = this.toFiniteNumber(node?.x);
    const y = this.toFiniteNumber(node?.y);
    const width = this.toFiniteNumber(node?.width);
    const height = this.toFiniteNumber(node?.height);
    if (x === null || y === null || width === null || height === null) {
      return null;
    }

    return {
      minX: x,
      minY: y,
      maxX: x + width,
      maxY: y + height
    };
  }

  isBBoxInside(inner, outer) {
    return inner.minX > outer.minX
      && inner.minY > outer.minY
      && inner.maxX < outer.maxX
      && inner.maxY < outer.maxY;
  }

  getBBoxArea(bbox) {
    return Math.abs((bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY));
  }

  toFiniteNumber(value) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  getGroupMembershipGeometryHash(data) {
    const entries = (Array.isArray(data.nodes) ? data.nodes : [])
      .filter((node) => this.isGroupMembershipNode(node))
      .map((node) => ({
        id: String(node.id),
        type: String(node.type),
        x: this.toFiniteNumber(node.x),
        y: this.toFiniteNumber(node.y),
        width: this.toFiniteNumber(node.width),
        height: this.toFiniteNumber(node.height),
        label: node.type === "group" ? String(node.label ?? "") : ""
      }))
      .sort((a, b) => a.id.localeCompare(b.id) || a.type.localeCompare(b.type));

    return this.hashString(JSON.stringify(entries));
  }

  hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  toCanvasFileGraphNode(canvasPath) {
    const file = this.plugin.app.vault.getAbstractFileByPath(canvasPath);
    const basename = file instanceof TFile ? file.basename : canvasPath.replace(/\.canvas$/i, "");
    return {
      id: canvasPath,
      canvasPath,
      label: basename,
      searchPath: canvasPath,
      searchText: basename,
      type: "file"
    };
  }

  toCanvasGraphNode(canvasPath, node, options = {}) {
    if (!node?.id || !node.type) {
      return null;
    }

    if (node.type === "file") {
      const resolvedFile = node.file
        ? this.plugin.app.metadataCache.getFirstLinkpathDest(node.file, canvasPath)
        : null;
      if (!resolvedFile) {
        return null;
      }

      return {
        id: resolvedFile.path,
        canvasPath,
        canvasColor: this.getCanvasNodeColor(node),
        inheritedColor: options.inheritedColor ?? null,
        label: resolvedFile.basename,
        searchPath: resolvedFile.path,
        searchText: resolvedFile.basename,
        type: "file"
      };
    }

    if (node.type !== "text" && node.type !== "link" && node.type !== "group") {
      return null;
    }

    return {
      id: this.getGraphOnlyNodeId(canvasPath, node.id),
      canvasPath,
      canvasColor: this.getCanvasNodeColor(node),
      inheritedColor: options.inheritedColor ?? null,
      label: this.getGraphOnlyNodeLabel(node),
      searchPath: canvasPath,
      searchText: this.getGraphOnlyNodeSearchText(node),
      type: node.type
    };
  }

  toGraphNodeMetadata(node) {
    return {
      canvasPath: node.canvasPath,
      canvasColor: node.canvasColor ?? null,
      inheritedColor: node.inheritedColor ?? null,
      label: node.label,
      searchPath: node.searchPath,
      searchText: node.searchText,
      type: node.type
    };
  }

  getCanvasNodeColor(node) {
    const color = node?.color;
    return color === undefined || color === null || color === "" ? null : color;
  }

  getGraphOnlyNodeLabel(node) {
    if (node.type === "text") {
      return this.cleanLabel(node.text) || "Text card";
    }
    if (node.type === "link") {
      return this.cleanLabel(this.getUrlLabel(node.url)) || "Link card";
    }
    return this.cleanLabel(node.label) || "Group";
  }

  getGraphOnlyNodeSearchText(node) {
    if (node.type === "text") {
      return this.cleanLabel(node.text) || "Text card";
    }
    if (node.type === "link") {
      return `${this.cleanLabel(this.getUrlLabel(node.url))} ${String(node.url ?? "")}`.trim() || "Link card";
    }
    return this.cleanLabel(node.label) || "Group";
  }

  cleanLabel(label) {
    return String(label ?? "")
      .replace(/!\[\[[^\]]+\]\]/g, "")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, link, alias) => alias ?? link)
      .replace(/[*_`>#-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  getUrlLabel(url) {
    try {
      return new URL(url).hostname || url;
    } catch {
      return url;
    }
  }

  getGraphOnlyNodeId(canvasPath, nodeId) {
    return `${canvasPath}#${CANVAS_GRAPH_ONLY_NODE_PREFIX}-${nodeId}`;
  }

  getCanvasGraphLinks(data, engine) {
    // The engine state does not change in one rebuild, so check each path one time.
    const allowedPaths = new Map();
    const isAllowed = (path) => {
      let allowed = allowedPaths.get(path);
      if (allowed === undefined) {
        allowed = this.shouldAllowGraphNode(engine, path);
        allowedPaths.set(path, allowed);
      }
      return allowed;
    };

    const links = {};
    for (const [key, link] of Object.entries(this.getCanvasGraphLinkProjection(engine))) {
      if (!isAllowed(link.sourcePath) || !isAllowed(link.targetPath)) {
        continue;
      }

      links[key] = link;
    }

    return engine.options?.localFile ? this.filterLocalCanvasGraphLinks(engine, links) : links;
  }

  getCanvasGraphLinkProjection(engine) {
    const projectionKey = `${this.shouldShowParentMemberships(engine) ? 1 : 0}:${this.shouldShowGroupMemberships(engine) ? 1 : 0}`;
    const cached = this.canvasGraphLinkProjectionCache.get(projectionKey);
    if (cached?.revision === this.canvasGraphLinkRevision) {
      return cached.links;
    }

    const links = {};
    for (const [key, link] of Object.entries(this.getCanvasGraphLinkIndex())) {
      const visibleCount = this.getVisibleCanvasGraphLinkCount(link, engine);
      if (visibleCount === 0) {
        continue;
      }

      links[key] = {
        sourcePath: link.sourcePath,
        targetPath: link.targetPath,
        count: visibleCount,
        colors: this.getVisibleCanvasGraphLinkColors(link),
        edgeCount: this.getCanvasGraphEdgeCount(link),
        parentMembershipCount: this.shouldShowParentMemberships(engine) ? link.parentMembershipCount ?? 0 : 0,
        groupMembershipCount: this.shouldShowGroupMemberships(engine) ? link.groupMembershipCount ?? 0 : 0
      };
    }

    this.canvasGraphLinkProjectionCache.set(projectionKey, {
      revision: this.canvasGraphLinkRevision,
      links
    });
    return links;
  }

  getCanvasGraphLinkIndex() {
    if (this.canvasGraphLinkIndex?.revision === this.canvasGraphLinkRevision) {
      return this.canvasGraphLinkIndex.links;
    }

    const links = {};
    for (const canvasLinks of Object.values(this.canvasGraphLinks)) {
      for (const [sourcePath, targets] of Object.entries(canvasLinks)) {
        for (const [targetPath, link] of Object.entries(targets)) {
          if (sourcePath === targetPath) {
            continue;
          }

          const key = this.getLinkKey(sourcePath, targetPath);
          const indexedLink = links[key] ??= {
            sourcePath,
            targetPath,
            count: 0,
            colors: [],
            edgeCount: 0,
            parentMembershipCount: 0,
            groupMembershipCount: 0
          };
          indexedLink.count += link.count ?? 0;
          indexedLink.edgeCount += this.getCanvasGraphEdgeCount(link);
          indexedLink.parentMembershipCount += link.parentMembershipCount ?? 0;
          indexedLink.groupMembershipCount += link.groupMembershipCount ?? 0;
          for (const color of this.getVisibleCanvasGraphLinkColors(link)) {
            if (!indexedLink.colors.includes(color)) {
              indexedLink.colors.push(color);
            }
          }
        }
      }
    }

    this.canvasGraphLinkIndex = {
      revision: this.canvasGraphLinkRevision,
      links
    };
    return links;
  }

  invalidateCanvasGraphLinkCache() {
    this.canvasGraphLinkRevision++;
    this.canvasGraphLinkIndex = null;
    this.canvasGraphLinkProjectionCache.clear();
  }

  getVisibleCanvasGraphLinkCount(link, engine) {
    const edgeCount = this.getCanvasGraphEdgeCount(link);
    const parentMembershipCount = this.shouldShowParentMemberships(engine) ? link.parentMembershipCount ?? 0 : 0;
    const groupMembershipCount = this.shouldShowGroupMemberships(engine) ? link.groupMembershipCount ?? 0 : 0;
    return edgeCount + parentMembershipCount + groupMembershipCount;
  }

  getCanvasGraphEdgeCount(link) {
    return typeof link.edgeCount === "number" ? link.edgeCount : link.count ?? 0;
  }

  getVisibleCanvasGraphLinkColors(link) {
    return this.getCanvasGraphEdgeCount(link) > 0 ? link.colors ?? [] : [];
  }

  addCanvasZoneAttractionLinks(data, engine) {
    const hiddenLinkKeys = new Set();
    const existingLinks = this.getGraphLinkKeys(data);
    const showParentLinks = this.shouldShowParentMemberships(engine);

    for (const [canvasPath, nodeIds] of Object.entries(this.canvasMemberships)) {
      const memberIds = [];
      const seen = new Set();
      const candidateIds = [];
      for (const nodeId of nodeIds ?? []) {
        if (seen.has(nodeId)) {
          continue;
        }
        seen.add(nodeId);
        candidateIds.push(nodeId);
      }

      if (!candidateIds.some((nodeId) => data.nodes?.[nodeId])) {
        continue;
      }

      for (const nodeId of candidateIds) {
        if (nodeId === canvasPath && !showParentLinks && !data.nodes?.[nodeId]) {
          continue;
        }
        if (!data.nodes?.[nodeId]) {
          this.ensureGraphNode(data, engine, nodeId);
        }
        if (!data.nodes?.[nodeId]) {
          continue;
        }
        memberIds.push(nodeId);
      }

      if (showParentLinks && memberIds.length > 0 && canvasPath && !memberIds.includes(canvasPath)) {
        this.ensureGraphNode(data, engine, canvasPath);
        if (data.nodes?.[canvasPath]) {
          memberIds.unshift(canvasPath);
        }
      }

      const attractionMemberIds = showParentLinks
        ? memberIds
        : memberIds.filter((memberId) => memberId !== canvasPath);

      if (attractionMemberIds.length < 2) {
        continue;
      }

      for (const [sourceId, targetId] of this.getZoneAttractionPairs(attractionMemberIds)) {
        if (sourceId === targetId || this.hasAnyDirectionLink(existingLinks, sourceId, targetId)) {
          continue;
        }

        data.nodes[sourceId].links ??= {};
        data.nodes[sourceId].links[targetId] = true;
        const linkKey = this.getLinkKey(sourceId, targetId);
        existingLinks.add(linkKey);
        hiddenLinkKeys.add(linkKey);
      }
    }

    if (hiddenLinkKeys.size > 0) {
      this.zoneAttractionLinkKeys.set(engine, hiddenLinkKeys);
    }
    return hiddenLinkKeys;
  }

  getZoneAttractionPairs(memberIds) {
    const pairs = [];
    const hub = memberIds[0];
    for (const memberId of memberIds.slice(1)) {
      pairs.push([hub, memberId]);
    }

    if (memberIds.length > 2) {
      for (let index = 0; index < memberIds.length; index++) {
        pairs.push([memberIds[index], memberIds[(index + 1) % memberIds.length]]);
      }
    }

    return pairs;
  }

  hasAnyDirectionLink(linkKeys, sourceId, targetId) {
    return linkKeys.has(this.getLinkKey(sourceId, targetId))
      || linkKeys.has(this.getLinkKey(targetId, sourceId));
  }

  filterLocalCanvasGraphLinks(engine, links) {
    const localFile = engine.options.localFile;
    const localDepth = Number.isFinite(engine.options.localJumps)
      ? engine.options.localJumps
      : DEFAULT_LOCAL_CANVAS_DEPTH;
    const maxDepth = Math.max(1, localDepth);
    const includedNodes = new Set([localFile]);
    const includedLinks = new Set();
    let frontier = new Set([localFile]);

    for (let depth = 0; depth < maxDepth && frontier.size > 0; depth++) {
      const nextFrontier = new Set();

      for (const [key, link] of Object.entries(links)) {
        if (engine.options.localForelinks !== false && frontier.has(link.sourcePath)) {
          includedLinks.add(key);
          if (!includedNodes.has(link.targetPath)) {
            includedNodes.add(link.targetPath);
            nextFrontier.add(link.targetPath);
          }
        }

        if (engine.options.localBacklinks !== false && frontier.has(link.targetPath)) {
          includedLinks.add(key);
          if (!includedNodes.has(link.sourcePath)) {
            includedNodes.add(link.sourcePath);
            nextFrontier.add(link.sourcePath);
          }
        }
      }

      frontier = nextFrontier;
    }

    if (engine.options.localInterlinks === true) {
      for (const [key, link] of Object.entries(links)) {
        if (includedNodes.has(link.sourcePath) && includedNodes.has(link.targetPath)) {
          includedLinks.add(key);
        }
      }
    }

    const filteredLinks = {};
    for (const key of includedLinks) {
      filteredLinks[key] = links[key];
    }
    return filteredLinks;
  }

  shouldAllowGraphNode(engine, path) {
    if (this.isGraphOnlyNode(path)) {
      return this.shouldShowCards(engine)
        && (!engine.hasFilter || !this.getCanvasSearchQuery(engine) || !!engine.fileFilter?.[path]);
    }
    if (!engine.options?.showAttachments && this.isAttachmentPath(path) && !this.isCanvasFileNode(path)) {
      return false;
    }
    if (typeof this.plugin.app.metadataCache.isUserIgnored === "function"
      && this.plugin.app.metadataCache.isUserIgnored(path)) {
      return false;
    }
    if (engine.hasFilter) {
      return !!engine.fileFilter?.[path];
    }
    return true;
  }

  addCanvasSearchResultNodes(data, engine) {
    if (!engine.hasFilter || !this.shouldShowCards(engine)) {
      return;
    }

    for (const nodeId of this.searchMatches.get(engine) ?? []) {
      this.ensureGraphNode(data, engine, nodeId);
    }
  }

  // A link that the source node has before this call is a native link. Each Canvas link key is unique,
  // so this check gives the same result as a set of the native link keys, with no key for each native link.
  addCanvasGraphLinks(data, engine, canvasLinks) {
    const injectedLinkKeys = new Set();
    for (const link of Object.values(canvasLinks)) {
      this.ensureGraphNode(data, engine, link.sourcePath);
      this.ensureGraphNode(data, engine, link.targetPath);

      const sourceNode = data.nodes[link.sourcePath];
      if (!sourceNode || !data.nodes[link.targetPath]) {
        continue;
      }

      sourceNode.links ??= {};
      const isNativeLink = Object.hasOwn(sourceNode.links, link.targetPath);
      sourceNode.links[link.targetPath] = true;
      if (!isNativeLink) {
        injectedLinkKeys.add(this.getLinkKey(link.sourcePath, link.targetPath));
      }
    }
    return injectedLinkKeys;
  }

  ensureGraphNode(data, engine, path) {
    if (data.nodes[path] || !this.shouldAllowGraphNode(engine, path)) {
      return;
    }

    const metadata = this.canvasGraphNodes[path];
    if (!metadata && !(this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
      return;
    }

    data.nodes[path] = {
      type: metadata && metadata.type !== "file" ? "cluddlegraphs-canvas-card" : this.isAttachmentPath(path) ? "attachment" : "",
      links: {}
    };
  }

  removeCanvasGraphLinks(data, canvasLinks, nativeLinks) {
    for (const link of Object.values(canvasLinks)) {
      if (!nativeLinks.has(this.getLinkKey(link.sourcePath, link.targetPath))) {
        delete data.nodes[link.sourcePath]?.links?.[link.targetPath];
      }
    }
  }

  removeGraphLinksByKeys(data, linkKeys) {
    for (const linkKey of linkKeys ?? []) {
      const [sourcePath, targetPath] = this.parseLinkKey(linkKey);
      if (sourcePath && targetPath) {
        delete data.nodes?.[sourcePath]?.links?.[targetPath];
      }
    }
  }

  keepOnlyCanvasGraphLinks(data, canvasLinks) {
    // Index the targets by source, so that the check makes no key string for each graph link.
    const targetsBySource = new Map();
    for (const link of Object.values(canvasLinks)) {
      let targets = targetsBySource.get(link.sourcePath);
      if (!targets) {
        targets = new Set();
        targetsBySource.set(link.sourcePath, targets);
      }
      targets.add(link.targetPath);
    }

    for (const [sourcePath, node] of Object.entries(data.nodes)) {
      const targets = targetsBySource.get(sourcePath);
      for (const targetPath of Object.keys(node.links ?? {})) {
        if (!targets?.has(targetPath)) {
          delete node.links[targetPath];
        }
      }
    }
  }

  removeOrphanNodes(data) {
    const hasIncomingLink = {};
    for (const [sourcePath, node] of Object.entries(data.nodes)) {
      for (const targetPath of Object.keys(node.links ?? {})) {
        if (sourcePath !== targetPath && data.nodes[targetPath]) {
          hasIncomingLink[targetPath] = true;
        }
      }
    }

    for (const [sourcePath, node] of Object.entries(data.nodes)) {
      const hasOutgoingLink = Object.keys(node.links ?? {})
        .some((targetPath) => sourcePath !== targetPath && !!data.nodes[targetPath]);
      if (!hasOutgoingLink && !hasIncomingLink[sourcePath]) {
        delete data.nodes[sourcePath];
      }
    }
  }

  // The link keys of one node are unique, so this count equals the size of getGraphLinkKeys(data).
  countGraphLinks(data) {
    let count = 0;
    for (const node of Object.values(data.nodes ?? {})) {
      count += Object.keys(node.links ?? {}).length;
    }
    return count;
  }

  getGraphLinkKeys(data) {
    const links = new Set();
    for (const [sourcePath, node] of Object.entries(data.nodes ?? {})) {
      for (const targetPath of Object.keys(node.links ?? {})) {
        links.add(this.getLinkKey(sourcePath, targetPath));
      }
    }
    return links;
  }

  getRenderedLinkColor(link, defaultColor, doc) {
    for (const canvasColor of link.colors) {
      const resolvedColor = this.resolveCanvasColorCached(canvasColor, doc);
      if (resolvedColor !== null) {
        return resolvedColor;
      }
    }
    return defaultColor;
  }

  resolveCanvasColor(color, doc) {
    const normalizedColor = this.plugin.normalizeHexColor(color);
    if (normalizedColor) {
      return this.plugin.hexToRgb(normalizedColor);
    }
    if (!/^\d+$/.test(String(color)) || !doc?.createElement) {
      return null;
    }

    const el = doc.createElement("div");
    el.classList.add(`mod-canvas-color-${color}`);
    el.style.color = "var(--canvas-color, rgb(1, 2, 3))";
    el.style.display = "none";
    doc.body.appendChild(el);

    try {
      const resolvedColor = this.parseRgbColor((doc.defaultView ?? window).getComputedStyle(el).color);
      return resolvedColor === UNRESOLVED_CANVAS_COLOR ? null : resolvedColor;
    } finally {
      this.plugin.detachElement(el);
    }
  }

  parseRgbColor(color) {
    const match = color.match(/^rgba?\(\s*(\d+)(?:,|\s+)\s*(\d+)(?:,|\s+)\s*(\d+)/);
    if (!match) {
      return null;
    }
    return (parseInt(match[1], 10) << 16) + (parseInt(match[2], 10) << 8) + parseInt(match[3], 10);
  }

  async refreshAllGroupMembershipMetadata() {
    const vault = this.plugin.app.vault;
    const canvasFiles = vault.getFiles().filter((file) => file.extension === "canvas");
    const result = {
      total: canvasFiles.length,
      updated: 0,
      unchanged: 0,
      failed: 0
    };

    this.suppressHydrationRequests = true;
    try {
      for (const file of canvasFiles) {
        try {
          const changed = await this.refreshGroupMembershipMetadataFile(file);
          if (changed) {
            result.updated++;
          } else {
            result.unchanged++;
          }
        } catch (error) {
          result.failed++;
          console.error("Cluddle Graphs: failed to refresh Canvas group metadata", file.path, error);
        }
      }
    } finally {
      this.suppressHydrationRequests = false;
    }

    await this.hydrate();
    return result;
  }

  async refreshGroupMembershipMetadataFile(file) {
    const vault = this.plugin.app.vault;
    if (typeof vault.process !== "function") {
      throw new Error("Vault.process is unavailable");
    }

    let changed = false;
    await vault.process(file, (source) => {
      const refreshed = this.refreshGroupMembershipMetadataSource(source);
      changed = refreshed.changed;
      return refreshed.source;
    });
    return changed;
  }

  refreshGroupMembershipMetadataSource(source) {
    const data = JSON.parse(source);
    const membership = this.calculateGroupMembershipMetadata(data);
    const currentMembership = data.metadata?.cluddlegraphs?.groupMembership;

    if (this.hasSameGroupMembershipMetadata(currentMembership, membership)) {
      return { source, changed: false };
    }

    data.metadata ??= {};
    data.metadata.cluddlegraphs ??= {};
    data.metadata.cluddlegraphs.groupMembership = membership;
    return {
      source: this.stringifyCanvasData(data, source),
      changed: true
    };
  }

  hasSameGroupMembershipMetadata(currentMembership, nextMembership) {
    return !!currentMembership
      && currentMembership.version === nextMembership.version
      && currentMembership.geometryHash === nextMembership.geometryHash
      && JSON.stringify(currentMembership.groups ?? {}) === JSON.stringify(nextMembership.groups ?? {});
  }

  stringifyCanvasData(data, source) {
    const indentation = this.detectJsonIndentation(source);
    const trailingNewline = source.endsWith("\n") ? "\n" : "";
    return `${JSON.stringify(data, null, indentation)}${trailingNewline}`;
  }

  detectJsonIndentation(source) {
    const match = source.match(/\n([ \t]+)"/);
    return match?.[1] ?? "\t";
  }

  getLinkMode(engine) {
    return this.parseLinkMode(engine.options?.[CANVAS_LINK_MODE_OPTION]) ?? CANVAS_LINK_MODE_DEFAULT;
  }

  parseLinkMode(value) {
    return value === "all" || value === "hide" || value === "only" ? value : null;
  }

  shouldShowCards(engine) {
    return engine.options?.[CANVAS_CARDS_OPTION] !== false;
  }

  shouldShowParentMemberships(engine) {
    return engine.options?.[CANVAS_PARENT_MEMBERSHIPS_OPTION] !== false;
  }

  shouldShowGroupMemberships(engine) {
    return engine.options?.[CANVAS_GROUP_MEMBERSHIPS_OPTION] !== false;
  }

  shouldShowMembershipClouds(engine) {
    return engine.options?.[CANVAS_MEMBERSHIP_CLOUDS_OPTION] === true;
  }

  shouldInheritCardColors(engine) {
    return engine.options?.[CANVAS_INHERIT_CARD_COLORS_OPTION] !== false;
  }

  getLinkColor(engine) {
    return this.plugin.normalizeHexColor(engine.options?.[CANVAS_LINK_COLOR_OPTION])
      ?? this.getDefaultCanvasLinkColor(engine);
  }

  getDefaultCanvasLinkColor(engine) {
    const doc = engine.renderer?.containerEl?.ownerDocument ?? globalThis.document;
    return (doc ? this.plugin.resolveCssColor?.("var(--color-accent)", doc) : null)
      ?? CANVAS_LINK_COLOR_DEFAULT;
  }

  getNodeShape(engine, type) {
    return this.parseShape(engine.options?.[CANVAS_NODE_SHAPE_OPTIONS[type]]) ?? CANVAS_NODE_SHAPE_DEFAULTS[type];
  }

  parseShape(value) {
    return CANVAS_SHAPES.includes(value) ? value : null;
  }

  isGraphOnlyNode(path) {
    return this.canvasGraphNodes[path]?.type !== undefined && this.canvasGraphNodes[path].type !== "file";
  }

  isCanvasFileNode(path) {
    return this.canvasGraphNodes[path]?.type === "file" && String(path).toLowerCase().endsWith(".canvas");
  }

  isAttachmentPath(path) {
    const text = String(path);
    const extension = text.slice(text.lastIndexOf(".") + 1);
    return extension.length !== 2 || extension.toLowerCase() !== "md";
  }

  getLinkKey(sourcePath, targetPath) {
    return `${sourcePath}\0${targetPath}`;
  }

  parseLinkKey(linkKey) {
    const separatorIndex = String(linkKey).indexOf("\0");
    if (separatorIndex < 0) {
      return [null, null];
    }
    return [
      linkKey.slice(0, separatorIndex),
      linkKey.slice(separatorIndex + 1)
    ];
  }

  hasOpenGraphView() {
    return this.plugin.hasOpenGraphView();
  }

  renderOpenGraphViews() {
    this.plugin.renderOpenGraphViews();
  }
};
