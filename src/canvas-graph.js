const { Setting, TFile, setIcon } = require("obsidian");
const {
  CANVAS_LINK_COLOR_PROPERTY,
  CANVAS_NODE_COLOR_PROPERTY,
  CANVAS_NODE_COLOR_SOURCE_PROPERTY,
  CANVAS_NODE_LABEL_PROPERTY,
  CANVAS_NODE_SHAPE_PROPERTY,
  CANVAS_ZONE_ATTRACTION_PROPERTY
} = require("./graph-properties");

const CANVAS_LINK_MODE_OPTION = "cluddlegraphsCanvasLinkMode";
const CANVAS_LINK_COLOR_OPTION = "cluddlegraphsCanvasLinkColor";
const CANVAS_CARDS_OPTION = "cluddlegraphsCanvasCards";
const CANVAS_GROUP_MEMBERSHIPS_OPTION = "cluddlegraphsCanvasGroupMemberships";
const CANVAS_MEMBERSHIP_CLOUDS_OPTION = "cluddlegraphsCanvasMembershipClouds";
const CANVAS_INHERIT_CARD_COLORS_OPTION = "cluddlegraphsCanvasInheritCardColors";
const CANVAS_NODE_SHAPE_OPTIONS = {
  file: "cluddlegraphsCanvasFileNodeShape",
  text: "cluddlegraphsCanvasTextNodeShape",
  link: "cluddlegraphsCanvasLinkNodeShape",
  group: "cluddlegraphsCanvasGroupNodeShape"
};
const CANVAS_LINK_MODE_DEFAULT = "all";
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
  link: "Link cards",
  group: "Group cards"
};
const CANVAS_NODE_TYPE_DESCRIPTIONS = {
  file: "Canvas file card node shape.",
  text: "Canvas text card node shape.",
  link: "Canvas link card node shape.",
  group: "Canvas group card node shape."
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
const CANVAS_GROUP_MEMBERSHIPS_CLASS = "cluddlegraphs-canvas-group-memberships";
const CANVAS_LINK_COLOR_CLASS = "cluddlegraphs-canvas-link-color";
const CANVAS_MEMBERSHIP_CLOUDS_CLASS = "cluddlegraphs-canvas-membership-clouds";
const CANVAS_INHERIT_CARD_COLORS_CLASS = "cluddlegraphs-canvas-inherit-card-colors";
const CANVAS_NODE_SHAPE_CLASS_PREFIX = "cluddlegraphs-canvas-node-shape";
const GROUP_MEMBERSHIP_METADATA_VERSION = 1;
const UNRESOLVED_CANVAS_COLOR = 0x010203;
const DEFAULT_LOCAL_CANVAS_DEPTH = 2;
const GRAPH_NODE_CENTER = 100;
const CANVAS_CLOUD_PADDING = GRAPH_NODE_CENTER + 12;
const CANVAS_CLOUD_ALPHA = 0.12;
const CANVAS_CLOUD_LINE_ALPHA = 0.35;
const CANVAS_CLOUD_LINE_WIDTH = 4;
const CANVAS_CLOUD_CORNER_SEGMENTS = 4;
const CANVAS_CLOUD_CIRCLE_SEGMENTS = 20;

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
    this.filterControls = new WeakMap();
    this.filterGroups = new WeakMap();
    this.displayControls = new WeakMap();
    this.displayGroups = new WeakMap();
    this.searchMatches = new WeakMap();
    this.canvasGraphLinks = {};
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

    const requestHydration = (file) => {
      if (this.suppressHydrationRequests) {
        this.needsHydration = true;
        return;
      }
      if (this.hasOpenGraphView()) {
        void this.hydrate(file instanceof TFile && file.extension === "canvas" ? file : undefined);
      } else {
        this.needsHydration = true;
      }
    };

    this.plugin.registerEvent(this.plugin.app.vault.on("create", (file) => {
      requestHydration(file instanceof TFile && file.extension === "canvas" ? file : undefined);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "canvas") {
        requestHydration(file);
      }
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on("delete", () => requestHydration()));
    this.plugin.registerEvent(this.plugin.app.vault.on("rename", () => requestHydration()));
  }

  syncEngine(engine) {
    this.initializeOptions(engine);
    this.addFilterControls(engine);
    this.addDisplayControls(engine);
    this.patchRenderer(engine);

    if (!this.hydrated || this.needsHydration) {
      void this.hydrate();
    }
  }

  restoreEngine(engine) {
    const renderer = engine?.renderer;
    const patch = renderer ? this.rendererPatches.get(renderer) : null;
    if (patch) {
      renderer.setData = patch.setData;
      this.rendererPatches.delete(renderer);
    }

    this.cancelMembershipCloudSync(renderer);
    this.clearMembershipClouds(renderer);
    this.zoneAttractionLinkKeys.delete(engine);
    if (renderer) {
      this.rendererEngines.delete(renderer);
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
    group.nativeControlEl = this.syncNativeCanvasLinksControl(childrenEl, group.contentEl);
    const contentEl = group.contentEl;

    const trackedControls = this.filterControls.get(engine);
    if (trackedControls?.every((setting) => setting.settingEl.parentElement === contentEl)) {
      return;
    }

    this.detachTrackedControls(trackedControls);
    this.removeExistingControls(
      childrenEl,
      [CANVAS_LINK_MODE_CLASS, CANVAS_CARDS_CLASS, CANVAS_GROUP_MEMBERSHIPS_CLASS],
      []
    );
    this.removeExistingControls(
      contentEl,
      [CANVAS_LINK_MODE_CLASS, CANVAS_CARDS_CLASS, CANVAS_GROUP_MEMBERSHIPS_CLASS],
      []
    );

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
      .setName("Link color")
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
      .setDesc(CANVAS_NODE_TYPE_DESCRIPTIONS[type] ?? "Canvas node shape.")
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
    this.removeCanvasFilterGroup(engine);

    delete engine?.filterOptions?.optionListeners?.[CANVAS_LINK_MODE_OPTION];
    delete engine?.filterOptions?.optionListeners?.[CANVAS_CARDS_OPTION];
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

  setMembershipCloudsOption(engine, enabled) {
    const wasEnabled = this.shouldShowMembershipClouds(engine);
    engine.options[CANVAS_MEMBERSHIP_CLOUDS_OPTION] = enabled;

    if (enabled) {
      this.reinitializeMembershipZones(engine);
      return;
    }

    this.zoneAttractionLinkKeys.delete(engine);
    this.clearMembershipClouds(engine?.renderer);
    if (wasEnabled) {
      engine.render?.();
    } else {
      engine.renderer?.changed?.();
    }
  }

  reinitializeMembershipZones(engine) {
    this.clearMembershipClouds(engine?.renderer);
    engine?.render?.();
    this.restartGraphSimulation(engine?.renderer);
    this.syncMembershipClouds(engine);
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

    const titleEl = groupEl.querySelector?.(`.${CANVAS_OPTIONS_GROUP_SUMMARY_CLASS} .tree-item-inner`);
    if (titleEl) {
      titleEl.textContent = CANVAS_OPTIONS_GROUP_TITLE;
    }
    let contentEl = groupEl.querySelector?.(`.${CANVAS_OPTIONS_GROUP_CONTENT_CLASS}`);
    if (!contentEl) {
      contentEl = doc.createElement("div");
      contentEl.classList.add(CANVAS_OPTIONS_GROUP_CONTENT_CLASS, "tree-item-children");
      groupEl.appendChild(contentEl);
    }

    const group = { groupEl, contentEl };
    this.filterGroups.set(engine, group);
    return group;
  }

  createCanvasOptionsGroup(doc) {
    const groupEl = doc.createElement("div");
    groupEl.classList.add(CANVAS_OPTIONS_GROUP_CLASS, CANVAS_FILTER_GROUP_CLASS, "tree-item");

    const summaryEl = doc.createElement("div");
    summaryEl.classList.add(CANVAS_OPTIONS_GROUP_SUMMARY_CLASS, "tree-item-self", "is-clickable");
    const iconEl = doc.createElement("div");
    iconEl.classList.add("tree-item-icon", "collapse-icon");
    setIcon(iconEl, "right-triangle");
    const titleEl = doc.createElement("div");
    titleEl.classList.add("tree-item-inner");
    titleEl.textContent = CANVAS_OPTIONS_GROUP_TITLE;
    summaryEl.appendChild(iconEl);
    summaryEl.appendChild(titleEl);
    summaryEl.addEventListener("click", () => {
      groupEl.classList.toggle("is-collapsed");
    });

    const contentEl = doc.createElement("div");
    contentEl.classList.add(CANVAS_OPTIONS_GROUP_CONTENT_CLASS, "tree-item-children");

    groupEl.appendChild(summaryEl);
    groupEl.appendChild(contentEl);
    return { groupEl, contentEl };
  }

  syncNativeCanvasLinksControl(childrenEl, contentEl) {
    const settingEl = this.findNativeCanvasLinksControl(childrenEl);
    if (!settingEl) {
      return null;
    }

    this.compactNativeCanvasLinksControl(settingEl);
    if (settingEl.parentElement !== contentEl) {
      contentEl.insertBefore(settingEl, contentEl.firstChild);
    }
    return settingEl;
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
      nameEl.textContent = "File links";
    }
    settingEl.classList.add(NATIVE_CANVAS_LINKS_CLASS);
  }

  restoreNativeCanvasLinksControl(settingEl) {
    if (!settingEl) {
      return;
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
    const controller = this;
    renderer.setData = function(data) {
      const canvasLinks = controller.applyCanvasLinksToGraphData(data, engine);
      const result = originalSetData.call(this, data);
      controller.syncRenderer(engine, canvasLinks);
      return result;
    };

    this.rendererPatches.set(renderer, { setData: originalSetData });
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
    if (!engine || this.cloudSyncFrames.has(renderer)) {
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

  cancelMembershipCloudSync(renderer) {
    const frameId = renderer ? this.cloudSyncFrames.get(renderer) : null;
    if (!frameId) {
      return;
    }

    const ownerWindow = renderer?.containerEl?.ownerDocument?.defaultView ?? globalThis;
    const cancelFrame = ownerWindow.cancelAnimationFrame?.bind(ownerWindow)
      ?? ownerWindow.clearTimeout.bind(ownerWindow);
    cancelFrame(frameId);
    this.cloudSyncFrames.delete(renderer);
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

    const layer = this.getMembershipCloudLayer(renderer);
    if (!layer) {
      return;
    }

    layer.clear?.();
    const clouds = this.getVisibleCanvasMembershipClouds(renderer);
    for (const cloud of clouds) {
      this.drawMembershipCloud(layer, cloud.points, cloud.color);
    }
  }

  clearMembershipClouds(renderer) {
    const layer = renderer ? this.cloudLayers.get(renderer) : null;
    layer?.clear?.();
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
    const clouds = [];
    for (const [canvasPath, nodeIds] of Object.entries(this.canvasMemberships)) {
      const points = [];
      const seen = new Set();
      for (const nodeId of nodeIds) {
        if (seen.has(nodeId)) {
          continue;
        }
        seen.add(nodeId);

        const node = renderer.nodeLookup?.[nodeId];
        const point = this.getRendererNodePoint(renderer, node);
        if (point) {
          points.push(point);
        }
      }

      if (points.length === 0) {
        continue;
      }

      clouds.push({
        canvasPath,
        points,
        color: this.getCanvasMembershipCloudColor(renderer, canvasPath)
      });
    }
    return clouds;
  }

  getRendererNodePoint(renderer, node) {
    if (!node) {
      return null;
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

  getCanvasNodeInheritedColor(renderer, canvasPath) {
    if (!canvasPath) {
      return null;
    }

    const engine = this.rendererEngines.get(renderer);
    return this.getGraphNodeColor(renderer?.nodeLookup?.[canvasPath])
      ?? this.toRgbNumber(engine?.fileFilter?.[canvasPath])
      ?? this.getGraphGroupColorForPath(engine, canvasPath);
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

  drawMembershipCloud(graphics, points, color) {
    const polygon = this.createMembershipCloudPolygon(points, CANVAS_CLOUD_PADDING);
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
    const nativeLinks = this.getGraphLinkKeys(data);
    const canvasLinks = this.getCanvasGraphLinks(data, engine);
    const mode = this.getLinkMode(engine);
    this.zoneAttractionLinkKeys.delete(engine);

    if (mode !== "hide") {
      this.addCanvasGraphLinks(data, engine, canvasLinks);
      this.addCanvasSearchResultNodes(data, engine);
    }
    if (mode === "hide") {
      this.removeCanvasGraphLinks(data, canvasLinks, nativeLinks);
    } else if (mode === "only") {
      this.keepOnlyCanvasGraphLinks(data, canvasLinks);
    }

    if (mode !== "all" && !engine.options.showOrphans) {
      this.removeOrphanNodes(data);
    }

    if (this.shouldShowMembershipClouds(engine)) {
      this.addCanvasZoneAttractionLinks(data, engine);
    }

    data.numLinks = this.getGraphLinkKeys(data).size;
    return canvasLinks;
  }

  syncRenderer(engine, canvasLinks) {
    const renderer = engine?.renderer;
    if (!renderer) {
      return;
    }

    const defaultColor = this.plugin.hexToRgb(this.getLinkColor(engine));
    const doc = renderer.containerEl?.ownerDocument ?? renderer.containerEl?.doc ?? globalThis.document;

    for (const node of renderer.nodes ?? []) {
      this.syncNode(engine, node);
      this.plugin.patchGraphNode(node);
      this.plugin.drawCanvasGraphNodeShape(node);
    }

    for (const link of renderer.links ?? []) {
      const linkKey = this.getLinkKey(link.source?.id, link.target?.id);
      const canvasLink = canvasLinks[linkKey];
      if (this.zoneAttractionLinkKeys.get(engine)?.has(linkKey)) {
        link[CANVAS_ZONE_ATTRACTION_PROPERTY] = true;
        delete link[CANVAS_LINK_COLOR_PROPERTY];
      } else if (canvasLink) {
        delete link[CANVAS_ZONE_ATTRACTION_PROPERTY];
        link[CANVAS_LINK_COLOR_PROPERTY] = this.getRenderedLinkColor(canvasLink, defaultColor, doc);
      } else {
        delete link[CANVAS_ZONE_ATTRACTION_PROPERTY];
        delete link[CANVAS_LINK_COLOR_PROPERTY];
      }
      this.plugin.patchGraphLink(link);
    }

    this.syncMembershipClouds(engine);
    renderer.changed?.();
  }

  syncNode(engine, node) {
    const metadata = this.canvasGraphNodes[node?.id];
    if (!metadata || (metadata.type !== "file" && !this.shouldShowCards(engine))) {
      delete node?.[CANVAS_NODE_LABEL_PROPERTY];
      delete node?.[CANVAS_NODE_COLOR_PROPERTY];
      delete node?.[CANVAS_NODE_COLOR_SOURCE_PROPERTY];
      if (node?.[CANVAS_NODE_SHAPE_PROPERTY]) {
        node[CANVAS_NODE_SHAPE_PROPERTY] = "circle";
      }
      return;
    }

    node[CANVAS_NODE_LABEL_PROPERTY] = metadata.type === "file" ? undefined : metadata.label;
    node[CANVAS_NODE_SHAPE_PROPERTY] = this.getNodeShape(engine, metadata.type);
    if (metadata.type !== "file" && this.shouldInheritCardColors(engine)) {
      node[CANVAS_NODE_COLOR_SOURCE_PROPERTY] = metadata.canvasPath;
      delete node[CANVAS_NODE_COLOR_PROPERTY];
    } else if (metadata.type !== "file") {
      const color = this.getGraphGroupColorForPath(engine, metadata.canvasPath);
      delete node[CANVAS_NODE_COLOR_SOURCE_PROPERTY];
      if (color !== null) {
        node[CANVAS_NODE_COLOR_PROPERTY] = color;
      } else {
        delete node[CANVAS_NODE_COLOR_PROPERTY];
      }
    } else {
      delete node[CANVAS_NODE_COLOR_PROPERTY];
      delete node[CANVAS_NODE_COLOR_SOURCE_PROPERTY];
    }
    if (node.text && metadata.type !== "file") {
      node.text.text = metadata.label;
    }
    node.fontDirty = true;
  }

  clearRendererMetadata(renderer) {
    for (const node of renderer?.nodes ?? []) {
      delete node[CANVAS_NODE_COLOR_PROPERTY];
      delete node[CANVAS_NODE_COLOR_SOURCE_PROPERTY];
      delete node[CANVAS_NODE_LABEL_PROPERTY];
      delete node[CANVAS_NODE_SHAPE_PROPERTY];
    }
    for (const link of renderer?.links ?? []) {
      delete link[CANVAS_ZONE_ATTRACTION_PROPERTY];
      delete link[CANVAS_LINK_COLOR_PROPERTY];
    }
    renderer?.changed?.();
  }

  async hydrate(file) {
    if (this.hydration) {
      this.needsHydration = true;
      return this.hydration;
    }

    this.needsHydration = false;
    this.hydration = this.loadCanvasGraphData(file)
      .finally(async () => {
        this.hydration = null;
        if (!this.needsHydration) {
          return;
        }

        this.needsHydration = false;
        await this.hydrate();
      });

    return this.hydration;
  }

  async loadCanvasGraphData(file) {
    const links = file ? { ...this.canvasGraphLinks } : {};
    const nodes = file ? this.removeNodesForCanvas({ ...this.canvasGraphNodes }, file.path) : {};
    const memberships = file ? { ...this.canvasMemberships } : {};
    if (file) {
      delete links[file.path];
      delete memberships[file.path];
    }

    const canvasFiles = file
      ? [file]
      : this.plugin.app.vault.getFiles().filter((vaultFile) => vaultFile.extension === "canvas");

    for (const canvasFile of canvasFiles) {
      try {
        const source = await this.plugin.app.vault.cachedRead(canvasFile);
        const graphData = this.parseCanvasGraphData(canvasFile.path, source);
        links[canvasFile.path] = graphData.links;
        memberships[canvasFile.path] = graphData.memberships;
        Object.assign(nodes, graphData.nodes);
      } catch (error) {
        console.error("Cluddle Graphs: failed to read canvas graph data", canvasFile.path, error);
      }
    }

    this.canvasGraphLinks = links;
    this.canvasGraphNodes = nodes;
    this.canvasMemberships = memberships;
    this.hydrated = true;
    this.renderOpenGraphViews();
  }

  parseCanvasGraphData(canvasPath, source) {
    let data;
    try {
      data = JSON.parse(source);
    } catch {
      return { links: {}, nodes: {}, memberships: [] };
    }

    const graphNodes = new Map();
    for (const node of data.nodes ?? []) {
      const graphNode = this.toCanvasGraphNode(canvasPath, node);
      if (graphNode) {
        graphNodes.set(node.id, graphNode);
      }
    }

    const links = {};
    const nodes = {};
    const memberships = [];
    for (const graphNode of graphNodes.values()) {
      nodes[graphNode.id] ??= this.toGraphNodeMetadata(graphNode);
      memberships.push(graphNode.id);
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

    const groupMembership = this.getCanvasGroupMembership(data);
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

    return { links, nodes, memberships };
  }

  addCanvasGraphLink(links, sourceId, targetId, options = {}) {
    const sourceLinks = links[sourceId] ??= {};
    const resolvedLink = sourceLinks[targetId] ??= {
      count: 0,
      colors: [],
      edgeCount: 0,
      groupMembershipCount: 0
    };

    resolvedLink.count++;
    if (options.kind === "groupMembership") {
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

  calculateGroupMembershipMetadata(data, geometryHash = this.getGroupMembershipGeometryHash(data)) {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const groupEntries = [];
    const groups = {};

    for (const node of nodes) {
      if (!this.isCanvasGroupNode(node)) {
        continue;
      }

      const bbox = this.getCanvasNodeBBox(node);
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

  toCanvasGraphNode(canvasPath, node) {
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
      label: this.getGraphOnlyNodeLabel(node),
      searchPath: canvasPath,
      searchText: this.getGraphOnlyNodeSearchText(node),
      type: node.type
    };
  }

  toGraphNodeMetadata(node) {
    return {
      canvasPath: node.canvasPath,
      label: node.label,
      searchPath: node.searchPath,
      searchText: node.searchText,
      type: node.type
    };
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

  removeNodesForCanvas(nodes, canvasPath) {
    for (const [nodeId, node] of Object.entries(nodes)) {
      if (node.canvasPath === canvasPath) {
        delete nodes[nodeId];
      }
    }
    return nodes;
  }

  getCanvasGraphLinks(data, engine) {
    const links = {};
    for (const canvasLinks of Object.values(this.canvasGraphLinks)) {
      for (const [sourcePath, targets] of Object.entries(canvasLinks)) {
        for (const [targetPath, link] of Object.entries(targets)) {
          if (sourcePath === targetPath) {
            continue;
          }
          const visibleCount = this.getVisibleCanvasGraphLinkCount(link, engine);
          if (visibleCount === 0) {
            continue;
          }
          if (!this.shouldAllowGraphNode(engine, sourcePath) || !this.shouldAllowGraphNode(engine, targetPath)) {
            continue;
          }

          const key = this.getLinkKey(sourcePath, targetPath);
          const existingLink = links[key] ?? {
            sourcePath,
            targetPath,
            count: 0,
            colors: [],
            edgeCount: 0,
            groupMembershipCount: 0
          };
          existingLink.count += visibleCount;
          existingLink.edgeCount += this.getCanvasGraphEdgeCount(link);
          if (this.shouldShowGroupMemberships(engine)) {
            existingLink.groupMembershipCount += link.groupMembershipCount ?? 0;
          }

          for (const color of this.getVisibleCanvasGraphLinkColors(link)) {
            if (!existingLink.colors.includes(color)) {
              existingLink.colors.push(color);
            }
          }
          links[key] = existingLink;
        }
      }
    }

    return engine.options?.localFile ? this.filterLocalCanvasGraphLinks(engine, links) : links;
  }

  getVisibleCanvasGraphLinkCount(link, engine) {
    const edgeCount = this.getCanvasGraphEdgeCount(link);
    const groupMembershipCount = this.shouldShowGroupMemberships(engine) ? link.groupMembershipCount ?? 0 : 0;
    return edgeCount + groupMembershipCount;
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

    for (const nodeIds of Object.values(this.canvasMemberships)) {
      const memberIds = [];
      const seen = new Set();
      for (const nodeId of nodeIds ?? []) {
        if (seen.has(nodeId) || !data.nodes?.[nodeId]) {
          continue;
        }
        seen.add(nodeId);
        memberIds.push(nodeId);
      }

      if (memberIds.length < 2) {
        continue;
      }

      for (const [sourceId, targetId] of this.getZoneAttractionPairs(memberIds)) {
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
    if (!engine.options?.showAttachments && this.isAttachmentPath(path)) {
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

  addCanvasGraphLinks(data, engine, canvasLinks) {
    for (const link of Object.values(canvasLinks)) {
      this.ensureGraphNode(data, engine, link.sourcePath);
      this.ensureGraphNode(data, engine, link.targetPath);

      const sourceNode = data.nodes[link.sourcePath];
      if (!sourceNode || !data.nodes[link.targetPath]) {
        continue;
      }

      sourceNode.links ??= {};
      sourceNode.links[link.targetPath] = true;
    }
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

  keepOnlyCanvasGraphLinks(data, canvasLinks) {
    const canvasLinkKeys = new Set(Object.keys(canvasLinks));
    for (const [sourcePath, node] of Object.entries(data.nodes)) {
      for (const targetPath of Object.keys(node.links ?? {})) {
        if (!canvasLinkKeys.has(this.getLinkKey(sourcePath, targetPath))) {
          delete node.links?.[targetPath];
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
      const resolvedColor = this.resolveCanvasColor(canvasColor, doc);
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
    el.style.color = "rgb(var(--canvas-color, 1, 2, 3))";
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

  shouldShowGroupMemberships(engine) {
    return engine.options?.[CANVAS_GROUP_MEMBERSHIPS_OPTION] !== false;
  }

  shouldShowMembershipClouds(engine) {
    return engine.options?.[CANVAS_MEMBERSHIP_CLOUDS_OPTION] !== false;
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

  isAttachmentPath(path) {
    const extension = String(path).split(".").pop()?.toLowerCase();
    return extension !== "md";
  }

  getLinkKey(sourcePath, targetPath) {
    return `${sourcePath}\0${targetPath}`;
  }

  hasOpenGraphView() {
    return this.plugin.hasOpenGraphView();
  }

  renderOpenGraphViews() {
    this.plugin.renderOpenGraphViews();
  }
};
