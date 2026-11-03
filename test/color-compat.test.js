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
const CluddleGraphsPlugin = require("../src/main");
Module._load = originalLoad;

const fs = require("node:fs");
const path = require("node:path");

// Return the declarations of one top-level rule in styles.css, with the white space made simple.
function getStylesheetRule(selector) {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const escapedSelector = selector.replace(/[.]/g, "\\.");
  const match = css.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

// A colour probe element that records its classes.
function createProbeDocument(onComputedStyle) {
  const classes = new Set();
  const el = {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name))
    },
    remove() {},
    style: {}
  };
  const doc = {
    body: { appendChild() {} },
    createElement: () => el,
    defaultView: {
      getComputedStyle: () => onComputedStyle(classes)
    }
  };
  return { el, doc };
}

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
  const { el, doc } = createProbeDocument((classes) => {
    assert.ok(classes.has("mod-canvas-color-9"), "the probe must have the Canvas colour class");
    assert.ok(classes.has("cluddlegraphs-canvas-color-probe"), "the probe must get its colour from styles.css");
    return { color: "rgb(255, 0, 0)" };
  });

  assert.equal(controller.resolveCanvasColor("9", doc), 0xff0000);
  assert.deepEqual(el.style, {}, "the Canvas colour probe must not set a fixed inline style");
});

test("gives no colour for a Canvas palette slot that the theme does not define", () => {
  const controller = Object.create(CanvasGraphController.prototype);
  controller.plugin = {
    detachElement: () => {},
    normalizeHexColor: () => null
  };
  const { doc } = createProbeDocument(() => ({ color: "rgb(1, 2, 3)" }));

  assert.equal(controller.resolveCanvasColor("42", doc), null);
});

test("resolves a CSS colour through a hidden probe with no fixed inline style", () => {
  const plugin = Object.create(CluddleGraphsPlugin.prototype);
  let detached = false;
  const { el, doc } = createProbeDocument((classes) => {
    assert.ok(classes.has("cluddlegraphs-color-probe"), "the probe must be hidden by styles.css");
    return { color: "rgb(18, 52, 86)" };
  });
  el.remove = () => {
    detached = true;
  };

  assert.equal(plugin.resolveCssColor("var(--interactive-accent)", doc), "#123456");
  assert.deepEqual(el.style, { color: "var(--interactive-accent)" }, "only the colour to resolve goes inline");
  assert.equal(detached, true);
});

test("defines the colour probe styles in styles.css", () => {
  const canvasProbe = getStylesheetRule(".cluddlegraphs-canvas-color-probe");
  assert.match(canvasProbe, /(?:^|; )color: var\(--canvas-color, rgb\(1, 2, 3\)\);/, "an undefined slot must give the unresolved colour");
  assert.match(canvasProbe, /(?:^|; )display: none;/);
  assert.match(getStylesheetRule(".cluddlegraphs-color-probe"), /(?:^|; )display: none;/);
});
