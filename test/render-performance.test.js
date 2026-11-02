const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const Module = require("node:module");
const path = require("node:path");
const v8 = require("node:v8");
const vm = require("node:vm");

class TFile {}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      TFile,
      setIcon() {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

// All test files share one process. Load fresh source modules so that they use this file's TFile class.
const srcDir = path.join(__dirname, "..", "src") + path.sep;
for (const moduleId of Object.keys(require.cache)) {
  if (moduleId.startsWith(srcDir)) {
    delete require.cache[moduleId];
  }
}

const CluddleGraphsPlugin = require("../src/main");
const CanvasGraphController = require("../src/canvas-graph");
const graphProperties = require("../src/graph-properties");
Module._load = originalLoad;

const SHAPE = graphProperties.CANVAS_NODE_SHAPE_PROPERTY;
const LINK_COLOR = graphProperties.CANVAS_LINK_COLOR_PROPERTY;
const ZONE = graphProperties.CANVAS_ZONE_ATTRACTION_PROPERTY;
const CLOUDS_ACTIVE = graphProperties.CANVAS_CLOUDS_ACTIVE_PROPERTY;
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function createPlugin(overrides = {}) {
  const plugin = Object.create(CluddleGraphsPlugin.prototype);
  plugin.nodePatches = new WeakMap();
  plugin.linkPatches = new WeakMap();
  plugin.rendererPatches = new WeakMap();
  plugin.app = { internalPlugins: { getPluginById: () => null } };
  return Object.assign(plugin, overrides);
}

function createGraphics() {
  const calls = [];
  return {
    calls,
    clear() { calls.push(["clear"]); },
    beginFill(color, alpha) { calls.push(["beginFill", color, alpha]); },
    endFill() { calls.push(["endFill"]); },
    drawCircle(...args) { calls.push(["drawCircle", ...args]); },
    drawRect(...args) { calls.push(["drawRect", ...args]); },
    moveTo(...args) { calls.push(["moveTo", ...args]); },
    lineTo(...args) { calls.push(["lineTo", ...args]); }
  };
}

function countCalls(graphics, name) {
  return graphics.calls.filter(([callName]) => callName === name).length;
}

function createPaletteDocument(counter, color = "rgb(255, 0, 0)") {
  return {
    body: { appendChild() {} },
    createElement: () => ({ classList: { add() {} }, style: {}, remove() {} }),
    defaultView: {
      getComputedStyle: () => {
        counter.lookups++;
        return { color };
      }
    }
  };
}

function canvasSource(fileRefs, texts = []) {
  return JSON.stringify({
    nodes: [
      ...fileRefs.map((file, index) => ({
        id: `file-${index}`,
        type: "file",
        file,
        x: index * 300,
        y: 0,
        width: 200,
        height: 100
      })),
      ...texts.map((text, index) => ({
        id: `text-${index}`,
        type: "text",
        text,
        x: index * 300,
        y: 400,
        width: 200,
        height: 100
      }))
    ],
    edges: []
  });
}

function createVaultHarness(sources, extraFiles = []) {
  const vaultHandlers = {};
  const workspaceHandlers = {};
  const reads = [];
  const files = new Map();
  const gates = new Map();
  const state = { graphOpen: true, failGetFiles: false, failReads: new Set() };
  let renders = 0;

  const makeFile = (filePath) => Object.assign(new TFile(), {
    path: filePath,
    extension: filePath.split(".").pop(),
    basename: filePath.split("/").pop().replace(/\.[^.]+$/, "")
  });
  for (const filePath of [...Object.keys(sources), ...extraFiles]) {
    files.set(filePath, makeFile(filePath));
  }

  const vault = {
    on(name, handler) {
      vaultHandlers[name] = handler;
      return { name };
    },
    getFiles: () => {
      if (state.failGetFiles) {
        state.failGetFiles = false;
        throw new Error("vault index unavailable");
      }
      return [...files.values()];
    },
    getAbstractFileByPath: (filePath) => files.get(filePath) ?? null,
    async cachedRead(file) {
      reads.push(file.path);
      if (state.failReads.delete(file.path)) {
        throw new Error("file locked");
      }
      const gate = gates.get(file.path);
      if (gate) {
        gates.delete(file.path);
        await gate;
      }
      return sources[file.path];
    }
  };

  // Like Obsidian: an exact path first, then a path without letter case, then a file name without a folder.
  const resolveLink = (link) => {
    if (files.has(link)) {
      return files.get(link);
    }
    const lowerLink = String(link).toLowerCase();
    for (const file of files.values()) {
      const lowerPath = file.path.toLowerCase();
      if (lowerPath === lowerLink || (!lowerLink.includes("/") && lowerPath.split("/").pop() === lowerLink)) {
        return file;
      }
    }
    return null;
  };

  const plugin = createPlugin({
    app: {
      vault,
      workspace: {
        on(name, handler) {
          workspaceHandlers[name] = handler;
          return { name };
        }
      },
      metadataCache: {
        getFirstLinkpathDest: (link) => resolveLink(link)
      },
      internalPlugins: { getPluginById: () => null }
    },
    registerEvent() {},
    hasOpenGraphView: () => state.graphOpen,
    renderOpenGraphViews: () => {
      renders++;
    }
  });

  const controller = new CanvasGraphController(plugin);
  controller.onload();

  return {
    controller,
    files,
    makeFile,
    reads,
    sources,
    state,
    vaultHandlers,
    gate(filePath) {
      let release;
      gates.set(filePath, new Promise((resolve) => {
        release = resolve;
      }));
      return release;
    },
    workspaceHandlers,
    get renders() {
      return renders;
    }
  };
}

async function settleHydration(harness) {
  mock.timers.tick(1000);
  await harness.controller.hydration;
}

// Phase 1: per-frame node and link work

test("draws a Canvas node shape one time in white and does not redraw an unchanged shape", () => {
  const plugin = createPlugin();
  const graphics = createGraphics();
  const node = { circle: graphics, [SHAPE]: "square" };

  plugin.drawCanvasGraphNodeShape(node);
  plugin.drawCanvasGraphNodeShape(node);

  assert.equal(countCalls(graphics, "clear"), 1);
  assert.equal(countCalls(graphics, "drawRect"), 1);
  assert.deepEqual(graphics.calls.find(([name]) => name === "beginFill"), ["beginFill", 0xffffff, 1]);
});

test("leaves the native circle untouched for circle shapes and unshaped nodes", () => {
  const plugin = createPlugin();
  const circleGraphics = createGraphics();
  const plainGraphics = createGraphics();

  plugin.drawCanvasGraphNodeShape({ circle: circleGraphics, [SHAPE]: "circle" });
  plugin.drawCanvasGraphNodeShape({ circle: plainGraphics });

  assert.equal(circleGraphics.calls.length, 0);
  assert.equal(plainGraphics.calls.length, 0);
});

test("redraws a node shape only when the shape changes or Obsidian replaces the graphics", () => {
  const plugin = createPlugin();
  const graphics = createGraphics();
  const node = { circle: graphics, [SHAPE]: "square" };

  plugin.drawCanvasGraphNodeShape(node);
  node[SHAPE] = "triangle";
  plugin.drawCanvasGraphNodeShape(node);
  plugin.drawCanvasGraphNodeShape(node);
  assert.equal(countCalls(graphics, "clear"), 2);

  node[SHAPE] = "circle";
  plugin.drawCanvasGraphNodeShape(node);
  assert.equal(countCalls(graphics, "clear"), 3);
  assert.equal(countCalls(graphics, "drawCircle"), 1);

  const replacement = createGraphics();
  node.circle = replacement;
  node[SHAPE] = "square";
  plugin.drawCanvasGraphNodeShape(node);
  plugin.drawCanvasGraphNodeShape(node);
  assert.equal(countCalls(replacement, "clear"), 1);
  assert.equal(countCalls(replacement, "drawRect"), 1);
});

test("renders native node frames without shape, colour, or cloud work", () => {
  const plugin = createPlugin({
    canvasGraph: {
      requestMembershipCloudSync() {
        throw new Error("Canvas zones are off");
      }
    }
  });
  const graphics = createGraphics();
  const fill = { a: 1, rgb: 0x111111 };
  const renderer = { colors: { fill }, getHighlightNode: () => null };
  let frames = 0;
  const node = {
    renderer,
    circle: graphics,
    color: null,
    [SHAPE]: "square",
    render() {
      frames++;
      assert.equal(renderer.colors.fill, fill);
      assert.equal(this.color, null);
    }
  };

  plugin.patchGraphNode(node);
  for (let frame = 0; frame < 3; frame++) {
    node.render();
  }

  assert.equal(frames, 3);
  assert.equal(graphics.calls.length, 0);
});

test("requests a membership cloud sync from node frames only while Canvas zones are active", () => {
  let requests = 0;
  const plugin = createPlugin({
    canvasGraph: {
      requestMembershipCloudSync() {
        requests++;
      }
    }
  });
  const renderer = { getHighlightNode: () => null };
  const node = { renderer, render() {} };
  plugin.patchGraphNode(node);

  node.render();
  assert.equal(requests, 0);

  renderer[CLOUDS_ACTIVE] = true;
  node.render();
  node.render();
  assert.equal(requests, 2);
});

test("puts Canvas card colours into graph data before native setData and keeps their identity", () => {
  const plugin = createPlugin();
  const controller = new CanvasGraphController(plugin);
  const cardA = "Board.canvas#cluddlegraphs-canvas-node-a";
  const cardB = "Board.canvas#cluddlegraphs-canvas-node-b";
  controller.hydrated = true;
  controller.canvasGraphNodes = {
    "Board.canvas": { type: "file", canvasPath: "Board.canvas", label: "Board" },
    [cardA]: { type: "text", canvasPath: "Board.canvas", canvasColor: "#ff0000", inheritedColor: null, label: "A" },
    [cardB]: { type: "text", canvasPath: "Board.canvas", canvasColor: null, inheritedColor: null, label: "B" }
  };

  let seen = null;
  const renderer = {
    nodes: [],
    links: [],
    setData(data) {
      seen = { a: data.nodes[cardA].color, b: data.nodes[cardB].color };
    }
  };
  const engine = {
    renderer,
    fileFilter: {},
    options: {
      cluddlegraphsCanvasLinkMode: "all",
      cluddlegraphsCanvasLinkColor: "#123456",
      showOrphans: true
    }
  };
  const createData = () => ({
    nodes: {
      "Board.canvas": { type: "", links: {}, color: { a: 1, rgb: 0x00ff00 } },
      [cardA]: { type: "cluddlegraphs-canvas-card", links: {} },
      [cardB]: { type: "cluddlegraphs-canvas-card", links: {} }
    }
  });

  controller.patchRenderer(engine);
  renderer.setData(createData());
  assert.deepEqual(seen.a, { a: 1, rgb: 0xff0000 });
  assert.deepEqual(seen.b, { a: 1, rgb: 0x00ff00 });

  const first = seen;
  renderer.setData(createData());
  assert.equal(seen.a, first.a);
  assert.equal(seen.b, first.b);
});

// Fix the output of the Canvas link injection in each link mode, so that a faster version keeps it.
test("keeps the Canvas link injection output in each link mode", () => {
  const files = new Map(["Note.md", "Other.md", "Extra.md", "Lonely.md", "image.png", "Board.canvas"]
    .map((filePath) => [filePath, Object.assign(new TFile(), { path: filePath, extension: filePath.split(".").pop() })]));
  const controller = new CanvasGraphController(createPlugin({
    app: {
      vault: { getAbstractFileByPath: (filePath) => files.get(filePath) ?? null },
      metadataCache: { getFirstLinkpathDest: (link) => files.get(link) ?? null },
      internalPlugins: { getPluginById: () => null }
    }
  }));
  const graphData = controller.parseCanvasGraphData("Board.canvas", JSON.stringify({
    nodes: [
      { id: "n", type: "file", file: "Note.md", x: 0, y: 0, width: 100, height: 50 },
      { id: "o", type: "file", file: "Other.md", x: 200, y: 0, width: 100, height: 50 },
      { id: "i", type: "file", file: "image.png", x: 400, y: 0, width: 100, height: 50 },
      { id: "c", type: "text", text: "Card", x: 0, y: 200, width: 100, height: 50 }
    ],
    edges: [
      { id: "e1", fromNode: "n", toNode: "o", color: "1" },
      { id: "e2", fromNode: "c", toNode: "n" },
      { id: "e3", fromNode: "o", toNode: "i" }
    ]
  }));
  controller.canvasGraphLinks = { "Board.canvas": graphData.links };
  controller.canvasGraphNodes = graphData.nodes;
  controller.hydrated = true;
  controller.invalidateCanvasGraphLinkCache();

  const card = "Board.canvas#cluddlegraphs-canvas-node-c";
  const createData = () => ({
    nodes: {
      "Note.md": { type: "", links: { "Extra.md": true, "Other.md": true } },
      "Other.md": { type: "", links: {} },
      "Extra.md": { type: "", links: { "Note.md": true } },
      "Lonely.md": { type: "", links: {} },
      "Board.canvas": { type: "", links: { "Note.md": true, "Other.md": true } }
    }
  });
  const summarize = (data) => Object.fromEntries(Object.entries(data.nodes)
    .map(([id, node]) => [id, Object.keys(node.links).sort()]));
  const run = (mode, showOrphans) => {
    const engine = { fileFilter: {}, options: { cluddlegraphsCanvasLinkMode: mode, showOrphans, showAttachments: false } };
    controller.applyCanvasLinksToGraphData(createData(), engine);
    const data = createData();
    const canvasLinks = controller.applyCanvasLinksToGraphData(data, engine);
    return { data, canvasLinks, engine };
  };
  const allLinks = {
    "Note.md": ["Extra.md", "Other.md"],
    "Other.md": [],
    "Extra.md": ["Note.md"],
    "Lonely.md": [],
    "Board.canvas": [card, "Note.md", "Other.md"],
    [card]: ["Note.md"]
  };
  const nativeLinks = {
    "Note.md": ["Extra.md", "Other.md"],
    "Other.md": [],
    "Extra.md": ["Note.md"],
    "Lonely.md": [],
    "Board.canvas": ["Note.md", "Other.md"]
  };
  const onlyLinks = { ...allLinks, "Note.md": ["Other.md"], "Extra.md": [] };

  for (const showOrphans of [true, false]) {
    const all = run("all", showOrphans);
    assert.deepEqual(summarize(all.data), allLinks);
    assert.equal(all.data.numLinks, 7);
    assert.equal(all.data.nodes[card].type, "cluddlegraphs-canvas-card");
    assert.deepEqual(Object.keys(all.canvasLinks).sort(), [
      `Board.canvas\0${card}`,
      "Board.canvas\0Note.md",
      "Board.canvas\0Other.md",
      `${card}\0Note.md`,
      "Note.md\0Other.md"
    ]);
    assert.deepEqual([...controller.injectedCanvasLinkKeys.get(all.engine)].sort(), [`Board.canvas\0${card}`, `${card}\0Note.md`]);

    const only = run("only", showOrphans);
    const expectedOnly = { ...onlyLinks };
    if (!showOrphans) {
      delete expectedOnly["Extra.md"];
      delete expectedOnly["Lonely.md"];
    }
    assert.deepEqual(summarize(only.data), expectedOnly);
    assert.equal(only.data.numLinks, 5);

    const hide = run("hide", showOrphans);
    assert.deepEqual(summarize(hide.data), nativeLinks);
    assert.equal(hide.data.numLinks, undefined);
    assert.deepEqual(hide.canvasLinks, {});
  }

  // Obsidian can pass the same data object again after a mode change.
  const engine = { fileFilter: {}, options: { cluddlegraphsCanvasLinkMode: "all", showOrphans: true, showAttachments: false } };
  const data = createData();
  controller.applyCanvasLinksToGraphData(data, engine);
  engine.options.cluddlegraphsCanvasLinkMode = "hide";
  controller.applyCanvasLinksToGraphData(data, engine);
  assert.deepEqual(summarize(data), { ...nativeLinks, [card]: [] });
  assert.equal(data.numLinks, 5);
});

test("leaves a Canvas card without any colour source to the native fill", () => {
  const controller = new CanvasGraphController(createPlugin());
  const card = "Board.canvas#cluddlegraphs-canvas-node-a";
  controller.canvasGraphNodes = {
    [card]: { type: "text", canvasPath: "Board.canvas", canvasColor: null, inheritedColor: null, label: "A" }
  };
  const data = {
    nodes: {
      "Board.canvas": { type: "", links: {} },
      [card]: { type: "cluddlegraphs-canvas-card", links: {} }
    }
  };

  controller.applyCanvasCardColors(data, { fileFilter: {}, options: {} });

  assert.equal(data.nodes[card].color, undefined);
});

test("colours Canvas links with a tint after the native render and does not swap renderer colours", () => {
  const plugin = createPlugin();
  const line = { a: 0.6, rgb: 0x111111 };
  const lineHighlight = { a: 0.8, rgb: 0x222222 };
  const arrow = { a: 1, rgb: 0x333333 };
  const renderer = { colors: { line, lineHighlight, arrow }, getHighlightNode: () => null };
  const seenLines = [];
  const link = {
    renderer,
    line: { tint: 0 },
    arrow: { tint: 0 },
    [LINK_COLOR]: 0x87c517,
    render() {
      seenLines.push(renderer.colors.line);
      this.line.tint = renderer.colors.line.rgb;
      this.arrow.tint = renderer.colors.arrow.rgb;
    }
  };

  plugin.patchGraphLink(link);
  link.render();

  assert.equal(seenLines[0], line);
  assert.equal(link.line.tint, 0x87c517);
  assert.equal(link.arrow.tint, 0x87c517);
  assert.equal(renderer.colors.line, line);
  assert.equal(renderer.colors.lineHighlight, lineHighlight);
  assert.equal(renderer.colors.arrow, arrow);
});

test("hides zone attraction links without a graphics clear in each frame", () => {
  const plugin = createPlugin();
  const link = {
    renderer: { getHighlightNode: () => null },
    line: { visible: true },
    arrow: {
      visible: true,
      clear() {
        throw new Error("geometry must not be cleared in each frame");
      }
    },
    [ZONE]: true,
    render() {
      throw new Error("native render must not run for a hidden link");
    }
  };

  plugin.patchGraphLink(link);
  link.render();
  link.render();

  assert.equal(link.line.visible, false);
  assert.equal(link.arrow.visible, false);
});

// Phase 2: per-rebuild work

test("resolves each Canvas palette colour one time across graph rebuilds", () => {
  const controller = new CanvasGraphController(createPlugin());
  const counter = { lookups: 0 };
  const doc = createPaletteDocument(counter);

  for (let rebuild = 0; rebuild < 3; rebuild++) {
    assert.equal(controller.getRenderedLinkColor({ colors: ["9"] }, 0x123456, doc), 0xff0000);
  }
  assert.equal(counter.lookups, 1);

  const engine = { renderer: { containerEl: { ownerDocument: doc } } };
  assert.equal(controller.getCanvasGraphNodeMetadataColor(engine, { canvasColor: "9" }), 0xff0000);
  assert.equal(counter.lookups, 1);

  controller.clearCanvasColorCache();
  controller.getRenderedLinkColor({ colors: ["9"] }, 0x123456, doc);
  assert.equal(counter.lookups, 2);
});

test("clears the palette colour cache and renders open graphs again on a theme change", () => {
  const harness = createVaultHarness({});
  const counter = { lookups: 0 };
  const doc = createPaletteDocument(counter);

  harness.controller.getRenderedLinkColor({ colors: ["9"] }, 0x123456, doc);
  assert.equal(typeof harness.workspaceHandlers["css-change"], "function");
  harness.workspaceHandlers["css-change"]();
  harness.controller.getRenderedLinkColor({ colors: ["9"] }, 0x123456, doc);

  assert.equal(counter.lookups, 2);
  assert.equal(harness.renders, 1);
});

test("marks a Canvas label dirty only when the label changes", () => {
  const controller = new CanvasGraphController(createPlugin());
  const card = "Board.canvas#cluddlegraphs-canvas-node-a";
  controller.canvasGraphNodes = {
    [card]: { type: "text", canvasPath: "Board.canvas", label: "A" }
  };
  const engine = { options: {} };
  const node = { id: card, text: { text: "" }, fontDirty: false };

  controller.syncNode(engine, node);
  assert.equal(node.fontDirty, true);
  assert.equal(node.text.text, "A");

  node.fontDirty = false;
  controller.syncNode(engine, node);
  assert.equal(node.fontDirty, false);

  controller.canvasGraphNodes[card].label = "B";
  controller.syncNode(engine, node);
  assert.equal(node.fontDirty, true);
  assert.equal(node.text.text, "B");
});

// The native label font size is 14 + getSize() / 4, and native code sets fontDirty only on a theme change.
test("marks a Canvas label dirty when the node size changes", () => {
  const controller = new CanvasGraphController(createPlugin());
  const card = "Board.canvas#cluddlegraphs-canvas-node-a";
  controller.canvasGraphNodes = {
    [card]: { type: "text", canvasPath: "Board.canvas", label: "A" }
  };
  const engine = { options: {} };
  let size = 8;
  const node = { id: card, text: { text: "" }, fontDirty: false, getSize: () => size };

  controller.syncNode(engine, node);
  node.fontDirty = false;
  controller.syncNode(engine, node);
  assert.equal(node.fontDirty, false);

  size = 12;
  controller.syncNode(engine, node);
  assert.equal(node.fontDirty, true);
});

test("marks a Canvas member note label dirty when the node size changes", () => {
  const controller = new CanvasGraphController(createPlugin());
  controller.canvasGraphNodes = {
    "Note.md": { type: "file", canvasPath: "Board.canvas" }
  };
  const engine = { options: {} };
  let size = 8;
  const node = { id: "Note.md", text: { text: "Note" }, fontDirty: false, getSize: () => size };

  controller.syncNode(engine, node);
  node.fontDirty = false;
  controller.syncNode(engine, node);
  assert.equal(node.fontDirty, false);

  size = 12;
  controller.syncNode(engine, node);
  assert.equal(node.fontDirty, true);
});

test("wakes the render loop when Canvas zones are set to off, so that the old clouds go away", () => {
  const controller = new CanvasGraphController(createPlugin());
  const renderer = {
    wakes: 0,
    changed() {
      this.wakes++;
    }
  };
  const engine = {
    renderer,
    options: { cluddlegraphsCanvasMembershipClouds: true },
    render() {}
  };

  controller.setMembershipCloudsOption(engine, false);

  assert.equal(renderer.wakes, 1);
});

test("wakes the render loop for search highlights only when the highlight changes", () => {
  const plugin = createPlugin();
  const first = { id: "First.md", forward: {}, reverse: {} };
  const second = { id: "Second.md", forward: {}, reverse: {} };
  const renderer = {
    nodes: [first, second],
    links: [],
    nodeLookup: { "First.md": first, "Second.md": second },
    getHighlightNode: () => null,
    wakes: 0,
    changed() {
      this.wakes++;
    }
  };
  const hit = { a: 1, rgb: 0xff2d55, __cluddlegraphsSearchHit: true };
  const engine = {
    renderer,
    options: { searchHighlightMode: true, searchHighlightColor: "#ff2d55" },
    filterOptions: { search: { getValue: () => "hit" } },
    fileFilter: { "First.md": hit }
  };

  plugin.syncRendererSearchHighlights(engine);
  assert.equal(renderer.wakes, 1);
  plugin.syncRendererSearchHighlights(engine);
  assert.equal(renderer.wakes, 1, "the same highlight must leave the render loop idle");

  engine.fileFilter = { "First.md": hit, "Second.md": hit };
  plugin.syncRendererSearchHighlights(engine);
  assert.equal(renderer.wakes, 2, "a new highlighted node wakes the render loop");

  engine.options.searchHighlightColor = "#00ff00";
  plugin.syncRendererSearchHighlights(engine);
  assert.equal(renderer.wakes, 3, "a new highlight colour wakes the render loop");
});

// Native setData calls changed() only when the graph changed. changed() makes the native loop draw
// every node and link for 61 frames, also in a hidden graph tab.
test("wakes the native render loop after a rebuild only when a node or link looks different", () => {
  const frames = [];
  const doc = {
    body: { appendChild() {} },
    createElement: () => ({ classList: { add() {} }, style: {}, remove() {} }),
    defaultView: {
      getComputedStyle: () => ({ color: "rgb(255, 0, 0)" }),
      requestAnimationFrame: (callback) => frames.push(callback),
      cancelAnimationFrame() {}
    }
  };
  const flushFrames = () => {
    while (frames.length > 0) {
      frames.shift()();
    }
  };

  const plugin = createPlugin({
    app: {
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getFirstLinkpathDest: () => null },
      internalPlugins: { getPluginById: () => null }
    }
  });
  const controller = new CanvasGraphController(plugin);
  plugin.canvasGraph = controller;
  const loadBoard = (label, edgeColor) => {
    const graphData = controller.parseCanvasGraphData("Board.canvas", JSON.stringify({
      nodes: [
        { id: "a", type: "text", text: label, x: 0, y: 0, width: 100, height: 50 },
        { id: "b", type: "text", text: "Beta", x: 300, y: 0, width: 100, height: 50 }
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", color: edgeColor }]
    }));
    controller.canvasGraphLinks = { "Board.canvas": graphData.links };
    controller.canvasGraphNodes = graphData.nodes;
    controller.invalidateCanvasGraphLinkCache();
  };
  controller.hydrated = true;
  loadBoard("Alpha", "#00ff00");

  const renderer = {
    nodes: [],
    links: [],
    nodeLookup: {},
    wakes: 0,
    containerEl: { ownerDocument: doc },
    getHighlightNode: () => null,
    changed() {
      this.wakes++;
    },
    setData(data) {
      for (const [id, entry] of Object.entries(data.nodes)) {
        if (!this.nodeLookup[id]) {
          const node = {
            id,
            type: entry.type,
            renderer: this,
            circle: createGraphics(),
            text: { text: "" },
            fontDirty: false,
            getSize: () => 8,
            render() {},
            initGraphics() {}
          };
          this.nodeLookup[id] = node;
          this.nodes.push(node);
        }
      }
      for (const [id, entry] of Object.entries(data.nodes)) {
        for (const targetId of Object.keys(entry.links)) {
          const key = `${id}\n${targetId}`;
          if (this.nodeLookup[targetId] && !this.links.some((link) => link.key === key)) {
            this.links.push({ key, source: this.nodeLookup[id], target: this.nodeLookup[targetId], render() {} });
          }
        }
      }
    }
  };
  const engine = {
    renderer,
    fileFilter: {},
    options: { cluddlegraphsCanvasLinkMode: "all", cluddlegraphsCanvasLinkColor: "#123456", showOrphans: true }
  };
  const createData = () => ({ nodes: { "Board.canvas": { type: "", links: {} } } });

  controller.patchRenderer(engine);
  renderer.setData(createData());
  flushFrames();
  assert.ok(renderer.wakes >= 1, "the first rebuild sets labels, shapes and link colours");
  const wakes = renderer.wakes;

  renderer.setData(createData());
  flushFrames();
  assert.equal(renderer.wakes, wakes, "a rebuild with the same data must leave the render loop idle");

  loadBoard("Alpha 2", "#00ff00");
  renderer.setData(createData());
  flushFrames();
  assert.equal(renderer.wakes, wakes + 1, "a new label wakes the render loop");

  loadBoard("Alpha 2", "#0000ff");
  renderer.setData(createData());
  flushFrames();
  assert.equal(renderer.wakes, wakes + 2, "a new link colour wakes the render loop");
});

test("appends the highlight toggle only when it is not already the last control", () => {
  const plugin = createPlugin();
  const settingEl = {};
  let appends = 0;
  const childrenEl = {
    lastElementChild: settingEl,
    appendChild() {
      appends++;
    }
  };

  plugin.placeSearchHighlightToggle(childrenEl, settingEl);
  assert.equal(appends, 0);

  childrenEl.lastElementChild = {};
  plugin.placeSearchHighlightToggle(childrenEl, settingEl);
  assert.equal(appends, 1);
});

// Phase 3: rebuild frequency

test("debounces Canvas saves into one reload and one graph render", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["Note.md"]),
      "B.canvas": canvasSource([])
    }, ["Note.md"]);
    await harness.controller.hydrate();
    assert.deepEqual([...harness.reads].sort(), ["A.canvas", "B.canvas"]);
    assert.equal(harness.renders, 1);

    harness.reads.length = 0;
    const canvasFile = harness.files.get("A.canvas");
    harness.sources["A.canvas"] = canvasSource(["Note.md"], ["first"]);
    harness.vaultHandlers.modify(canvasFile);
    mock.timers.tick(100);
    harness.sources["A.canvas"] = canvasSource(["Note.md"], ["second"]);
    harness.vaultHandlers.modify(canvasFile);
    mock.timers.tick(100);
    harness.vaultHandlers.modify(canvasFile);
    assert.deepEqual(harness.reads, []);

    await settleHydration(harness);
    assert.deepEqual(harness.reads, ["A.canvas"]);
    assert.equal(harness.renders, 2);
  } finally {
    mock.timers.reset();
  }
});

test("skips the graph render when a Canvas save does not change graph data", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({ "A.canvas": canvasSource(["Note.md"]) }, ["Note.md"]);
    await harness.controller.hydrate();
    harness.reads.length = 0;

    const moved = JSON.parse(harness.sources["A.canvas"]);
    moved.nodes[0].x += 40;
    harness.sources["A.canvas"] = JSON.stringify(moved);
    harness.vaultHandlers.modify(harness.files.get("A.canvas"));
    await settleHydration(harness);

    assert.deepEqual(harness.reads, ["A.canvas"]);
    assert.equal(harness.renders, 1);
  } finally {
    mock.timers.reset();
  }
});

test("ignores a new file that no Canvas refers to", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({ "A.canvas": canvasSource(["Note.md"]) }, ["Note.md"]);
    await harness.controller.hydrate();
    harness.reads.length = 0;

    const created = harness.makeFile("Other.md");
    harness.files.set(created.path, created);
    harness.vaultHandlers.create(created);
    await settleHydration(harness);

    assert.deepEqual(harness.reads, []);
    assert.equal(harness.renders, 1);
  } finally {
    mock.timers.reset();
  }
});

test("reloads only the Canvas that refers to a new file", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["Missing.md"]),
      "B.canvas": canvasSource(["Note.md"])
    }, ["Note.md"]);
    await harness.controller.hydrate();
    assert.equal(harness.controller.canvasGraphNodes["Missing.md"], undefined);
    harness.reads.length = 0;

    const created = harness.makeFile("Missing.md");
    harness.files.set(created.path, created);
    harness.vaultHandlers.create(created);
    await settleHydration(harness);

    assert.deepEqual(harness.reads, ["A.canvas"]);
    assert.equal(harness.controller.canvasGraphNodes["Missing.md"].canvasPath, "A.canvas");
    assert.equal(harness.renders, 2);
  } finally {
    mock.timers.reset();
  }
});

test("reloads only the Canvases that refer to a renamed file", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["Note.md"]),
      "B.canvas": canvasSource(["Other.md"])
    }, ["Note.md", "Other.md"]);
    await harness.controller.hydrate();
    harness.reads.length = 0;

    const renamed = harness.makeFile("Renamed.md");
    harness.files.delete("Note.md");
    harness.files.set(renamed.path, renamed);
    harness.vaultHandlers.rename(renamed, "Note.md");
    await settleHydration(harness);

    assert.deepEqual(harness.reads, ["A.canvas"]);
  } finally {
    mock.timers.reset();
  }
});

test("removes a deleted Canvas from the graph data without a read", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["Note.md"]),
      "B.canvas": canvasSource(["Note.md"])
    }, ["Note.md"]);
    await harness.controller.hydrate();
    harness.reads.length = 0;

    const deleted = harness.files.get("B.canvas");
    harness.files.delete("B.canvas");
    harness.vaultHandlers.delete(deleted);
    await settleHydration(harness);

    assert.deepEqual(harness.reads, []);
    assert.equal(Object.hasOwn(harness.controller.canvasGraphLinks, "B.canvas"), false);
    assert.equal(Object.hasOwn(harness.controller.canvasMemberships, "B.canvas"), false);
    assert.equal(harness.renders, 2);
  } finally {
    mock.timers.reset();
  }
});

test("keeps a node that another Canvas shares when one Canvas is deleted", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["Note.md"]),
      "B.canvas": canvasSource(["Note.md"])
    }, ["Note.md"]);
    await harness.controller.hydrate();

    const deleted = harness.files.get("B.canvas");
    harness.files.delete("B.canvas");
    harness.vaultHandlers.delete(deleted);
    await settleHydration(harness);

    assert.equal(harness.controller.canvasGraphNodes["Note.md"]?.canvasPath, "A.canvas");
  } finally {
    mock.timers.reset();
  }
});

test("reloads a Canvas for a note that is created during the first full reload", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["New.md"]),
      "B.canvas": canvasSource([])
    });
    const releaseB = harness.gate("B.canvas");
    const firstLoad = harness.controller.hydrate();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(harness.reads, ["A.canvas", "B.canvas"]);

    const created = harness.makeFile("New.md");
    harness.files.set(created.path, created);
    harness.vaultHandlers.create(created);
    mock.timers.tick(1000);
    releaseB();
    await firstLoad;
    await harness.controller.hydration;

    assert.equal(harness.controller.canvasGraphNodes["New.md"]?.canvasPath, "A.canvas");
  } finally {
    mock.timers.reset();
  }
});

test("runs an owed full reload when a graph opens during a reload", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["Note.md"]),
      "B.canvas": canvasSource([])
    }, ["Note.md"]);
    await harness.controller.hydrate();
    harness.reads.length = 0;

    const releaseA = harness.gate("A.canvas");
    harness.vaultHandlers.modify(harness.files.get("A.canvas"));
    mock.timers.tick(1000);
    harness.state.graphOpen = false;
    harness.vaultHandlers.modify(harness.files.get("B.canvas"));
    assert.equal(harness.controller.needsHydration, true);

    harness.state.graphOpen = true;
    releaseA();
    await harness.controller.hydration;

    assert.equal(harness.controller.needsHydration, false);
    assert.deepEqual([...harness.reads].sort(), ["A.canvas", "A.canvas", "B.canvas"]);
  } finally {
    mock.timers.reset();
  }
});

test("recovers from a failed full reload without a stuck queue", async () => {
  const harness = createVaultHarness({ "A.canvas": canvasSource(["Note.md"]) }, ["Note.md"]);
  harness.state.failGetFiles = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    await harness.controller.hydrate();
  } finally {
    console.error = originalError;
  }

  assert.equal(harness.controller.hydration, null);
  assert.equal(harness.controller.needsHydration, true);

  await harness.controller.hydrate();
  assert.deepEqual(harness.reads, ["A.canvas"]);
  assert.equal(harness.controller.needsHydration, false);
});

test("reloads within the maximum wait while Canvas events keep arriving", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const harness = createVaultHarness({ "A.canvas": canvasSource(["Note.md"]) }, ["Note.md"]);
    await harness.controller.hydrate();
    harness.reads.length = 0;

    for (let event = 0; event < 20; event++) {
      harness.vaultHandlers.modify(harness.files.get("A.canvas"));
      mock.timers.tick(200);
    }
    assert.ok(harness.reads.length >= 1, "a reload must start before the events stop");

    await settleHydration(harness);
  } finally {
    mock.timers.reset();
  }
});

test("reloads a Canvas when a new file resolves its reference with a different letter case", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["Notes/Topic.md"]),
      "B.canvas": canvasSource([])
    });
    await harness.controller.hydrate();
    harness.reads.length = 0;

    const created = harness.makeFile("notes/topic.md");
    harness.files.set(created.path, created);
    harness.vaultHandlers.create(created);
    await settleHydration(harness);

    assert.deepEqual(harness.reads, ["A.canvas"]);
    assert.equal(harness.controller.canvasGraphNodes["notes/topic.md"]?.canvasPath, "A.canvas");
  } finally {
    mock.timers.reset();
  }
});

test("stops the Canvas reads of a full reload after unload", async () => {
  const harness = createVaultHarness({
    "A.canvas": canvasSource(["Note.md"]),
    "B.canvas": canvasSource([]),
    "C.canvas": canvasSource([])
  }, ["Note.md"]);
  const releaseA = harness.gate("A.canvas");
  const load = harness.controller.hydrate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.reads, ["A.canvas"]);

  harness.controller.onunload();
  releaseA();
  await load;

  assert.deepEqual(harness.reads, ["A.canvas"]);
});

test("starts a later reload after a batch that maps to no Canvas", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({ "A.canvas": canvasSource(["Note.md"]) }, ["Note.md"]);
    await harness.controller.hydrate();
    harness.reads.length = 0;

    const created = harness.makeFile("Other.md");
    harness.files.set(created.path, created);
    harness.vaultHandlers.create(created);
    await settleHydration(harness);
    assert.equal(harness.controller.hydration, null);

    harness.vaultHandlers.modify(harness.files.get("A.canvas"));
    await settleHydration(harness);
    assert.deepEqual(harness.reads, ["A.canvas"]);
  } finally {
    mock.timers.reset();
  }
});

test("keeps the previous Canvas data when a Canvas read fails", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const originalError = console.error;
  console.error = () => {};
  try {
    const harness = createVaultHarness({ "A.canvas": canvasSource(["Note.md"]) }, ["Note.md"]);
    await harness.controller.hydrate();
    const renders = harness.renders;

    harness.state.failReads.add("A.canvas");
    harness.vaultHandlers.modify(harness.files.get("A.canvas"));
    await settleHydration(harness);

    assert.equal(harness.controller.canvasGraphNodes["Note.md"]?.canvasPath, "A.canvas");
    assert.equal(Object.hasOwn(harness.controller.canvasGraphLinks, "A.canvas"), true);
    assert.deepEqual(harness.controller.getCanvasPathsReferencing(["Note.md"]), ["A.canvas"]);
    assert.equal(harness.renders, renders);
  } finally {
    console.error = originalError;
    mock.timers.reset();
  }
});

test("gives a shared node the same Canvas after a partial reload as after a full reload", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["Note.md"]),
      "B.canvas": canvasSource(["Note.md"])
    }, ["Note.md"]);
    await harness.controller.hydrate();

    // A sync tool deletes and creates A.canvas in one debounce window. The vault then lists A.canvas last.
    const canvasA = harness.files.get("A.canvas");
    harness.files.delete("A.canvas");
    harness.vaultHandlers.delete(canvasA);
    harness.files.set("A.canvas", canvasA);
    harness.vaultHandlers.create(canvasA);
    await settleHydration(harness);

    const fresh = createVaultHarness({
      "B.canvas": harness.sources["B.canvas"],
      "A.canvas": harness.sources["A.canvas"]
    }, ["Note.md"]);
    await fresh.controller.hydrate();

    assert.equal(
      harness.controller.canvasGraphNodes["Note.md"]?.canvasPath,
      fresh.controller.canvasGraphNodes["Note.md"]?.canvasPath
    );
  } finally {
    mock.timers.reset();
  }
});

test("stops queued Canvas reloads after unload", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createVaultHarness({
      "A.canvas": canvasSource(["Note.md"]),
      "B.canvas": canvasSource([])
    }, ["Note.md"]);
    await harness.controller.hydrate();
    harness.reads.length = 0;
    const renders = harness.renders;

    const releaseA = harness.gate("A.canvas");
    harness.sources["A.canvas"] = canvasSource(["Note.md"], ["changed"]);
    harness.vaultHandlers.modify(harness.files.get("A.canvas"));
    mock.timers.tick(1000);
    harness.state.graphOpen = false;
    harness.vaultHandlers.modify(harness.files.get("B.canvas"));
    harness.state.graphOpen = true;

    harness.controller.onunload();
    releaseA();
    await harness.controller.hydration;

    assert.deepEqual(harness.reads, ["A.canvas"]);
    assert.equal(harness.renders, renders);
  } finally {
    mock.timers.reset();
  }
});

test("looks up an unresolved palette colour one time in each graph rebuild", () => {
  const controller = new CanvasGraphController(createPlugin());
  const counter = { lookups: 0 };
  const doc = createPaletteDocument(counter, "rgb(1, 2, 3)");
  const cardA = "Board.canvas#cluddlegraphs-canvas-node-a";
  const cardB = "Board.canvas#cluddlegraphs-canvas-node-b";
  controller.hydrated = true;
  controller.canvasGraphNodes = {
    [cardA]: { type: "text", canvasPath: "Board.canvas", canvasColor: "42", inheritedColor: null, label: "A" },
    [cardB]: { type: "text", canvasPath: "Board.canvas", canvasColor: "42", inheritedColor: null, label: "B" }
  };
  const renderer = { nodes: [], links: [], containerEl: { ownerDocument: doc }, setData() {} };
  const engine = {
    renderer,
    fileFilter: {},
    options: { cluddlegraphsCanvasLinkMode: "all", cluddlegraphsCanvasLinkColor: "#123456", showOrphans: true }
  };
  const createData = () => ({
    nodes: {
      [cardA]: { type: "cluddlegraphs-canvas-card", links: {} },
      [cardB]: { type: "cluddlegraphs-canvas-card", links: {} }
    }
  });

  controller.patchRenderer(engine);
  renderer.setData(createData());
  assert.equal(counter.lookups, 1);
  renderer.setData(createData());
  assert.equal(counter.lookups, 2);
});

// Phase 4: optional feature paths

test("finds the search highlight neighbour without a link scan in each frame", () => {
  const plugin = createPlugin();
  const firstHit = { id: "First.md", forward: {}, reverse: {} };
  const secondHit = { id: "Second.md", forward: { "Near.md": {} }, reverse: {} };
  const near = { id: "Near.md", forward: {}, reverse: { "Second.md": {} } };
  const far = { id: "Far.md", forward: {}, reverse: {} };
  const renderer = {
    nodes: [firstHit, secondHit, near, far],
    links: [],
    nodeLookup: { "First.md": firstHit, "Second.md": secondHit, "Near.md": near, "Far.md": far },
    getHighlightNode: () => null,
    changed() {}
  };
  const hit = { a: 1, rgb: 0xff2d55, __cluddlegraphsSearchHit: true };
  const engine = {
    renderer,
    options: { searchHighlightMode: true, searchHighlightColor: "#ff2d55" },
    filterOptions: { search: { getValue: () => "hit" } },
    fileFilter: { "First.md": hit, "Second.md": hit }
  };

  plugin.syncRendererSearchHighlights(engine);
  const trap = {
    hasOwnProperty() {
      throw new Error("per-frame link scan");
    }
  };
  for (const node of [near, far]) {
    node.forward = trap;
    node.reverse = trap;
  }

  assert.equal(plugin.getNodeSearchHighlightNode(renderer, near), secondHit);
  assert.equal(plugin.getNodeSearchHighlightNode(renderer, far), firstHit);
  assert.equal(plugin.getNodeSearchHighlightNode(renderer, secondHit), secondHit);
  assert.equal(plugin.isSearchRelatedNode(renderer, near), true);
  assert.equal(plugin.isSearchRelatedNode(renderer, far), false);
});

test("maps graph node centres into the cloud layer from node positions", () => {
  const controller = new CanvasGraphController(createPlugin());
  const node = {
    id: "Note.md",
    x: 5,
    y: 7,
    circle: {
      scale: { x: 0.5, y: 0.5 },
      toGlobal() {
        throw new Error("recursive transform update");
      }
    }
  };
  const renderer = {
    hanger: { worldTransform: { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 20 } },
    nodeLookup: { "Note.md": node }
  };
  controller.cloudLayers.set(renderer, {
    parent: {},
    worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 4, ty: 0 }
  });
  controller.canvasMemberships = { "A.canvas": ["Note.md"] };

  const [cloud] = controller.getVisibleCanvasMembershipClouds(renderer);

  assert.deepEqual(cloud.points, [{ x: 16, y: 34 }]);
  assert.equal(cloud.padding, 112);
});

// PIXI updates worldTransform only in a stage render or in toGlobal. A drag-pan moves the hanger
// between frames, so the cloud sync must update the transforms before it reads them.
test("updates the world transforms one time before it maps cloud points", () => {
  const controller = new CanvasGraphController(createPlugin());
  const node = {
    id: "Note.md",
    x: 5,
    y: 7,
    circle: {
      scale: { x: 0.5, y: 0.5 },
      toGlobal() {
        throw new Error("recursive transform update");
      }
    }
  };
  const updates = { hanger: 0, layer: 0 };
  const hanger = {
    x: 30,
    y: 40,
    worldTransform: { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 20 },
    toGlobal() {
      updates.hanger++;
      this.worldTransform = { a: 2, b: 0, c: 0, d: 2, tx: this.x, ty: this.y };
      return { x: this.x, y: this.y };
    }
  };
  const layer = {
    parent: {},
    worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 4, ty: 0 },
    toGlobal() {
      updates.layer++;
      return { x: 4, y: 0 };
    }
  };
  const renderer = { hanger, nodeLookup: { "Note.md": node } };
  controller.cloudLayers.set(renderer, layer);
  controller.canvasMemberships = { "A.canvas": ["Note.md"], "B.canvas": ["Note.md"] };

  const clouds = controller.getVisibleCanvasMembershipClouds(renderer);

  assert.deepEqual(clouds.map((cloud) => cloud.points), [[{ x: 36, y: 54 }], [{ x: 36, y: 54 }]]);
  assert.deepEqual(updates, { hanger: 1, layer: 1 });
});

test("uses the cloud fallback when a destroyed hanger cannot update its transform", () => {
  const controller = new CanvasGraphController(createPlugin());
  const node = { id: "Note.md", x: 5, y: 7, circle: { scale: { x: 1, y: 1 } } };
  const renderer = {
    hanger: {
      worldTransform: null,
      toGlobal() {
        throw new TypeError("Cannot read properties of null");
      }
    },
    nodeLookup: { "Note.md": node }
  };
  controller.cloudLayers.set(renderer, { parent: {}, worldTransform: IDENTITY, toGlobal: () => ({ x: 0, y: 0 }) });
  controller.canvasMemberships = { "A.canvas": ["Note.md"] };

  const [cloud] = controller.getVisibleCanvasMembershipClouds(renderer);
  assert.deepEqual(cloud.points, [{ x: 5, y: 7 }]);
});

test("redraws membership clouds only when the cloud shapes change", () => {
  const controller = new CanvasGraphController(createPlugin());
  let draws = 0;
  const layer = {
    parent: {},
    worldTransform: IDENTITY,
    clear() {},
    lineStyle() {},
    beginFill() {
      draws++;
    },
    moveTo() {},
    lineTo() {},
    closePath() {},
    endFill() {}
  };
  const nodes = {
    "A.canvas": { id: "A.canvas", x: 0, y: 0, circle: { scale: { x: 1, y: 1 } } },
    "Note.md": { id: "Note.md", x: 300, y: 0, circle: { scale: { x: 1, y: 1 } } }
  };
  const renderer = { hanger: { worldTransform: IDENTITY }, nodeLookup: nodes, nodes: Object.values(nodes) };
  const engine = { renderer, options: { cluddlegraphsCanvasMembershipClouds: true } };
  controller.cloudLayers.set(renderer, layer);
  controller.canvasMemberships = { "A.canvas": ["A.canvas", "Note.md"] };

  controller.syncMembershipClouds(engine);
  controller.syncMembershipClouds(engine);
  assert.equal(draws, 1);

  nodes["Note.md"].x = 600;
  controller.syncMembershipClouds(engine);
  assert.equal(draws, 2);

  controller.clearMembershipClouds(renderer);
  controller.syncMembershipClouds(engine);
  assert.equal(draws, 3);
});

test("limits layout frames for each patched graph renderer and removes the limit on restore", () => {
  const plugin = createPlugin();
  const nativeQueueRender = function() {};
  const nativeOnMessage = function() {};
  const renderer = {
    nodes: [],
    links: [],
    renderTimer: null,
    renderCallback: null,
    containerEl: { win: { requestAnimationFrame: () => 1, cancelAnimationFrame() {}, performance: { now: () => 0 } } },
    worker: { onmessage: nativeOnMessage },
    getHighlightNode: () => null,
    queueRender: nativeQueueRender
  };

  plugin.patchRenderer(renderer);
  assert.notEqual(renderer.queueRender, nativeQueueRender, "the patch must limit the layout frames");
  assert.notEqual(renderer.worker.onmessage, nativeOnMessage, "the patch must see the layout worker messages");

  plugin.restoreRenderer(renderer);
  assert.equal(renderer.queueRender, nativeQueueRender);
  assert.equal(renderer.worker.onmessage, nativeOnMessage);
});

test("syncs zone clouds from drawn frames, not from each render loop wake", () => {
  let queuedFrames = 0;
  const controller = new CanvasGraphController(createPlugin());
  const renderer = {
    setData() {},
    changed() {},
    containerEl: {
      ownerDocument: {
        defaultView: { requestAnimationFrame: () => ++queuedFrames, cancelAnimationFrame() {} }
      }
    }
  };
  const engine = { renderer, options: { cluddlegraphsCanvasMembershipClouds: true } };
  controller.patchRenderer(engine);

  // Each layout worker message calls changed(). Node frames request the cloud sync, under the frame limit.
  renderer.changed();
  assert.equal(queuedFrames, 0, "a render loop wake must not queue its own cloud sync frame");

  controller.requestMembershipCloudSync(renderer);
  assert.equal(queuedFrames, 1);
});

test("rebuilds a hidden graph one time when it shows, not at each change", () => {
  let reportSize = null;
  const el = {
    win: {
      ResizeObserver: function(callback) {
        reportSize = () => callback([]);
        return { observe() {}, disconnect() {} };
      }
    },
    ownerDocument: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    isConnected: true,
    clientWidth: 800,
    clientHeight: 600
  };
  const setSize = (width, height) => {
    el.clientWidth = width;
    el.clientHeight = height;
    reportSize();
  };
  let nativeRenders = 0;
  let wakes = 0;
  const renderer = { nodes: [], links: [], containerEl: el, getHighlightNode: () => null, changed: () => wakes++ };
  const nativeRender = function() {
    nativeRenders++;
    return 5;
  };
  const engine = { renderer, options: {}, setQuery() {}, render: nativeRender };
  const plugin = createPlugin({
    enginePatches: new WeakMap(),
    localGraphNodeClickPatches: new WeakMap(),
    resetButtonPatches: new WeakMap(),
    filterControls: new WeakMap(),
    displayControls: new WeakMap(),
    canvasGraph: { syncSearchMatches() {}, restoreEngine() {} }
  });
  plugin.patchGraphEngine(engine);

  setSize(0, 0);
  engine.render();
  engine.render();
  engine.render();
  assert.equal(nativeRenders, 0, "a hidden graph must not rebuild");

  const wakesBeforeShow = wakes;
  setSize(800, 600);
  assert.equal(nativeRenders, 1, "the graph rebuilds one time when it shows");
  assert.ok(wakes > wakesBeforeShow, "the graph draws its latest layout when it shows");

  assert.equal(engine.render(), 5);
  assert.equal(nativeRenders, 2, "a visible graph rebuilds at each change");
  setSize(0, 0);
  setSize(800, 600);
  assert.equal(nativeRenders, 2, "a graph with no missed change does not rebuild when it shows");

  plugin.restoreGraphEngine(engine);
  assert.equal(engine.render, nativeRender);
  const rendersAfterRestore = nativeRenders;
  el.clientWidth = 0;
  engine.render();
  assert.equal(nativeRenders, rendersAfterRestore + 1, "the restore must remove the visibility gate");
});

test("returns the last native render result while the graph is hidden, for the timelapse", () => {
  let reportSize = null;
  const el = {
    win: {
      ResizeObserver: function(callback) {
        reportSize = () => callback([]);
        return { observe() {}, disconnect() {} };
      }
    },
    ownerDocument: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    isConnected: true,
    clientWidth: 800,
    clientHeight: 600
  };
  const renderer = { nodes: [], links: [], containerEl: el, getHighlightNode: () => null, changed() {} };
  const engine = { renderer, options: {}, setQuery() {}, render: () => 42 };
  const plugin = createPlugin({ enginePatches: new WeakMap(), canvasGraph: { syncSearchMatches() {} } });
  plugin.patchGraphEngine(engine);
  assert.equal(engine.render(), 42);

  el.clientWidth = 0;
  reportSize();
  assert.equal(engine.render(), 42, "the native timelapse loop stops when render returns no value");
});

test("removes the visibility watch when the graph view closes and when the plugin restores the graph", () => {
  const createGraph = () => {
    const state = { observers: 0, listeners: 0, closeCallbacks: [] };
    const el = {
      win: {
        ResizeObserver: function() {
          state.observers++;
          return {
            observe() {},
            disconnect() {
              state.observers--;
            }
          };
        }
      },
      ownerDocument: {
        visibilityState: "visible",
        addEventListener(type) {
          if (type === "visibilitychange") {
            state.listeners++;
          }
        },
        removeEventListener(type) {
          if (type === "visibilitychange") {
            state.listeners--;
          }
        }
      },
      isConnected: true,
      clientWidth: 800,
      clientHeight: 600
    };
    const renderer = { nodes: [], links: [], containerEl: el, getHighlightNode: () => null, changed() {} };
    const view = {
      register(callback) {
        state.closeCallbacks.push(callback);
      }
    };
    return { state, engine: { renderer, view, options: {}, setQuery() {}, render() {} } };
  };
  const plugin = createPlugin({
    enginePatches: new WeakMap(),
    localGraphNodeClickPatches: new WeakMap(),
    resetButtonPatches: new WeakMap(),
    filterControls: new WeakMap(),
    displayControls: new WeakMap(),
    canvasGraph: { syncSearchMatches() {}, restoreEngine() {} }
  });

  const closed = createGraph();
  plugin.patchGraphEngine(closed.engine);
  assert.equal(closed.state.observers, 1);
  assert.equal(closed.state.listeners, 1);
  for (const callback of closed.state.closeCallbacks) {
    callback();
  }
  assert.equal(closed.state.observers, 0, "a closed graph view must not keep its observer");
  assert.equal(closed.state.listeners, 0, "a closed graph view must not keep its document listener");

  const restored = createGraph();
  plugin.patchGraphEngine(restored.engine);
  plugin.restoreGraphEngine(restored.engine);
  assert.equal(restored.state.observers, 0);
  assert.equal(restored.state.listeners, 0);
});

test("keeps no plugin instance in memory through the view close callback after the plugin unloads", async () => {
  v8.setFlagsFromString("--expose-gc");
  const collectGarbage = vm.runInNewContext("gc");
  const closeCallbacks = [];
  const el = {
    win: {
      ResizeObserver: function() {
        return { observe() {}, disconnect() {} };
      }
    },
    ownerDocument: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    isConnected: true,
    clientWidth: 800,
    clientHeight: 600
  };
  const renderer = { nodes: [], links: [], containerEl: el, getHighlightNode: () => null, changed() {} };
  // Obsidian keeps each register callback on the view until the view closes.
  const view = {
    register(callback) {
      closeCallbacks.push(callback);
    }
  };
  const engine = { renderer, view, options: {}, setQuery() {}, render() {} };

  const pluginRef = (() => {
    const plugin = createPlugin({
      enginePatches: new WeakMap(),
      localGraphNodeClickPatches: new WeakMap(),
      resetButtonPatches: new WeakMap(),
      filterControls: new WeakMap(),
      displayControls: new WeakMap(),
      canvasGraph: { syncSearchMatches() {}, restoreEngine() {} }
    });
    plugin.patchGraphEngine(engine);
    plugin.restoreGraphEngine(engine);
    return new WeakRef(plugin);
  })();
  await new Promise((resolve) => setImmediate(resolve));
  collectGarbage();

  assert.equal(closeCallbacks.length, 1);
  assert.equal(pluginRef.deref(), undefined, "an open graph view must not keep the old plugin instance after unload");
});
