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

test("reuses projected Canvas links until Canvas data is invalidated", () => {
  const controller = new CanvasGraphController({});
  controller.canvasGraphLinks = {
    "First.canvas": {
      "First.canvas": {
        "Note.md": {
          count: 2,
          colors: ["1"],
          edgeCount: 1,
          parentMembershipCount: 1,
          groupMembershipCount: 0
        }
      }
    }
  };
  const engine = {
    options: {
      cluddlegraphsCanvasParentMemberships: true,
      cluddlegraphsCanvasGroupMemberships: true
    }
  };

  const first = controller.getCanvasGraphLinkProjection(engine);
  const second = controller.getCanvasGraphLinkProjection(engine);
  assert.equal(first, second);
  assert.equal(first[controller.getLinkKey("First.canvas", "Note.md")].count, 2);

  controller.canvasGraphLinks["First.canvas"]["First.canvas"]["Other.md"] = {
    count: 1,
    colors: [],
    edgeCount: 0,
    parentMembershipCount: 1,
    groupMembershipCount: 0
  };
  controller.invalidateCanvasGraphLinkCache();

  const refreshed = controller.getCanvasGraphLinkProjection(engine);
  assert.notEqual(refreshed, first);
  assert.equal(refreshed[controller.getLinkKey("First.canvas", "Other.md")].count, 1);
});

test("cached Canvas projections preserve link kinds, counts, and color order", () => {
  const controller = new CanvasGraphController({});
  controller.canvasGraphLinks = {
    "First.canvas": {
      "Source.md": {
        "Target.md": {
          count: 2,
          colors: ["1"],
          edgeCount: 1,
          parentMembershipCount: 1,
          groupMembershipCount: 0
        }
      }
    },
    "Second.canvas": {
      "Source.md": {
        "Target.md": {
          count: 3,
          colors: ["1", "2"],
          edgeCount: 2,
          parentMembershipCount: 0,
          groupMembershipCount: 1
        }
      }
    }
  };
  const engine = {
    options: {
      cluddlegraphsCanvasParentMemberships: true,
      cluddlegraphsCanvasGroupMemberships: true
    }
  };
  const linkKey = controller.getLinkKey("Source.md", "Target.md");

  assert.deepEqual(controller.getCanvasGraphLinkProjection(engine)[linkKey], {
    sourcePath: "Source.md",
    targetPath: "Target.md",
    count: 5,
    colors: ["1", "2"],
    edgeCount: 3,
    parentMembershipCount: 1,
    groupMembershipCount: 1
  });

  engine.options.cluddlegraphsCanvasParentMemberships = false;
  engine.options.cluddlegraphsCanvasGroupMemberships = false;
  assert.deepEqual(controller.getCanvasGraphLinkProjection(engine)[linkKey], {
    sourcePath: "Source.md",
    targetPath: "Target.md",
    count: 3,
    colors: ["1", "2"],
    edgeCount: 3,
    parentMembershipCount: 0,
    groupMembershipCount: 0
  });
});

test("does not schedule membership cloud work while clouds are disabled", () => {
  const controller = new CanvasGraphController({});
  let scheduledFrames = 0;
  const renderer = {
    containerEl: {
      ownerDocument: {
        defaultView: {
          requestAnimationFrame() {
            scheduledFrames++;
            return scheduledFrames;
          }
        }
      }
    }
  };
  const engine = {
    options: {
      cluddlegraphsCanvasMembershipClouds: false
    }
  };
  controller.rendererEngines.set(renderer, engine);

  controller.requestMembershipCloudSync(renderer);
  assert.equal(scheduledFrames, 0);

  engine.options.cluddlegraphsCanvasMembershipClouds = true;
  controller.requestMembershipCloudSync(renderer);
  assert.equal(scheduledFrames, 1);
});
