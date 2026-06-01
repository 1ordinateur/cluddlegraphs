const { Setting, TFile } = require("obsidian");
const {
  CANVAS_LINK_COLOR_PROPERTY,
  CANVAS_NODE_LABEL_PROPERTY,
  CANVAS_NODE_SHAPE_PROPERTY
} = require("./graph-properties");

const CANVAS_LINK_MODE_OPTION = "cluddlegraphsCanvasLinkMode";
const CANVAS_LINK_COLOR_OPTION = "cluddlegraphsCanvasLinkColor";
const CANVAS_CARDS_OPTION = "cluddlegraphsCanvasCards";
const CANVAS_GROUP_MEMBERSHIPS_OPTION = "cluddlegraphsCanvasGroupMemberships";
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
const CANVAS_GRAPH_ONLY_NODE_PREFIX = "cluddlegraphs-canvas-node";
const CANVAS_LINK_MODE_CLASS = "cluddlegraphs-canvas-link-mode";
const CANVAS_CARDS_CLASS = "cluddlegraphs-canvas-cards";
const CANVAS_GROUP_MEMBERSHIPS_CLASS = "cluddlegraphs-canvas-group-memberships";
const CANVAS_LINK_COLOR_CLASS = "cluddlegraphs-canvas-link-color";
const CANVAS_NODE_SHAPE_CLASS_PREFIX = "cluddlegraphs-canvas-node-shape";
const GROUP_MEMBERSHIP_METADATA_VERSION = 1;
const UNRESOLVED_CANVAS_COLOR = 0x010203;
const DEFAULT_LOCAL_CANVAS_DEPTH = 2;

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
    this.filterControls = new WeakMap();
    this.displayControls = new WeakMap();
    this.canvasGraphLinks = {};
    this.canvasGraphNodes = {};
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

    this.removeControls(engine);
    this.clearRendererMetadata(renderer);
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

    const trackedControls = this.filterControls.get(engine);
    if (trackedControls?.every((setting) => setting.settingEl.parentElement === childrenEl)) {
      return;
    }

    this.removeExistingControls(
      childrenEl,
      [CANVAS_LINK_MODE_CLASS, CANVAS_CARDS_CLASS, CANVAS_GROUP_MEMBERSHIPS_CLASS],
      trackedControls
    );

    const linkModeSetting = new Setting(childrenEl)
      .setName("Canvas links")
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

    const cardsSetting = new Setting(childrenEl)
      .setName("Canvas cards")
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

    const groupMembershipSetting = new Setting(childrenEl)
      .setName("Canvas groups")
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

    const trackedControls = this.displayControls.get(engine);
    if (trackedControls?.every((setting) => setting.settingEl.parentElement === childrenEl)) {
      return;
    }

    this.removeExistingControls(
      childrenEl,
      [CANVAS_LINK_COLOR_CLASS, ...CANVAS_NODE_TYPES.map((type) => `${CANVAS_NODE_SHAPE_CLASS_PREFIX}-${type}`)],
      trackedControls
    );

    const colorSetting = new Setting(childrenEl)
      .setName("Canvas links")
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

    const shapeSettings = CANVAS_NODE_TYPES.map((type) => this.addShapeControl(engine, displayOptions, childrenEl, type));
    this.displayControls.set(engine, [colorSetting, ...shapeSettings]);
  }

  addShapeControl(engine, displayOptions, childrenEl, type) {
    const option = CANVAS_NODE_SHAPE_OPTIONS[type];
    const setting = new Setting(childrenEl)
      .setName(`Canvas ${type} nodes`)
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

    delete engine?.filterOptions?.optionListeners?.[CANVAS_LINK_MODE_OPTION];
    delete engine?.filterOptions?.optionListeners?.[CANVAS_CARDS_OPTION];
    delete engine?.filterOptions?.optionListeners?.[CANVAS_GROUP_MEMBERSHIPS_OPTION];
    delete engine?.displayOptions?.optionListeners?.[CANVAS_LINK_COLOR_OPTION];
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

  patchRenderer(engine) {
    const renderer = engine?.renderer;
    if (!renderer || this.rendererPatches.has(renderer) || typeof renderer.setData !== "function") {
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

  applyCanvasLinksToGraphData(data, engine) {
    const nativeLinks = this.getGraphLinkKeys(data);
    const canvasLinks = this.getCanvasGraphLinks(data, engine);
    const mode = this.getLinkMode(engine);

    if (mode !== "hide") {
      this.addCanvasGraphLinks(data, engine, canvasLinks);
    }
    if (mode === "hide") {
      this.removeCanvasGraphLinks(data, canvasLinks, nativeLinks);
    } else if (mode === "only") {
      this.keepOnlyCanvasGraphLinks(data, canvasLinks);
    }

    if (mode !== "all" && !engine.options.showOrphans) {
      this.removeOrphanNodes(data);
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
    const doc = renderer.containerEl?.ownerDocument ?? renderer.containerEl?.doc ?? document;

    for (const node of renderer.nodes ?? []) {
      this.syncNode(engine, node);
      this.plugin.patchGraphNode(node);
      this.plugin.drawCanvasGraphNodeShape(node);
    }

    for (const link of renderer.links ?? []) {
      const canvasLink = canvasLinks[this.getLinkKey(link.source?.id, link.target?.id)];
      if (canvasLink) {
        link[CANVAS_LINK_COLOR_PROPERTY] = this.getRenderedLinkColor(canvasLink, defaultColor, doc);
      } else {
        delete link[CANVAS_LINK_COLOR_PROPERTY];
      }
      this.plugin.patchGraphLink(link);
    }

    renderer.changed?.();
  }

  syncNode(engine, node) {
    const metadata = this.canvasGraphNodes[node?.id];
    if (!metadata || (metadata.type !== "file" && !this.shouldShowCards(engine))) {
      if (node?.[CANVAS_NODE_SHAPE_PROPERTY]) {
        delete node[CANVAS_NODE_LABEL_PROPERTY];
        node[CANVAS_NODE_SHAPE_PROPERTY] = "circle";
      }
      return;
    }

    node[CANVAS_NODE_LABEL_PROPERTY] = metadata.type === "file" ? undefined : metadata.label;
    node[CANVAS_NODE_SHAPE_PROPERTY] = this.getNodeShape(engine, metadata.type);
    if (node.text && metadata.type !== "file") {
      node.text.text = metadata.label;
    }
    node.fontDirty = true;
  }

  clearRendererMetadata(renderer) {
    for (const node of renderer?.nodes ?? []) {
      delete node[CANVAS_NODE_LABEL_PROPERTY];
      delete node[CANVAS_NODE_SHAPE_PROPERTY];
    }
    for (const link of renderer?.links ?? []) {
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
    if (file) {
      delete links[file.path];
    }

    const canvasFiles = file
      ? [file]
      : this.plugin.app.vault.getFiles().filter((vaultFile) => vaultFile.extension === "canvas");

    for (const canvasFile of canvasFiles) {
      try {
        const source = await this.plugin.app.vault.cachedRead(canvasFile);
        const graphData = this.parseCanvasGraphData(canvasFile.path, source);
        links[canvasFile.path] = graphData.links;
        Object.assign(nodes, graphData.nodes);
      } catch (error) {
        console.error("Cluddle Graphs: failed to read canvas graph data", canvasFile.path, error);
      }
    }

    this.canvasGraphLinks = links;
    this.canvasGraphNodes = nodes;
    this.hydrated = true;
    this.renderOpenGraphViews();
  }

  parseCanvasGraphData(canvasPath, source) {
    let data;
    try {
      data = JSON.parse(source);
    } catch {
      return { links: {}, nodes: {} };
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

    return { links, nodes };
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
      type: node.type
    };
  }

  toGraphNodeMetadata(node) {
    return {
      canvasPath: node.canvasPath,
      label: node.label,
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
      return this.shouldShowCards(engine);
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
    if (!/^\d+$/.test(String(color))) {
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

  getLinkColor(engine) {
    return this.plugin.normalizeHexColor(engine.options?.[CANVAS_LINK_COLOR_OPTION])
      ?? this.getDefaultCanvasLinkColor(engine);
  }

  getDefaultCanvasLinkColor(engine) {
    return this.plugin.resolveCssColor?.("var(--color-accent)", engine.renderer?.containerEl?.ownerDocument ?? document)
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
