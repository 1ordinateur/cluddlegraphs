const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
    return { Setting: class Setting {}, TFile: class TFile {}, setIcon() {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const CanvasGraphController = require("../src/canvas-graph");
Module._load = originalLoad;

const CANVAS_PATH = "Board.canvas";

function createController() {
  const controller = Object.create(CanvasGraphController.prototype);
  controller.plugin = {
    app: {
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getFirstLinkpathDest: () => null }
    }
  };
  return controller;
}

function card(id, x, y) {
  return { id, type: "text", text: id, x, y, width: 100, height: 60 };
}

function group(id, x, y, width, height, color) {
  return { id, type: "group", label: id, x, y, width, height, ...(color ? { color } : {}) };
}

function edge(id, fromNode, toNode, color) {
  return { id, fromNode, toNode, ...(color ? { color } : {}) };
}

// Parse one Canvas and return the colours of the graph link between two Canvas nodes.
function parseLinkColors(nodes, edges) {
  const controller = createController();
  const data = controller.parseCanvasGraphData(CANVAS_PATH, JSON.stringify({ nodes, edges }));
  return (from, to) => {
    const source = controller.getGraphOnlyNodeId(CANVAS_PATH, from);
    const target = controller.getGraphOnlyNodeId(CANVAS_PATH, to);
    return data.links[source]?.[target]?.colors;
  };
}

test("colours a connection between two cards in one group with the group colour, also over the edge colour", () => {
  const colors = parseLinkColors(
    [group("G", 0, 0, 600, 400, "4"), card("a", 20, 20), card("b", 300, 20), card("c", 20, 200)],
    [edge("ab", "a", "b"), edge("ac", "a", "c", "1")]
  );

  assert.deepEqual(colors("a", "b"), ["4"]);
  assert.deepEqual(colors("a", "c"), ["4"]);
  assert.deepEqual(colors("G", "b"), [], "a group membership link keeps the default colour");
});

test("uses the smallest group that holds both cards, with its inherited colour", () => {
  const colors = parseLinkColors(
    [
      group("outer", 0, 0, 1000, 800, "2"),
      group("plain", 50, 50, 400, 300),
      group("green", 500, 50, 400, 300, "5"),
      card("a", 80, 80),
      card("b", 80, 200),
      card("c", 550, 80),
      card("d", 550, 200),
      card("e", 80, 600)
    ],
    [edge("ab", "a", "b", "1"), edge("cd", "c", "d"), edge("ac", "a", "c", "1"), edge("ce", "c", "e")]
  );

  assert.deepEqual(colors("a", "b"), ["2"], "a group with no colour uses the colour of its parent group");
  assert.deepEqual(colors("c", "d"), ["5"]);
  assert.deepEqual(colors("a", "c"), ["2"], "cards in two inner groups share the outer group");
  assert.deepEqual(colors("c", "e"), ["2"]);
});

test("keeps the edge colour for a connection across groups or in a group with no colour", () => {
  const colors = parseLinkColors(
    [
      group("red", 0, 0, 400, 300, "1"),
      group("blue", 600, 0, 400, 300, "5"),
      group("plain", 0, 600, 400, 300),
      card("a", 20, 20),
      card("b", 620, 20),
      card("c", 20, 620),
      card("d", 200, 620),
      card("free", 1200, 0)
    ],
    [
      edge("ab", "a", "b", "3"),
      edge("af", "a", "free", "6"),
      edge("cd", "c", "d", "2"),
      edge("dc", "d", "c"),
      edge("fa", "free", "a")
    ]
  );

  assert.deepEqual(colors("a", "b"), ["3"]);
  assert.deepEqual(colors("a", "free"), ["6"]);
  assert.deepEqual(colors("c", "d"), ["2"]);
  assert.deepEqual(colors("d", "c"), []);
  assert.deepEqual(colors("free", "a"), []);
});

test("colours a connection between a group and its own card with the group colour", () => {
  const colors = parseLinkColors(
    [group("G", 0, 0, 600, 400, "4"), card("a", 20, 20), card("out", 900, 20)],
    [edge("Ga", "G", "a", "1"), edge("Gout", "G", "out", "6")]
  );

  assert.deepEqual(colors("G", "a"), ["4"]);
  assert.deepEqual(colors("G", "out"), ["6"], "a connection that leaves the group keeps its edge colour");
});
