const { Notice, PluginSettingTab, Setting } = require("obsidian");

module.exports = class CluddleGraphsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

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
};
