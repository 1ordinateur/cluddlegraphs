const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Setting: class Setting {},
      TFile: class TFile {},
      setIcon() {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const CanvasGraphController = require("../src/canvas-graph");
Module._load = originalLoad;

test("defaults parent Canvas links on instead of retaining the removed control's value", () => {
  const controller = Object.create(CanvasGraphController.prototype);
  controller.plugin = {
    getSavedGraphOptions: () => ({
      cluddlegraphsCanvasParentMemberships: false,
      cluddlegraphsCanvasFileConnections: false,
      cluddlegraphsCanvasLinkColor: "#123456"
    }),
    normalizeHexColor: (value) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : null
  };
  const engine = {
    options: {
      cluddlegraphsCanvasParentMemberships: false
    }
  };

  controller.initializeOptions(engine);

  assert.equal(engine.options.cluddlegraphsCanvasParentMemberships, true);
});

test("uses the visible Obsidian toggle state ahead of a stale checkbox input", () => {
  const controller = Object.create(CanvasGraphController.prototype);
  const enabledToggle = {
    classList: {
      contains: (className) => className === "is-enabled"
    }
  };
  const staleInput = { checked: false };
  const settingEl = {
    querySelector: (selector) => {
      if (selector === ".checkbox-container") {
        return enabledToggle;
      }
      if (selector === "input[type='checkbox']") {
        return staleInput;
      }
      return null;
    }
  };

  assert.equal(controller.getNativeCanvasLinksControlValue(settingEl), true);
});
