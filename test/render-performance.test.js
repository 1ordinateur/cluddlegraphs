const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const Module = require("node:module");
const path = require("node:path");

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

function createPaletteDocument(counter) {
  return {
    body: { appendChild() {} },
    createElement: () => ({ classList: { add() {} }, style: {}, remove() {} }),
    defaultView: {
      getComputedStyle: () => {
        counter.lookups++;
        return { color: "rgb(255, 0, 0)" };
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
    getFiles: () => [...files.values()],
    getAbstractFileByPath: (filePath) => files.get(filePath) ?? null,
    async cachedRead(file) {
      reads.push(file.path);
      return sources[file.path];
    }
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
        getFirstLinkpathDest: (link) => files.get(link) ?? null
      },
      internalPlugins: { getPluginById: () => null }
    },
    registerEvent() {},
    hasOpenGraphView: () => true,
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
    vaultHandlers,
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
