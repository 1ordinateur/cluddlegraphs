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
    const swatch = this.createColorSwatch(setting.controlEl, this.plugin.settings.defaultCanvasConnectionColor);

    setting.addDropdown((dropdown) => {
      this.addColorOptions(dropdown, colorIds);
      dropdown
        .setValue(this.plugin.settings.defaultCanvasConnectionColor)
        .onChange(async (value) => {
          this.updateColorSwatch(swatch, value);
          await this.plugin.setDefaultCanvasConnectionColor(value);
          this.display();
        });
    });
  }

  addNodeColorMappingSetting(containerEl, sourceColor, colorIds) {
    const mappings = this.plugin.settings.canvasConnectionColorByNodeColor;
    const hasOverride = Object.prototype.hasOwnProperty.call(mappings, sourceColor);
    const selectedColor = hasOverride ? mappings[sourceColor] : DEFAULT_MAPPING_OPTION;
    const setting = new Setting(containerEl)
      .setName(`${this.getColorLabel(sourceColor)} nodes`)
      .setDesc("Initial colour for connections drawn from this node colour.")
      .setClass("cluddlegraphs-canvas-connection-color-mapping");

    this.createColorSwatch(setting.nameEl, sourceColor);
    const resolvedTarget = hasOverride
      ? mappings[sourceColor]
      : this.plugin.settings.defaultCanvasConnectionColor;
    const targetSwatch = this.createColorSwatch(setting.controlEl, resolvedTarget);

    setting.addDropdown((dropdown) => {
      dropdown.addOption(
        DEFAULT_MAPPING_OPTION,
        `Use default (${this.getColorLabel(this.plugin.settings.defaultCanvasConnectionColor)})`
      );
      this.addColorOptions(dropdown, colorIds);
      dropdown
        .setValue(selectedColor)
        .onChange(async (value) => {
          const target = value === DEFAULT_MAPPING_OPTION
            ? this.plugin.settings.defaultCanvasConnectionColor
            : value;
          this.updateColorSwatch(targetSwatch, target);
          await this.plugin.setCanvasConnectionColorMapping(
            sourceColor,
            value === DEFAULT_MAPPING_OPTION ? null : value
          );
        });
    });
  }

  addColorOptions(dropdown, colorIds) {
    dropdown.addOption("0", this.getColorLabel("0"));
    for (const colorId of colorIds) {
      dropdown.addOption(colorId, this.getColorLabel(colorId));
    }
  }

  getColorLabel(colorId) {
    return NATIVE_COLOR_NAMES[colorId] ?? (/^#/.test(colorId) ? colorId : `Colour ${colorId}`);
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
    swatch.setAttribute("aria-label", this.getColorLabel(colorId));
  }
};
