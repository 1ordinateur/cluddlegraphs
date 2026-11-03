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

// A document with the Canvas colour rules of Obsidian and the theme, but with no plugin styles.css.
// Obsidian loads styles.css after onload, so the first graph rebuild can run before it.
// A Canvas colour class gives its --canvas-color value. An element shows its inline colour, else the text colour.
const TEXT_COLOR = "rgb(218, 218, 218)";
function createThemeDocument(palette) {
  const probes = [];
  const doc = {
    body: { appendChild() {} },
    createElement: () => {
      const classes = new Set();
      const el = {
        classes,
        classList: {
          add: (...names) => names.forEach((name) => classes.add(name))
        },
        remove() {},
        style: {}
      };
      probes.push(el);
      return el;
    },
    defaultView: {
      getComputedStyle: (el) => {
        const slotClass = [...el.classes].find((name) => name.startsWith("mod-canvas-color-"));
        const slot = slotClass?.slice("mod-canvas-color-".length);
        return {
          color: el.style.color || TEXT_COLOR,
          getPropertyValue: (name) => (name === "--canvas-color" && slot ? palette[slot] ?? "" : "")
        };
      }
    }
  };
  return { doc, probes };
}

function createCanvasColorController() {
  const controller = Object.create(CanvasGraphController.prototype);
  controller.plugin = Object.create(CluddleGraphsPlugin.prototype);
  return controller;
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

test("resolves Obsidian 1.13 full-value Canvas color variables before styles.css loads", () => {
  const controller = createCanvasColorController();
  const { doc, probes } = createThemeDocument({ 9: "rgb(255, 0, 0)" });

  assert.equal(controller.resolveCanvasColor("9", doc), 0xff0000);
  assert.ok(probes[0].classes.has("mod-canvas-color-9"), "the probe must have the Canvas colour class");
  assert.deepEqual(probes[0].style, {}, "the Canvas colour probe must not set an inline style");
});

test("resolves a hex Canvas palette value", () => {
  const controller = createCanvasColorController();
  const { doc } = createThemeDocument({ 8: " #FF8C00" });

  assert.equal(controller.resolveCanvasColor("8", doc), 0xff8c00);
});

test("gives no colour for a Canvas palette slot that the theme does not define", () => {
  const controller = createCanvasColorController();
  const { doc } = createThemeDocument({ 9: "rgb(255, 0, 0)" });

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

test("hides the colour probe with styles.css", () => {
  assert.match(getStylesheetRule(".cluddlegraphs-color-probe"), /(?:^|; )display: none;/);
});
