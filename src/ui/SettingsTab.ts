import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MusicProPlugin from "../main";

const ACCENT_COLOR_PRESETS = [
  { label: "Music Blue", color: "#2f7cf6" },
  { label: "Sky", color: "#0a84ff" },
  { label: "Indigo", color: "#5e5ce6" },
  { label: "Violet", color: "#bf5af2" },
  { label: "Rose", color: "#ff4f9a" },
  { label: "Coral", color: "#ff6b4a" },
  { label: "Amber", color: "#ff9f0a" },
  { label: "Mint", color: "#32d74b" },
  { label: "Teal", color: "#30b0c7" },
  { label: "Graphite", color: "#8e8e93" }
] as const;

export class MusicProSettingsTab extends PluginSettingTab {
  plugin: MusicProPlugin;

  constructor(app: App, plugin: MusicProPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("music-pro-settings");
    this.plugin.applyAccentToElement(containerEl);

    const hero = containerEl.createDiv({ cls: "music-pro-settings-hero" });
    hero.createEl("h2", { text: "Music Pro" });
    hero.createEl("p", { text: "A plug-and-play music app for deep work inside Obsidian." });

    const appearance = this.createSettingsSection(
      containerEl,
      "Appearance",
      "Color and background.",
      "music-pro-appearance-settings"
    );

    new Setting(appearance)
      .setName("Accent Color")
      .setDesc("Choose the Music Pro color.")
      .addColorPicker((color) => {
        color.setValue(this.plugin.settings.accentColor);
        color.onChange(async (value) => {
          await this.plugin.setAccentColor(value);
        });
      })
      .addButton((button) => {
        button.setIcon("rotate-ccw");
        button.setTooltip("Reset Music Pro Blue");
        button.buttonEl.addClass("music-pro-reset-accent-button");
        button.onClick(async () => {
          await this.plugin.setAccentColor("#2f7cf6");
          this.display();
        });
      });
    this.renderAccentColorPresets(appearance);

    const rainbowSetting = new Setting(appearance)
      .setName("Rainbow")
      .setDesc("Slowly move Music Pro through soft colors.");
    this.addBooleanButton(rainbowSetting, this.plugin.settings.rainbowAccentEnabled, async (value) => {
      await this.plugin.setRainbowAccentEnabled(value);
    });

    const playback = this.createSettingsSection(
      containerEl,
      "Player",
      "Start, hide, and pause behavior.",
      "music-pro-playback-settings"
    );

    const autoplaySetting = new Setting(playback)
      .setName("Play On Open")
      .setDesc("Resume the last playlist when Music Pro opens.");
    this.addBooleanButton(autoplaySetting, this.plugin.settings.autoplayOnStartup, async (value) => {
      this.plugin.settings.autoplayOnStartup = value;
      await this.plugin.saveSettings();
    });

    const miniPlayerSetting = new Setting(playback)
      .setName("Auto-Hide Mini Player")
      .setDesc("When compact, tuck it away until your mouse is near.");
    this.addBooleanButton(miniPlayerSetting, this.plugin.settings.autoHideMini, async (value) => {
      this.plugin.settings.autoHideMini = value;
      await this.plugin.saveSettings();
      this.plugin.renderChrome();
    });

    const externalAudioSetting = new Setting(playback)
      .setName("Pause For Browser Audio")
      .setDesc("Pause Music Pro while Obsidian browser audio plays.");
    this.addBooleanButton(externalAudioSetting, this.plugin.settings.pauseForExternalAudio, async (value) => {
      this.plugin.settings.pauseForExternalAudio = value;
      await this.plugin.saveSettings();
      this.plugin.configureExternalAudioMonitor();
    });

    const library = this.createSettingsSection(
      containerEl,
      "Playlists",
      "Choose what shows and loads.",
      "music-pro-library-settings"
    );

    new Setting(library)
      .setName("Playlist Order")
      .setDesc("Reset the order. Drag to sort in the main UI.")
      .addButton((button) => {
        button.setButtonText("Reset Order");
        button.onClick(async () => {
          await this.plugin.resetPlaylistCategoryOrder();
          new Notice("Music Pro: playlist order reset.");
          this.display();
        });
      });

    const categoryToggles = library.createDiv({ cls: "music-pro-category-toggle-settings" });
    const allPlaylistCategories = this.plugin.getAllPlaylistCategoryDefinitions();
    const disabledCount = this.plugin.settings.disabledPlaylistCategoryIds.length;
    const anyPlaylistCategoryEnabled = disabledCount < allPlaylistCategories.length;
    categoryToggles.createDiv({ cls: "music-pro-settings-subhead", text: `Visible Playlists${disabledCount ? ` · ${disabledCount} off` : ""}` });
    categoryToggles.createDiv({
      cls: "music-pro-settings-hint",
      text: "Turn off playlists you do not use. Off playlists do not load, search, show, or fetch artwork. Updates keep them off."
    });

    const bulkPlaylistSetting = new Setting(categoryToggles)
      .setName("All Playlists")
      .setDesc("Turn every playlist on or off. Turning off clears Recent.");
    bulkPlaylistSetting.settingEl.addClass("music-pro-bulk-playlist-switch");
    this.addBooleanButton(
      bulkPlaylistSetting,
      anyPlaylistCategoryEnabled,
      async (value) => this.plugin.setAllPlaylistCategoriesEnabled(value),
      { refresh: true }
    );

    const categoryGrid = categoryToggles.createDiv({ cls: "music-pro-category-toggle-grid" });
    for (const category of allPlaylistCategories) {
      const isRecent = category.id === "recent";
      const categorySetting = new Setting(categoryGrid)
        .setName(category.label);
      categorySetting.settingEl.addClass("music-pro-category-toggle-row");
      categorySetting.settingEl.setAttr("data-music-pro-category-id", category.id);
      categorySetting.settingEl.setAttr(
        "data-music-pro-category-kind",
        this.plugin.isPersonalCategory(category.id) ? "personal" : "system"
      );
      if (isRecent) categorySetting.setDesc("Turn off to stop saving Recent history.");
      this.addBooleanButton(
        categorySetting,
        this.plugin.isPlaylistCategoryEnabled(category.id),
        async (value) => this.plugin.setPlaylistCategoryEnabled(category.id, value),
        { refresh: true }
      );
    }

    const personal = library.createDiv({ cls: "music-pro-personal-playlist-settings" });
    personal.createDiv({ cls: "music-pro-settings-subhead", text: "Personal Playlists" });
    personal.createDiv({ cls: "music-pro-settings-hint", text: "Create, rename, or delete your own playlists." });

    let newCategoryName = "";
    new Setting(personal)
      .setName("New Personal Playlist")
      .setDesc("Saved in this vault and kept after updates.")
      .addText((text) => {
        text.setPlaceholder("e.g. Deep Work");
        text.onChange((value) => (newCategoryName = value));
      })
      .addButton((button) => {
        button.setButtonText("Create");
        button.onClick(async () => {
          try {
            await this.plugin.createPersonalCategory(newCategoryName);
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        });
      });

    if (this.plugin.settings.personalCategories.length === 0) {
      personal.createDiv({ cls: "music-pro-settings-hint", text: "No Personal Playlists yet." });
    } else {
      const personalList = personal.createDiv({ cls: "music-pro-personal-playlist-list" });
      for (const category of this.plugin.settings.personalCategories) {
        const row = new Setting(personalList)
          .setName(category.label)
          .setDesc("Type a new name. It saves automatically.");
        this.addAutoSavePersonalPlaylistRename(row, category);
        row.addButton((button) => {
          button.setIcon("trash-2");
          button.setTooltip("Delete Playlist");
          button.onClick(async () => {
            await this.plugin.deletePersonalCategory(category.id);
            new Notice("Music Pro: Personal Playlist deleted.");
            this.display();
          });
        });
      }
    }

  }


  private addAutoSavePersonalPlaylistRename(setting: Setting, category: { id: string; label: string }): void {
    let savedLabel = category.label;
    let pendingTimer: number | null = null;
    let lastError = "";

    const clearPending = () => {
      if (pendingTimer === null) return;
      window.clearTimeout(pendingTimer);
      pendingTimer = null;
    };

    setting.addText((text) => {
      text.setValue(savedLabel);
      text.inputEl.addClass("music-pro-personal-playlist-name-input");
      text.inputEl.setAttr("aria-label", `Rename ${savedLabel}`);
      text.onChange((value) => {
        clearPending();
        const nextLabel = value.trim();
        setting.setName(nextLabel || savedLabel);
        if (!nextLabel || nextLabel === savedLabel) return;
        pendingTimer = window.setTimeout(async () => {
          pendingTimer = null;
          try {
            await this.plugin.renamePersonalCategory(category.id, nextLabel);
            savedLabel = nextLabel;
            lastError = "";
            text.inputEl.setAttr("aria-label", `Rename ${savedLabel}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== lastError) new Notice(message);
            lastError = message;
            text.setValue(savedLabel);
            setting.setName(savedLabel);
          }
        }, 450);
      });
      text.inputEl.addEventListener("blur", () => {
        if (pendingTimer === null) return;
        window.clearTimeout(pendingTimer);
        pendingTimer = null;
        const nextLabel = text.getValue().trim();
        if (!nextLabel || nextLabel === savedLabel) return;
        this.plugin.renamePersonalCategory(category.id, nextLabel)
          .then(() => {
            savedLabel = nextLabel;
            lastError = "";
            setting.setName(savedLabel);
            text.inputEl.setAttr("aria-label", `Rename ${savedLabel}`);
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== lastError) new Notice(message);
            lastError = message;
            text.setValue(savedLabel);
            setting.setName(savedLabel);
          });
      });
    });
  }


  private createSettingsSection(container: HTMLElement, title: string, description: string, cls = ""): HTMLElement {
    const section = container.createDiv({ cls: `music-pro-settings-section ${cls}`.trim() });
    const header = section.createDiv({ cls: "music-pro-settings-section-header" });
    header.createDiv({ cls: "music-pro-settings-section-title", text: title });
    if (description) header.createDiv({ cls: "music-pro-settings-section-desc", text: description });
    return section;
  }

  private addBooleanButton(
    setting: Setting,
    value: boolean,
    onChange: (value: boolean) => Promise<void> | void,
    options: { refresh?: boolean; onText?: string; offText?: string } = {}
  ): Setting {
    setting.addButton((button) => {
      button.buttonEl.addClass("music-pro-toggle-button");
      let current = Boolean(value);
      const render = () => {
        button.setButtonText(current ? (options.onText || "On") : (options.offText || "Off"));
        button.setIcon(current ? "check" : "minus");
        button.buttonEl.toggleClass("is-active", current);
        button.buttonEl.setAttr("aria-pressed", String(current));
      };
      render();
      button.onClick(async () => {
        current = !current;
        render();
        try {
          await onChange(current);
          if (options.refresh) this.display();
        } catch (error) {
          current = !current;
          render();
          new Notice(error instanceof Error ? error.message : String(error));
        }
      });
    });
    return setting;
  }

  private renderAccentColorPresets(container: HTMLElement): void {
    const palette = container.createDiv({
      cls: "music-pro-accent-palette",
      attr: { "aria-label": "Accent Color Presets" }
    });
    palette.createDiv({ cls: "music-pro-accent-palette-label", text: "Presets" });

    const current = this.plugin.settings.accentColor.toLowerCase();
    for (const preset of ACCENT_COLOR_PRESETS) {
      const isActive = current === preset.color;
      const swatch = palette.createEl("button", {
        cls: `music-pro-accent-swatch ${isActive ? "is-active" : ""}`,
        attr: {
          type: "button",
          "aria-label": `Use ${preset.label} Accent`,
          "aria-pressed": String(isActive)
        }
      });
      swatch.style.setProperty("--music-pro-swatch", preset.color);
      swatch.createSpan({ cls: "music-pro-accent-swatch-color" }).style.setProperty("background-color", preset.color);
      swatch.createSpan({ cls: "music-pro-accent-swatch-check" });
      swatch.addEventListener("click", async () => {
        await this.plugin.setAccentColor(preset.color);
        this.display();
      });
    }
  }

}
