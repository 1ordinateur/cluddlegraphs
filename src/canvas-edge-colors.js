const CANVAS_VIEW_TYPE = "canvas";
const DEFAULT_CANVAS_CONNECTION_COLOR = "0";
const DEFAULT_CANVAS_CONNECTION_COLOR_BY_NODE_COLOR = Object.freeze({});
const BUILTIN_CANVAS_COLOR_COUNT = 6;
const MAX_CANVAS_COLOR_SLOT = 99;

function normalizeCanvasColorId(value, fallback = DEFAULT_CANVAS_CONNECTION_COLOR) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const color = String(value).trim();
  if (color === "0" || /^[1-9]\d*$/.test(color) || /^#[0-9a-f]{6}$/i.test(color)) {
    return color.toLowerCase();
  }
  return fallback;
}

function normalizeCanvasConnectionColorSettings(value) {
  const saved = value && typeof value === "object" ? value : {};
  const mappings = saved.canvasConnectionColorByNodeColor;
  const normalizedMappings = {};

  if (mappings && typeof mappings === "object" && !Array.isArray(mappings)) {
    for (const [sourceColor, connectionColor] of Object.entries(mappings)) {
      const normalizedSource = normalizeCanvasColorId(sourceColor, null);
      const normalizedConnection = normalizeCanvasColorId(connectionColor, null);
      if (normalizedSource !== null && normalizedConnection !== null) {
        normalizedMappings[normalizedSource] = normalizedConnection;
      }
    }
  }

  return {
    ...saved,
    defaultCanvasConnectionColor: normalizeCanvasColorId(saved.defaultCanvasConnectionColor),
    canvasConnectionColorByNodeColor: normalizedMappings
  };
}

class CanvasEdgeColorController {
  constructor(plugin) {
    this.plugin = plugin;
    this.canvasPatches = new Map();
  }

  syncCanvasViews() {
    const activeCanvases = new Set();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType?.(CANVAS_VIEW_TYPE) ?? []) {
      const canvas = leaf?.view?.canvas;
      if (canvas) {
        activeCanvases.add(canvas);
        this.patchCanvas(canvas);
      }
    }
    for (const canvas of this.canvasPatches.keys()) {
      if (!activeCanvases.has(canvas)) {
        this.restoreCanvas(canvas);
      }
    }
  }

  patchCanvas(canvas) {
    if (!canvas || typeof canvas.addEdge !== "function" || this.canvasPatches.has(canvas)) {
      return;
    }

    const controller = this;
    const patch = {
      hadOwnAddEdge: Object.prototype.hasOwnProperty.call(canvas, "addEdge"),
      hadOwnImportData: Object.prototype.hasOwnProperty.call(canvas, "importData"),
      importDepth: 0,
      originalAddEdge: canvas.addEdge,
      originalImportData: canvas.importData,
      patchedAddEdge: null,
      patchedImportData: null
    };
    const patchedAddEdge = function(edge, ...args) {
      const shouldApply = controller.shouldApplyToCreatedEdge(this, patch);
      const result = patch.originalAddEdge.call(this, edge, ...args);
      if (shouldApply) {
        controller.applyDefaultColorToCreatedEdge(this, edge);
      }
      return result;
    };

    patch.patchedAddEdge = patchedAddEdge;
    canvas.addEdge = patchedAddEdge;
    if (typeof patch.originalImportData === "function") {
      patch.patchedImportData = function(...args) {
        patch.importDepth++;
        try {
          return patch.originalImportData.apply(this, args);
        } finally {
          patch.importDepth--;
        }
      };
      canvas.importData = patch.patchedImportData;
    }
    this.canvasPatches.set(canvas, patch);
  }

  shouldApplyToCreatedEdge(canvas, patch) {
    return patch?.importDepth === 0
      && !canvas?.viewportChanged
      && !canvas?.isClearing
      && !canvas?.isPasting
      && !canvas?.readonly;
  }

  applyDefaultColorToCreatedEdge(canvas, edge) {
    const edgeData = edge?.getData?.();
    if (!edgeData || typeof edge.setData !== "function") {
      return false;
    }

    const sourceNode = edge?.from?.node ?? canvas?.nodes?.get?.(edgeData.fromNode);
    const sourceColor = normalizeCanvasColorId(sourceNode?.getData?.()?.color);
    const connectionColor = this.getConnectionColorForSource(sourceColor);
    const currentColor = normalizeCanvasColorId(edgeData.color, null);

    if (connectionColor === DEFAULT_CANVAS_CONNECTION_COLOR) {
      if (!("color" in edgeData) || edgeData.color === undefined) {
        return false;
      }
      const nextData = { ...edgeData };
      delete nextData.color;
      edge.setData(nextData);
    } else {
      if (currentColor === connectionColor) {
        return false;
      }
      edge.setData({ ...edgeData, color: connectionColor });
    }

    return true;
  }

  getConnectionColorForSource(sourceColor) {
    const settings = this.plugin.settings ?? {};
    const mappings = settings.canvasConnectionColorByNodeColor ?? DEFAULT_CANVAS_CONNECTION_COLOR_BY_NODE_COLOR;
    return normalizeCanvasColorId(
      mappings[normalizeCanvasColorId(sourceColor)],
      normalizeCanvasColorId(settings.defaultCanvasConnectionColor)
    );
  }

  getAvailableColorIds(doc, settings = this.plugin.settings) {
    const colorIds = new Set();
    for (let colorId = 1; colorId <= BUILTIN_CANVAS_COLOR_COUNT; colorId++) {
      colorIds.add(String(colorId));
    }

    const style = doc?.defaultView?.getComputedStyle?.(doc.body);
    if (style) {
      for (let colorId = BUILTIN_CANVAS_COLOR_COUNT + 1; colorId <= MAX_CANVAS_COLOR_SLOT; colorId++) {
        const value = style.getPropertyValue(`--canvas-color-${colorId}`).trim();
        if (!value) {
          break;
        }
        colorIds.add(String(colorId));
      }
    }

    const mappings = settings?.canvasConnectionColorByNodeColor ?? {};
    for (const color of [
      settings?.defaultCanvasConnectionColor,
      ...Object.keys(mappings),
      ...Object.values(mappings)
    ]) {
      const normalized = normalizeCanvasColorId(color, null);
      if (normalized && normalized !== DEFAULT_CANVAS_CONNECTION_COLOR) {
        colorIds.add(normalized);
      }
    }

    return Array.from(colorIds).sort((left, right) => {
      const leftNumber = /^\d+$/.test(left) ? Number(left) : Number.POSITIVE_INFINITY;
      const rightNumber = /^\d+$/.test(right) ? Number(right) : Number.POSITIVE_INFINITY;
      return leftNumber - rightNumber || left.localeCompare(right);
    });
  }

  restoreCanvas(canvas) {
    const patch = this.canvasPatches.get(canvas);
    if (!patch) {
      return;
    }
    if (canvas.addEdge === patch.patchedAddEdge) {
      if (patch.hadOwnAddEdge) {
        canvas.addEdge = patch.originalAddEdge;
      } else {
        delete canvas.addEdge;
      }
    }
    if (patch.patchedImportData && canvas.importData === patch.patchedImportData) {
      if (patch.hadOwnImportData) {
        canvas.importData = patch.originalImportData;
      } else {
        delete canvas.importData;
      }
    }
    this.canvasPatches.delete(canvas);
  }

  onunload() {
    for (const canvas of Array.from(this.canvasPatches.keys())) {
      this.restoreCanvas(canvas);
    }
  }
}

module.exports = {
  BUILTIN_CANVAS_COLOR_COUNT,
  CanvasEdgeColorController,
  DEFAULT_CANVAS_CONNECTION_COLOR,
  normalizeCanvasColorId,
  normalizeCanvasConnectionColorSettings
};
