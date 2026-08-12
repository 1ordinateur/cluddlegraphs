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
const CanvasGraphController = require("../src/canvas-graph");
Module._load = originalLoad;

test("uses Obsidian's current getColoredQueries color-group API", () => {
  const expected = [{ query: "path:Anatomy", color: { a: 1, rgb: 0x87c517 } }];
  const controller = Object.create(CanvasGraphController.prototype);
  controller.plugin = { getSavedGraphOptions: () => ({}) };
  controller.graphColorQueries = new WeakMap();
  controller.toRgbNumber = CanvasGraphController.prototype.toRgbNumber.bind(controller);
  controller.getGraphQueryText = CanvasGraphController.prototype.getGraphQueryText.bind(controller);

  const engine = {
    colorGroupOptions: {
      getColoredQueries: () => expected
    }
  };

  assert.deepEqual(controller.getGraphColorQueries(engine), expected);
});

test("resolves Obsidian 1.13 full-value Canvas color variables", () => {
  const controller = Object.create(CanvasGraphController.prototype);
  controller.plugin = {
    detachElement: () => {},
    normalizeHexColor: () => null
  };
  const el = {
    classList: { add() {} },
    remove() {},
    style: {}
  };
  const doc = {
    body: { appendChild() {} },
    createElement: () => el,
    defaultView: {
      getComputedStyle: () => {
        assert.equal(el.style.color, "var(--canvas-color, rgb(1, 2, 3))");
        return { color: "rgb(255, 0, 0)" };
      }
    }
  };

  assert.equal(controller.resolveCanvasColor("9", doc), 0xff0000);
});

test("adds opaque alpha when coloring a node without a native color", () => {
  const plugin = Object.create(CluddleGraphsPlugin.prototype);
  plugin.getCanvasGraphNodeRenderColor = () => 0x87c517;
  const renderer = { colors: { fill: { a: 0.8, rgb: 0x111111 } } };
  const node = {};
  let renderedColor;

  plugin.renderWithCanvasGraphNodeColor(renderer, node, () => {
    renderedColor = node.color;
  });

  assert.deepEqual(renderedColor, { a: 1, rgb: 0x87c517 });
  assert.equal(Object.hasOwn(node, "color"), false);
});

test("preserves a native node color's alpha while replacing its RGB value", () => {
  const plugin = Object.create(CluddleGraphsPlugin.prototype);
  plugin.getCanvasGraphNodeRenderColor = () => 0x87c517;
  const renderer = { colors: { fill: { a: 1, rgb: 0x111111 } } };
  const originalColor = { a: 0.4, rgb: 0x222222 };
  const node = { color: originalColor };
  let renderedColor;

  plugin.renderWithCanvasGraphNodeColor(renderer, node, () => {
    renderedColor = node.color;
  });

  assert.deepEqual(renderedColor, { a: 0.4, rgb: 0x87c517 });
  assert.equal(node.color, originalColor);
});
