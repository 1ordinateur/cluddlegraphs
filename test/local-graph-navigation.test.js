const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      TFile: class TFile {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const CluddleGraphsPlugin = require("../src/main");
Module._load = originalLoad;

function createPlugin() {
  const openedFiles = [];
  const targetLeaf = {
    activeTime: 10,
    canNavigate: () => true,
    openFile: (file, options) => {
      openedFiles.push({ file, options });
      return Promise.resolve();
    },
    view: { getViewType: () => "markdown" }
  };
  const activeLeaves = [];
  const resolvedFile = { path: "Pathology/Crohns Disease.md" };
  const plugin = Object.create(CluddleGraphsPlugin.prototype);
  plugin.localGraphNodeClickPatches = new WeakMap();
  plugin.app = {
    metadataCache: {
      getFirstLinkpathDest: (path) => path === resolvedFile.path ? resolvedFile : null
    },
    workspace: {
      rootSplit: {},
      getMostRecentLeaf: () => targetLeaf,
      isInSidebar: () => false,
      setActiveLeaf: (leaf, options) => activeLeaves.push({ leaf, options })
    }
  };
  return { activeLeaves, openedFiles, plugin, resolvedFile, targetLeaf };
}

function createLocalGraphEngine(nativeCalls) {
  return {
    renderer: {
      onNodeClick(event, path, nodeType) {
        nativeCalls.push({ context: this, event, path, nodeType });
      }
    },
    view: { getViewType: () => "localgraph" }
  };
}

test("routes renderer clicks directly through the main editor leaf", async () => {
  const { activeLeaves, openedFiles, plugin, resolvedFile, targetLeaf } = createPlugin();
  const nativeCalls = [];
  const engine = createLocalGraphEngine(nativeCalls);

  plugin.patchLocalGraphNodeNavigation(engine);
  const event = { button: 0 };
  await engine.renderer.onNodeClick(event, resolvedFile.path, "focused");

  assert.deepEqual(activeLeaves, [{ leaf: targetLeaf, options: { focus: true } }]);
  assert.deepEqual(openedFiles, [{ file: resolvedFile, options: { active: true } }]);
  assert.deepEqual(nativeCalls, []);
});

test("leaves tag-node renderer navigation untouched", () => {
  const { activeLeaves, openedFiles, plugin } = createPlugin();
  const nativeCalls = [];
  const engine = createLocalGraphEngine(nativeCalls);
  const event = { button: 0 };

  plugin.patchLocalGraphNodeNavigation(engine);
  engine.renderer.onNodeClick(event, "medicine", "tag");

  assert.equal(nativeCalls.length, 1);
  assert.equal(nativeCalls[0].context, engine.renderer);
  assert.deepEqual(activeLeaves, []);
  assert.deepEqual(openedFiles, []);
});

for (const modifier of ["ctrlKey", "metaKey"]) {
  test(`routes ${modifier} file clicks through the main editor leaf`, async () => {
    const { activeLeaves, openedFiles, plugin, resolvedFile, targetLeaf } = createPlugin();
    const nativeCalls = [];
    const engine = createLocalGraphEngine(nativeCalls);

    plugin.patchLocalGraphNodeNavigation(engine);
    await engine.renderer.onNodeClick({ button: 0, [modifier]: true }, resolvedFile.path, "focused");

    assert.deepEqual(activeLeaves, [{ leaf: targetLeaf, options: { focus: true } }]);
    assert.deepEqual(openedFiles, [{ file: resolvedFile, options: { active: true } }]);
    assert.deepEqual(nativeCalls, []);
  });
}

for (const modifier of ["shiftKey", "altKey"]) {
  test(`preserves native ${modifier} click behavior`, () => {
    const { activeLeaves, openedFiles, plugin, resolvedFile } = createPlugin();
    const nativeCalls = [];
    const engine = createLocalGraphEngine(nativeCalls);

    plugin.patchLocalGraphNodeNavigation(engine);
    engine.renderer.onNodeClick({ button: 0, [modifier]: true }, resolvedFile.path, "focused");

    assert.equal(nativeCalls.length, 1);
    assert.deepEqual(activeLeaves, []);
    assert.deepEqual(openedFiles, []);
  });
}

test("preserves native non-primary click behavior", () => {
  const { activeLeaves, openedFiles, plugin, resolvedFile } = createPlugin();
  const nativeCalls = [];
  const engine = createLocalGraphEngine(nativeCalls);

  plugin.patchLocalGraphNodeNavigation(engine);
  engine.renderer.onNodeClick({ button: 1 }, resolvedFile.path, "focused");

  assert.equal(nativeCalls.length, 1);
  assert.deepEqual(activeLeaves, []);
  assert.deepEqual(openedFiles, []);
});

test("falls back to native navigation when a graph path cannot be resolved", () => {
  const { plugin } = createPlugin();
  const nativeCalls = [];
  const engine = createLocalGraphEngine(nativeCalls);

  plugin.patchLocalGraphNodeNavigation(engine);
  engine.renderer.onNodeClick({ button: 0 }, "Missing.md", "focused");

  assert.equal(nativeCalls.length, 1);
});

test("skips graph leaves when selecting the main editor target", () => {
  const { plugin } = createPlugin();
  const graphLeaf = {
    activeTime: 20,
    canNavigate: () => true,
    view: { getViewType: () => "graph" }
  };
  const markdownLeaf = {
    activeTime: 10,
    canNavigate: () => true,
    view: { getViewType: () => "markdown" }
  };
  plugin.app.workspace.getMostRecentLeaf = () => graphLeaf;
  plugin.app.workspace.iterateRootLeaves = (callback) => {
    callback(graphLeaf);
    callback(markdownLeaf);
  };

  assert.equal(plugin.getMainEditorLeaf(), markdownLeaf);
});

test("restores Obsidian's original renderer click handler", () => {
  const { plugin } = createPlugin();
  const nativeCalls = [];
  const engine = createLocalGraphEngine(nativeCalls);
  const originalOnNodeClick = engine.renderer.onNodeClick;

  plugin.patchLocalGraphNodeNavigation(engine);
  assert.notEqual(engine.renderer.onNodeClick, originalOnNodeClick);

  plugin.restoreLocalGraphNodeNavigation(engine);
  assert.equal(engine.renderer.onNodeClick, originalOnNodeClick);
});
