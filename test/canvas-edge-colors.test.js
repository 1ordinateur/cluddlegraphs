const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CanvasEdgeColorController,
  normalizeCanvasConnectionColorSettings
} = require("../src/canvas-edge-colors");

function createNode(color) {
  return {
    getData: () => ({ color })
  };
}

function createEdge(sourceColor, color) {
  let data = {
    id: "edge-1",
    fromNode: "source",
    toNode: "target"
  };
  if (color !== undefined) {
    data.color = color;
  }

  return {
    from: { node: createNode(sourceColor) },
    getData: () => data,
    setData: (value) => {
      data = value;
    }
  };
}

function createController(settings = {}) {
  return new CanvasEdgeColorController({
    settings: normalizeCanvasConnectionColorSettings(settings),
    app: { workspace: { getLeavesOfType: () => [] } }
  });
}

test("maps yellow source nodes to black outgoing connections", () => {
  const controller = createController({
    defaultCanvasConnectionColor: "0",
    canvasConnectionColorByNodeColor: { "7": "19" }
  });
  const edge = createEdge("7");

  assert.equal(controller.applyDefaultColorToCreatedEdge({}, edge), true);
  assert.equal(edge.getData().color, "19");
});

test("clears other edge defaults to native grey for unmapped nodes", () => {
  const controller = createController();
  const edge = createEdge("3", "5");

  assert.equal(controller.applyDefaultColorToCreatedEdge({}, edge), true);
  assert.equal(Object.hasOwn(edge.getData(), "color"), false);
});

test("uses the actual outgoing source when resolving a mapping", () => {
  const controller = createController({
    canvasConnectionColorByNodeColor: { "7": "19", "9": "13" }
  });
  const edge = createEdge("9");

  controller.applyDefaultColorToCreatedEdge({}, edge);
  assert.equal(edge.getData().color, "13");
});

test("applies mappings after another plugin's edge creation defaults", () => {
  const controller = createController({
    canvasConnectionColorByNodeColor: { "7": "19" }
  });
  const edge = createEdge("7");
  const canvas = {
    viewportChanged: false,
    addEdge(createdEdge) {
      createdEdge.setData({ ...createdEdge.getData(), color: "7" });
    },
    requestSave() {}
  };

  controller.patchCanvas(canvas);
  canvas.addEdge(edge);
  assert.equal(edge.getData().color, "19");
});

test("does not recolor edges while Canvas data is loading", () => {
  const controller = createController({
    canvasConnectionColorByNodeColor: { "7": "19" }
  });
  const edge = createEdge("7", "8");
  const canvas = {
    viewportChanged: true,
    addEdge() {},
    requestSave() {
      assert.fail("loading existing edges must not request a save");
    }
  };

  controller.patchCanvas(canvas);
  canvas.addEdge(edge);
  assert.equal(edge.getData().color, "8");
});

test("does not recolor edges recreated by native Canvas import, paste, undo, or redo", () => {
  const controller = createController({
    canvasConnectionColorByNodeColor: { "7": "19" }
  });
  const edge = createEdge("7", "8");
  const canvas = {
    viewportChanged: false,
    addEdge() {},
    importData(importedEdge) {
      this.addEdge(importedEdge);
    }
  };

  controller.patchCanvas(canvas);
  canvas.importData(edge);
  assert.equal(edge.getData().color, "8");
});

test("leaves post-creation manual edge colors untouched", () => {
  const controller = createController({
    canvasConnectionColorByNodeColor: { "7": "19" }
  });
  const edge = createEdge("7");
  const canvas = { viewportChanged: false, addEdge() {}, requestSave() {} };

  controller.patchCanvas(canvas);
  canvas.addEdge(edge);
  edge.setData({ ...edge.getData(), color: "13" });

  assert.equal(edge.getData().color, "13");
});

test("restores the original Canvas edge method on unload", () => {
  const controller = createController();
  const originalAddEdge = () => {};
  const canvas = { addEdge: originalAddEdge };

  controller.patchCanvas(canvas);
  assert.notEqual(canvas.addEdge, originalAddEdge);
  controller.onunload();
  assert.equal(canvas.addEdge, originalAddEdge);
});

test("normalizes invalid saved settings to safe grey defaults", () => {
  assert.deepEqual(normalizeCanvasConnectionColorSettings({
    defaultCanvasConnectionColor: "not-a-color",
    canvasConnectionColorByNodeColor: {
      "7": "19",
      invalid: "3",
      "8": "invalid"
    }
  }), {
    defaultCanvasConnectionColor: "0",
    canvasConnectionColorByNodeColor: { "7": "19" }
  });
});
