const { Notice, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_MAPPING_OPTION = "";
const NATIVE_COLOR_NAMES = {
  "0": "Native grey",
  "1": "Red",
  "2": "Orange",
  "3": "Yellow",
  "4": "Green",
  "5": "Cyan",
  "6": "Purple"
};

module.exports = class CluddleGraphsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    this.colorLabelCache = new Map();

    containerEl.createEl("h2", { text: "Canvas connection colours" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Choose the initial colour of a new outgoing Canvas connection from the colour of its source node. Existing and manually recoloured connections are not changed."
    });

    const doc = containerEl.ownerDocument;
    const colorIds = this.plugin.canvasEdgeColors.getAvailableColorIds(doc);
    this.addDefaultConnectionColorSetting(containerEl, colorIds);

    containerEl.createEl("h3", { text: "Per-node colour defaults" });
    for (const sourceColor of ["0", ...colorIds]) {
      this.addNodeColorMappingSetting(containerEl, sourceColor, colorIds);
    }

    containerEl.createEl("h2", { text: "Canvas graph metadata" });
    new Setting(containerEl)
      .setName("Refresh Canvas group metadata")
      .setDesc("Recalculate cached Canvas group membership metadata for every .canvas file.")
      .addButton((button) => {
        button
          .setButtonText("Refresh")
          .setCta()
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText("Refreshing...");

            try {
              const result = await this.plugin.canvasGraph.refreshAllGroupMembershipMetadata();
              new Notice(
                `Canvas group metadata refreshed: ${result.updated} updated, ${result.unchanged} unchanged, ${result.failed} failed.`
              );
            } catch (error) {
              console.error("Cluddle Graphs: failed to refresh Canvas group metadata", error);
              new Notice("Failed to refresh Canvas group metadata. Check the developer console for details.");
            } finally {
              button.setButtonText("Refresh");
              button.setDisabled(false);
            }
          });
      });
  }

  addDefaultConnectionColorSetting(containerEl, colorIds) {
    const setting = new Setting(containerEl)
      .setName("Default outgoing connection colour")
      .setDesc("Used when the source node colour has no override. Native grey stores no explicit edge colour and follows the active theme.");
    const doc = containerEl.ownerDocument;
    this.createColorPalettePicker(
      setting.controlEl,
      this.getColorOptions(colorIds, doc),
      this.plugin.settings.defaultCanvasConnectionColor,
      async (value) => {
        await this.plugin.setDefaultCanvasConnectionColor(value);
        this.display();
      }
    );
  }

  addNodeColorMappingSetting(containerEl, sourceColor, colorIds) {
    const mappings = this.plugin.settings.canvasConnectionColorByNodeColor;
    const hasOverride = Object.prototype.hasOwnProperty.call(mappings, sourceColor);
    const selectedColor = hasOverride ? mappings[sourceColor] : DEFAULT_MAPPING_OPTION;
    const doc = containerEl.ownerDocument;
    const setting = new Setting(containerEl)
      .setName(`${this.getColorLabel(sourceColor, doc)} nodes`)
      .setDesc("Initial colour for connections drawn from this node colour.")
      .setClass("cluddlegraphs-canvas-connection-color-mapping");

    this.createColorSwatch(setting.nameEl, sourceColor);
    const defaultColor = this.plugin.settings.defaultCanvasConnectionColor;
    const options = [
      {
        colorId: defaultColor,
        label: `Use default (${this.getColorLabel(defaultColor, doc)})`,
        value: DEFAULT_MAPPING_OPTION
      },
      ...this.getColorOptions(colorIds, doc)
    ];
    this.createColorPalettePicker(setting.controlEl, options, selectedColor, async (value) => {
      await this.plugin.setCanvasConnectionColorMapping(
        sourceColor,
        value === DEFAULT_MAPPING_OPTION ? null : value
      );
    });
  }

  getColorOptions(colorIds, doc) {
    return ["0", ...colorIds].map((colorId) => ({
      colorId,
      label: this.getColorLabel(colorId, doc),
      value: colorId
    }));
  }

  getColorLabel(colorId, doc = this.containerEl?.ownerDocument) {
    if (NATIVE_COLOR_NAMES[colorId]) {
      return NATIVE_COLOR_NAMES[colorId];
    }
    if (/^#[0-9a-f]{6}$/i.test(colorId)) {
      return colorId.toUpperCase();
    }

    this.colorLabelCache ??= new Map();
    if (this.colorLabelCache.has(colorId)) {
      return this.colorLabelCache.get(colorId);
    }

    const resolved = doc && this.plugin.resolveCssColor?.(`var(--canvas-color-${colorId})`, doc);
    const label = resolved?.toUpperCase() ?? `Colour ${colorId}`;
    this.colorLabelCache.set(colorId, label);
    return label;
  }

  createColorPalettePicker(parentEl, options, selectedValue, onChange) {
    const picker = parentEl.createEl("details", {
      cls: "cluddlegraphs-canvas-color-picker"
    });
    const summary = picker.createEl("summary", {
      cls: "cluddlegraphs-canvas-color-picker-trigger"
    });
    const menu = picker.createDiv({
      cls: "cluddlegraphs-canvas-color-picker-menu"
    });

    const renderSelection = (value) => {
      const selected = options.find((option) => option.value === value) ?? options[0];
      summary.empty();
      this.createColorSwatch(summary, selected.colorId);
      summary.createSpan({
        cls: "cluddlegraphs-canvas-color-picker-label",
        text: selected.label
      });
      summary.setAttribute("aria-label", `Choose connection colour. Current: ${selected.label}`);

      for (const button of menu.querySelectorAll("button")) {
        const isSelected = button.dataset.value === selected.value;
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
      }
    };

    for (const option of options) {
      const button = menu.createEl("button", {
        attr: {
          "aria-label": option.label,
          title: option.label,
          type: "button"
        },
        cls: "cluddlegraphs-canvas-color-picker-option"
      });
      button.dataset.value = option.value;
      this.createColorSwatch(button, option.colorId);
      if (option.value === DEFAULT_MAPPING_OPTION) {
        button.classList.add("is-default");
        button.createSpan({ text: "Use default" });
      }
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        picker.removeAttribute("open");
        renderSelection(option.value);
        await onChange(option.value);
      });
    }

    renderSelection(selectedValue);
    return picker;
  }

  createColorSwatch(parentEl, colorId) {
    const swatch = parentEl.createSpan({ cls: "cluddlegraphs-canvas-color-swatch" });
    this.updateColorSwatch(swatch, colorId);
    return swatch;
  }

  updateColorSwatch(swatch, colorId) {
    for (const className of Array.from(swatch.classList)) {
      if (className.startsWith("mod-canvas-color-")) {
        swatch.classList.remove(className);
      }
    }
    swatch.style.removeProperty("--cluddlegraphs-swatch-color");

    if (colorId === "0") {
      swatch.classList.add("is-default");
    } else {
      swatch.classList.remove("is-default");
      if (/^#[0-9a-f]{6}$/i.test(colorId)) {
        swatch.style.setProperty("--cluddlegraphs-swatch-color", colorId);
      } else {
        swatch.classList.add(`mod-canvas-color-${colorId}`);
      }
    }
    swatch.setAttribute("aria-label", this.getColorLabel(colorId, swatch.ownerDocument));
  }
};
