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

function createController() {
  const controller = Object.create(CanvasGraphController.prototype);
  controller.plugin = {
    getSavedGraphOptions: () => ({
      cluddlegraphsCanvasParentMemberships: false,
      cluddlegraphsCanvasFileConnections: false,
      cluddlegraphsCanvasLinkColor: "#123456"
    }),
    normalizeHexColor: (value) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : null
  };
  return controller;
}

test("defaults parent Canvas links on before the native control is synchronized", () => {
  const controller = createController();
  const engine = {
    options: {}
  };

  controller.initializeOptions(engine);

  assert.equal(engine.options.cluddlegraphsCanvasParentMemberships, true);
});

test("preserves a disabled parent-link toggle across repeated engine synchronization", () => {
  const controller = createController();
  const engine = {
    options: {
      cluddlegraphsCanvasParentMemberships: false
    }
  };

  controller.initializeOptions(engine);
  controller.initializeOptions(engine);

  assert.equal(engine.options.cluddlegraphsCanvasParentMemberships, false);
});

test("rediscovers the native Canvas-link toggle after moving it into Cluddlegraph controls", () => {
  const controller = Object.create(CanvasGraphController.prototype);
  const contentEl = {
    firstChild: null,
    insertBefore() {
      throw new Error("An already relocated toggle should not be moved again");
    }
  };
  const settingEl = { parentElement: contentEl };
  contentEl.firstChild = settingEl;
  const childrenEl = {};
  const engine = { options: {} };
  const searchedContainers = [];
  const calls = [];
  controller.findNativeCanvasLinksControl = (container) => {
    searchedContainers.push(container);
    return container === contentEl ? settingEl : null;
  };
  controller.compactNativeCanvasLinksControl = (setting) => calls.push(["compact", setting]);
  controller.bindNativeCanvasLinksControl = (setting, receivedEngine) => calls.push(["bind", setting, receivedEngine]);
  controller.syncParentMembershipsFromNativeControl = (setting, receivedEngine, render) => {
    calls.push(["sync", setting, receivedEngine, render]);
  };

  const result = controller.syncNativeCanvasLinksControl(childrenEl, contentEl, engine);

  assert.equal(result, settingEl);
  assert.deepEqual(searchedContainers, [contentEl]);
  assert.deepEqual(calls, [
    ["compact", settingEl],
    ["bind", settingEl, engine],
    ["sync", settingEl, engine, false]
  ]);
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
