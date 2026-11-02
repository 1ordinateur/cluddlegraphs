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
