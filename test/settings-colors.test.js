const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Notice: class Notice {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const CluddleGraphsSettingTab = require("../src/settings");
Module._load = originalLoad;

test("shows resolved custom Canvas colours instead of numeric slot labels", () => {
  const settingTab = Object.create(CluddleGraphsSettingTab.prototype);
  const calls = [];
  const doc = {};
  settingTab.plugin = {
    resolveCssColor: (value, receivedDoc) => {
      calls.push({ receivedDoc, value });
      return value === "var(--canvas-color-19)" ? "#000000" : null;
    }
  };

  assert.equal(settingTab.getColorLabel("19", doc), "#000000");
  assert.equal(settingTab.getColorLabel("19", doc), "#000000");
  assert.deepEqual(calls, [{ receivedDoc: doc, value: "var(--canvas-color-19)" }]);
});

test("keeps native names and explicit hex colours readable", () => {
  const settingTab = Object.create(CluddleGraphsSettingTab.prototype);
  settingTab.plugin = { resolveCssColor: () => null };

  assert.equal(settingTab.getColorLabel("3"), "Yellow");
  assert.equal(settingTab.getColorLabel("#a1b2c3"), "#A1B2C3");
});
