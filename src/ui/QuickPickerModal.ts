import { Modal, setIcon } from "obsidian";
import type MusicProPlugin from "../main";
import { buildPlaylistIndex, type PlaylistIndex } from "../catalog/PlaylistIndex";
import type { CatalogItem } from "../catalog/types";
import {
  COMMUNITY_PLAYLIST_CATEGORY_ID,
  DEFAULT_PLAYLIST_CATEGORY_ID,
  RECENT_PLAYLIST_CATEGORY_ID,
  normalizePlaylistText
} from "../catalog/playlistCategories";
import { debounce } from "../utils/debounce";
import { getDisplaySubtitle, getDisplayTitle } from "../utils/normalize";

export class QuickPickerModal extends Modal {
  private plugin: MusicProPlugin;
  private query = "";
  private category = DEFAULT_PLAYLIST_CATEGORY_ID;
  private indexCache: { items: CatalogItem[]; categoryFingerprint: string; index: PlaylistIndex } | null = null;

  constructor(plugin: MusicProPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("music-pro-quick-picker");
    this.plugin.applyAccentToElement(contentEl);
    if (!this.plugin.isPlaylistCategoryEnabled(this.category)) this.category = this.plugin.getFallbackPlaylistCategoryId();

    const header = contentEl.createDiv({ cls: "music-pro-quick-header" });
    header.createEl("h2", { text: "Quick Pick" });
    header.createEl("p", { text: "Choose music or playlist without leaving compact mode." });

    const searchWrap = contentEl.createDiv({ cls: "music-pro-search-wrap" });
    setIcon(searchWrap.createSpan({ cls: "music-pro-search-icon" }), "search");
    const input = searchWrap.createEl("input", {
      cls: "music-pro-search-input",
      attr: { placeholder: "Search tracks, playlists, moods…", value: this.query }
    }) as HTMLInputElement;
    const onSearch = debounce(() => {
      this.query = input.value;
      this.renderList();
    }, 100);
    input.addEventListener("input", onSearch);
    setTimeout(() => input.focus(), 40);

    const cats = contentEl.createDiv({ cls: "music-pro-categories" });
    for (const category of this.plugin.getPlaylistCategoryDefinitions()) {
      const chip = cats.createEl("button", { cls: `music-pro-chip ${category.id === this.category ? "is-active" : ""}` });
      chip.createSpan({ cls: "music-pro-chip-label", text: category.shortLabel || category.label });
      chip.createSpan({ cls: "music-pro-chip-count", text: String(this.countCategory(category.id)) });
      chip.addEventListener("click", () => {
        this.category = category.id;
        this.render();
      });
    }

    contentEl.createDiv({ cls: "music-pro-quick-list", attr: { "data-quick-list": "true" } });
    this.renderList();
  }

  private renderList(): void {
    const list = this.contentEl.querySelector<HTMLElement>('[data-quick-list="true"]');
    if (!list) return;
    list.empty();
    const userIds = new Set(this.plugin.catalog.getUserItems().map((item) => item.id));
    const merged = this.searchItems();
    const ordered = [
      ...merged.filter((item) => userIds.has(item.id)),
      ...merged.filter((item) => !userIds.has(item.id))
    ];
    if (ordered.length === 0) {
      list.createDiv({ cls: "music-pro-empty", text: "No Music Found." });
      return;
    }
    for (const item of ordered.slice(0, 60)) this.renderItem(list, item);
  }

  private renderItem(list: HTMLElement, item: CatalogItem): void {
    const displayTitle = getDisplayTitle(item);
    const row = list.createEl("button", { cls: "music-pro-quick-item" });
    const icon = row.createSpan({ cls: "music-pro-quick-icon" });
    setIcon(icon, item.type === "playlist" ? "list-music" : "music");
    const body = row.createSpan({ cls: "music-pro-quick-body" });
    body.createSpan({ cls: "music-pro-quick-title", text: displayTitle });
    body.createSpan({ cls: "music-pro-quick-subtitle", text: getDisplaySubtitle(item) || item.artist });
    row.addEventListener("click", async () => {
      await this.plugin.playItem(item);
      this.close();
    });
  }

  private searchItems(): CatalogItem[] {
    const index = this.getPlaylistIndex();
    const q = normalizePlaylistText(this.query);
    const base = this.category === DEFAULT_PLAYLIST_CATEGORY_ID
      ? index.editorsChoiceItems
      : this.category === RECENT_PLAYLIST_CATEGORY_ID
        ? this.plugin.getRecentlyPlayedItems()
        : this.category === COMMUNITY_PLAYLIST_CATEGORY_ID
          ? this.plugin.getCommunityPlaylistItemsFromBuckets(index.byCategory)
          : index.byCategory.get(this.category) || [];
    const ranked = this.category === RECENT_PLAYLIST_CATEGORY_ID || this.category === COMMUNITY_PLAYLIST_CATEGORY_ID
      ? base
      : this.plugin.rankCatalogItemsForCategory(this.category, base);
    if (!q) return ranked;
    return ranked.filter((item) => (index.searchTextById.get(item.id) || "").includes(q));
  }

  private countCategory(categoryId: string): number {
    const index = this.getPlaylistIndex();
    if (categoryId === DEFAULT_PLAYLIST_CATEGORY_ID) return index.editorsChoiceItems.length;
    if (categoryId === RECENT_PLAYLIST_CATEGORY_ID) return this.plugin.getRecentlyPlayedItems().length;
    if (categoryId === COMMUNITY_PLAYLIST_CATEGORY_ID) return this.plugin.getCommunityPlaylistItemsFromBuckets(index.byCategory).length;
    return index.counts.get(categoryId) || 0;
  }

  private getPlaylistIndex(): PlaylistIndex {
    const items = this.plugin.getCatalogItemsWithPersonalAssignments();
    const personalDefinitions = this.plugin.getEnabledPersonalCategoryDefinitions();
    const baseDefinitions = this.plugin.getEnabledBasePlaylistCategoryDefinitions();
    const categoryFingerprint = `${baseDefinitions.map((category) => category.id).join("|")}::${personalDefinitions.map((category) => `${category.id}:${category.label}`).join("|")}::${this.plugin.getPersonalAssignmentFingerprint()}::${this.plugin.settings.disabledPlaylistCategoryIds.join("|")}`;
    if (!this.indexCache || this.indexCache.items !== items || this.indexCache.categoryFingerprint !== categoryFingerprint) {
      this.indexCache = { items, categoryFingerprint, index: buildPlaylistIndex(items, personalDefinitions, baseDefinitions) };
    }
    return this.indexCache.index;
  }
}
