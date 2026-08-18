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
  const plugin = Object.create(CluddleGraphsPlugin.prototype);
  const targetLeaf = {
    activeTime: 10,
    canNavigate: () => true,
    view: { getViewType: () => "markdown" }
  };
  const activeLeaves = [];
  plugin.localGraphNodeClickPatches = new WeakMap();
  plugin.app = {
    workspace: {
      rootSplit: {},
      getMostRecentLeaf: () => targetLeaf,
      isInSidebar: () => false,
      setActiveLeaf: (leaf, options) => activeLeaves.push({ leaf, options })
    }
  };
  return { plugin, targetLeaf, activeLeaves };
}

test("routes local graph file clicks through the main editor leaf", () => {
  const { plugin, targetLeaf, activeLeaves } = createPlugin();
  const nativeCalls = [];
  const engine = {
    view: { getViewType: () => "localgraph" },
    onNodeClick(event, path, nodeType) {
      nativeCalls.push({ context: this, event, path, nodeType });
    }
  };

  plugin.patchLocalGraphNodeNavigation(engine);
  const event = { button: 0 };
  engine.onNodeClick(event, "Pathology/Crohns Disease.md", "focused");

  assert.deepEqual(activeLeaves, [{ leaf: targetLeaf, options: { focus: true } }]);
  assert.deepEqual(nativeCalls, [{
    context: engine,
    event,
    path: "Pathology/Crohns Disease.md",
    nodeType: "focused"
  }]);
});

test("leaves tag-node navigation untouched", () => {
  const { plugin, activeLeaves } = createPlugin();
  let nativeCallCount = 0;
  const engine = {
    view: { getViewType: () => "localgraph" },
    onNodeClick() {
      nativeCallCount++;
    }
  };

  plugin.patchLocalGraphNodeNavigation(engine);
  engine.onNodeClick({ button: 0 }, "medicine", "tag");

  assert.equal(nativeCallCount, 1);
  assert.deepEqual(activeLeaves, []);
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

test("restores Obsidian's original local graph click handler", () => {
  const { plugin } = createPlugin();
  const originalOnNodeClick = () => {};
  const engine = {
    view: { getViewType: () => "localgraph" },
    onNodeClick: originalOnNodeClick
  };

  plugin.patchLocalGraphNodeNavigation(engine);
  assert.notEqual(engine.onNodeClick, originalOnNodeClick);

  plugin.restoreLocalGraphNodeNavigation(engine);
  assert.equal(engine.onNodeClick, originalOnNodeClick);
});
