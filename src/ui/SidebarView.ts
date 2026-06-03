import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import type MusicProPlugin from "../main";
import { buildPlaylistIndex, type PlaylistIndex } from "../catalog/PlaylistIndex";
import type { CatalogItem } from "../catalog/types";
import {
  COMMUNITY_PLAYLIST_CATEGORY_ID,
  DEFAULT_PLAYLIST_CATEGORY_ID,
  RECENT_PLAYLIST_CATEGORY_ID,
  getPlaylistCategoryDefinition,
  getPlaylistCategoryIds,
  isEditorsChoice,
  normalizePlaylistText
} from "../catalog/playlistCategories";
import { debounce } from "../utils/debounce";
import { applyArtworkPlaceholderStyle } from "../utils/artworkPlaceholder";
import { assertEmbeddableSoundCloudUrl, formatDuration, getDisplaySubtitle, getDisplayTitle } from "../utils/normalize";
import type { SoundCloudSound } from "../player/types";

export const MUSIC_PRO_VIEW_TYPE = "music-pro-sidebar";

interface LibraryFilterOption {
  value: string;
  label: string;
  count: number;
}

interface SearchResultGroup {
  categoryId: string;
  label: string;
  items: CatalogItem[];
  isCurrent: boolean;
}

interface ScrollSnapshot {
  contentTop: number;
  containerTop: number;
  parentTop: number;
  viewContentTop: number;
  playlistCategoryScrollLeft: number;
  playlistCategoryScrollTop: number;
  trackListScrollTop: number;
  trackListScrollLeft: number;
  trackListItemId: string;
  interactionVersion: number;
  expiresAt: number;
  lockItemId?: string;
  anchorItemId?: string;
  anchorViewportTop?: number;
}

export class MusicProSidebarView extends ItemView {
  private plugin: MusicProPlugin;
  private query = "";
  private category = DEFAULT_PLAYLIST_CATEGORY_ID;
  private unsubscribe: (() => void) | null = null;
  private lastStateKey = "";
  private progressFill: HTMLElement | null = null;
  private progressLabel: HTMLElement | null = null;
  private seekInput: HTMLInputElement | null = null;
  private leftTimeEl: HTMLElement | null = null;
  private rightTimeEl: HTMLElement | null = null;
  private volumeInput: HTMLInputElement | null = null;
  private volumeIconEl: HTMLElement | null = null;
  private volumeValueEl: HTMLElement | null = null;
  private lastRenderedVolume = -1;
  private imageObserver: IntersectionObserver | null = null;
  private indexCache: { items: CatalogItem[]; categoryFingerprint: string; index: PlaylistIndex } | null = null;
  private visibleItemLimit = 36;
  private readonly visibleItemStep = 36;
  private isAddMode = false;
  private addUrl = "";
  private addNewCategoryName = "";
  private addSelectedCategories: string[] = [];
  private isAddSaving = false;
  private folderPickerItemId = "";
  private folderPickerNewName = "";
  private isFolderPickerSaving = false;
  private pendingScrollSnapshot: ScrollSnapshot | null = null;
  private scrollRestoreToken = 0;
  private scrollInteractionVersion = 0;
  private readonly playlistLoadScrollLockMs = 8000;
  private readonly dragHoldDelayMs = 230;
  private readonly markScrollInteraction = () => {
    this.scrollInteractionVersion += 1;
    this.pendingScrollSnapshot = null;
  };
  private readonly markKeyboardScrollInteraction = (event: KeyboardEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (event.key === " " && target?.closest('button, [role="button"], input, textarea, select')) return;
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) this.markScrollInteraction();
  };

  constructor(leaf: WorkspaceLeaf, plugin: MusicProPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.category = DEFAULT_PLAYLIST_CATEGORY_ID;
  }

  getViewType(): string {
    return MUSIC_PRO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Music Pro";
  }

  getIcon(): string {
    return "music-2";
  }

  private logSidebarActionError(error: unknown): void {
    new Notice(error instanceof Error ? error.message : String(error));
  }

  openAddMode(): void {
    this.isAddMode = true;
    this.folderPickerItemId = "";
    this.query = "";
    this.visibleItemLimit = this.visibleItemStep;
    this.addSelectedCategories = this.parseAddCategories(this.plugin.settings.lastAddCategory || "User");
    this.render();
    window.setTimeout(() => this.contentEl.querySelector<HTMLInputElement>(".music-pro-inline-add-url")?.focus(), 40);
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("music-pro-view-container");
    this.contentEl.addEventListener("wheel", this.markScrollInteraction, { passive: true });
    this.contentEl.addEventListener("touchmove", this.markScrollInteraction, { passive: true });
    this.contentEl.addEventListener("keydown", this.markKeyboardScrollInteraction);
    this.unsubscribe = this.plugin.store.subscribe((state) => {
      const key = `${state.currentItem?.id || ""}|${state.isPlaying}|${state.isLoading}|${state.error || ""}|${state.soundList.length}|${state.soundListVersion}|${state.currentSoundIndex}|${state.currentSoundTitle}|${state.currentSoundArtist}|${state.currentSoundArtworkUrl}|${state.currentSoundIsPreview}|${state.currentSoundIsUnavailable}|${this.plugin.catalog.getItems().length}|${this.plugin.settings.randomPlaylistEnabled}|${this.plugin.settings.loopTrackEnabled}`;
      if (key !== this.lastStateKey) {
        this.lastStateKey = key;
        this.render();
      } else {
        this.updateProgress();
      }
    });
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.removeEventListener("wheel", this.markScrollInteraction);
    this.contentEl.removeEventListener("touchmove", this.markScrollInteraction);
    this.contentEl.removeEventListener("keydown", this.markKeyboardScrollInteraction);
    this.disconnectImageObserver();
    this.contentEl.empty();
  }

  render(): void {
    const { contentEl } = this;
    const pendingSnapshot = this.pendingScrollSnapshot;
    const scrollSnapshot = pendingSnapshot && this.isScrollSnapshotUsable(pendingSnapshot)
      ? pendingSnapshot
      : this.captureScrollSnapshot();
    if (pendingSnapshot && !this.isScrollSnapshotUsable(pendingSnapshot)) this.pendingScrollSnapshot = null;
    this.disconnectImageObserver();
    this.progressFill = null;
    this.progressLabel = null;
    this.seekInput = null;
    this.leftTimeEl = null;
    this.rightTimeEl = null;
    this.volumeInput = null;
    this.volumeIconEl = null;
    this.volumeValueEl = null;
    this.lastRenderedVolume = -1;
    contentEl.empty();
    contentEl.addClass("music-pro-sidebar");
    this.plugin.applyAccentToElement(contentEl);
    if (!this.plugin.isPlaylistCategoryEnabled(this.category)) this.category = this.plugin.getFallbackPlaylistCategoryId();

    const header = contentEl.createDiv({ cls: "music-pro-sidebar-header" });
    const titleBlock = header.createDiv();
    titleBlock.addClass("music-pro-title-wrap");
    titleBlock.createEl("div", { cls: "music-pro-eyebrow", text: this.plugin.app.vault.getName().toUpperCase() });
    const titleRow = titleBlock.createDiv({ cls: "music-pro-title-row" });
    titleRow.createEl("h2", { text: "Music Pro" });
    const support = titleRow.createEl("a", {
      cls: "music-pro-support-link",
      attr: {
        href: "https://ko-fi.com/minhhoang2000",
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": "Feedback & Support",
        "aria-label-position": "top"
      }
    });
    setIcon(support.createSpan({ cls: "music-pro-support-icon" }), "coffee");
    support.createSpan({ cls: "music-pro-support-text", text: "Support" });
    support.addEventListener("click", (event) => {
      event.preventDefault();
      window.open("https://ko-fi.com/minhhoang2000", "_blank");
    });

    this.renderNowPlaying(contentEl);
    this.renderPlaylistTracks(contentEl);

    const library = contentEl.createDiv({ cls: "music-pro-library-panel" });
    this.renderPlaylistLibrary(library);
    this.restoreScrollSnapshot(scrollSnapshot);
  }

  private renderNowPlaying(container: HTMLElement): void {
    const state = this.plugin.store.getState();
    const item = state.currentItem || this.plugin.getDefaultItem();
    const displayTitle = state.currentSoundTitle || (item ? getDisplayTitle(item) : "") || "Ready when you are";
    const displayArtist = state.currentSoundArtist || (item ? getDisplaySubtitle(item) || item.artist : "SoundCloud");
    const displayArtwork = state.currentSoundArtworkUrl || item?.artworkUrl;
    const fullTitle = state.currentSoundTitle || item?.title || displayTitle;
    const card = container.createDiv({ cls: "music-pro-now-card music-pro-now-card-option-b" });

    const art = card.createDiv({ cls: "music-pro-now-art" });
    this.renderArtwork(art, displayArtwork, displayTitle, "music-2", true, item || displayTitle);

    const main = card.createDiv({ cls: "music-pro-now-main" });
    const top = main.createDiv({ cls: "music-pro-now-topline" });
    const text = top.createDiv({ cls: "music-pro-now-text" });
    text.createEl("div", { cls: "music-pro-now-title", text: displayTitle, attr: { "data-music-pro-full-name": fullTitle } });
    text.createEl("div", {
      cls: "music-pro-now-artist",
      text: `${this.compactContext(item, displayArtist)}${state.currentSoundIsPreview ? " · Preview" : ""}${state.currentSoundIsUnavailable ? " · Unavailable" : ""}`
    });

    const controls = top.createDiv({ cls: "music-pro-controls" });
    const prev = controls.createEl("button", { cls: "music-pro-control-button", attr: { "aria-label": "Previous", "aria-label-position": "top" } });
    setIcon(prev, "skip-back");
    prev.addEventListener("click", () => this.plugin.previous());

    const play = controls.createEl("button", { cls: "music-pro-play-button", attr: { "aria-label": state.isPlaying ? "Pause" : "Play", "aria-label-position": "top" } });
    setIcon(play, state.isPlaying ? "pause" : "play");
    play.addEventListener("click", () => this.plugin.playPause());

    const next = controls.createEl("button", { cls: "music-pro-control-button", attr: { "aria-label": "Next", "aria-label-position": "top" } });
    setIcon(next, "skip-forward");
    next.addEventListener("click", () => this.plugin.next());

    const loop = controls.createEl("button", {
      cls: `music-pro-control-button music-pro-loop-toggle ${this.plugin.settings.loopTrackEnabled ? "is-active" : ""}`,
      attr: {
        "aria-label": this.plugin.settings.loopTrackEnabled ? "Turn Track Loop Off" : "Turn Track Loop On",
        "aria-label-position": "top",
        "aria-pressed": String(this.plugin.settings.loopTrackEnabled)
      }
    });
    setIcon(loop, "repeat");
    loop.addEventListener("click", () => this.plugin.toggleLoopTrackMode());

    const miniBtn = controls.createEl("button", {
      cls: "music-pro-control-button music-pro-collapse-button",
      attr: { "aria-label": "Collapse to compact player", "aria-label-position": "top" }
    });
    setIcon(miniBtn, "minimize-2");
    miniBtn.addEventListener("click", () => this.plugin.setMode("mini"));

    const bottom = main.createDiv({ cls: "music-pro-now-bottomline" });
    const progress = bottom.createDiv({ cls: "music-pro-progress music-pro-progress-compact" });
    const leftTime = progress.createSpan({ cls: "music-pro-time-left", text: formatDuration(state.positionMs) });
    this.leftTimeEl = leftTime;
    const progressTrack = progress.createDiv({ cls: "music-pro-progress-track" });
    this.progressFill = progressTrack.createDiv({ cls: "music-pro-progress-fill" });
    const seek = progressTrack.createEl("input", { cls: "music-pro-seek-slider", type: "range" }) as HTMLInputElement;
    this.seekInput = seek;
    seek.min = "0";
    seek.max = String(Math.max(0, state.durationMs));
    seek.step = "1000";
    seek.value = String(Math.max(0, state.positionMs));
    this.syncRangeVisual(seek, state.positionMs, state.durationMs);
    const rightTime = progress.createSpan({ cls: "music-pro-time-right", text: formatDuration(state.durationMs) });
    this.rightTimeEl = rightTime;
    this.progressLabel = null;

    const updateSeekPreview = () => {
      const target = Number(seek.value);
      const max = Number(seek.max) || 0;
      this.syncRangeVisual(seek, target, max);
      if (this.progressFill) this.progressFill.style.width = max > 0 ? `${(target / max) * 100}%` : "0%";
      leftTime.setText(formatDuration(target));
      seek.title = formatDuration(target);
    };
    let lastCommittedSeek = -1;
    const commitSeek = () => {
      const max = Number(seek.max) || 0;
      const value = Number(seek.value) || 0;
      const target = max > 0 ? Math.min(max, Math.max(0, value)) : Math.max(0, value);
      seek.value = String(target);
      this.syncRangeVisual(seek, target, max);
      if (Math.abs(target - lastCommittedSeek) < 250) return;
      lastCommittedSeek = target;
      this.plugin.player.seekTo(target);
    };
    seek.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      seek.value = String(this.rangeValueFromPointer(seek, event, Number(seek.max) || 0));
      updateSeekPreview();
      commitSeek();
    });
    seek.addEventListener("input", updateSeekPreview);
    seek.addEventListener("change", commitSeek);
    seek.addEventListener("click", commitSeek);
    seek.addEventListener("pointerup", commitSeek);
    seek.addEventListener("keyup", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commitSeek();
    });

    const volumeWrap = bottom.createDiv({ cls: "music-pro-now-volume" });
    const volumeIcon = volumeWrap.createSpan({ cls: "music-pro-now-volume-icon" });
    this.volumeIconEl = volumeIcon;
    this.renderVolumeIcon(volumeIcon, state.volume);
    const volume = volumeWrap.createEl("input", { cls: "music-pro-volume", type: "range" }) as HTMLInputElement;
    this.volumeInput = volume;
    volume.min = "0";
    volume.max = "100";
    volume.step = "1";
    volume.value = String(state.volume);
    volume.title = `${state.volume}%`;
    this.syncRangeVisual(volume, state.volume, 100);
    const volumeValue = volumeWrap.createSpan({ cls: "music-pro-volume-value", text: `${state.volume}%` });
    this.volumeValueEl = volumeValue;
    this.lastRenderedVolume = this.clampVolume(state.volume);
    const updateVolumePreview = (commit = false) => {
      const value = this.clampVolume(Number(volume.value));
      volume.value = String(value);
      this.syncRangeVisual(volume, value, 100);
      volumeValue.setText(`${value}%`);
      volume.title = `${value}%`;
      this.renderVolumeIcon(volumeIcon, value);
      this.plugin.setUserVolume(value, commit);
    };
    volume.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      volume.value = String(this.rangeValueFromPointer(volume, event, 100));
      updateVolumePreview(false);
    });
    volume.addEventListener("input", () => updateVolumePreview(false));
    volume.addEventListener("change", () => updateVolumePreview(true));
    volume.addEventListener("pointerup", () => updateVolumePreview(true));

    this.updateProgress();

    if (state.error) {
      main.createDiv({ cls: "music-pro-error", text: state.error });
    }
  }

  private compactContext(item: CatalogItem | null, displayArtist: string): string {
    if (!item) return "Add or refresh SoundCloud catalog";
    return displayArtist;
  }

  private renderPlaylistTracks(container: HTMLElement): void {
    const state = this.plugin.store.getState();
    const item = state.currentItem;
    if (!item) return;
    const isPlaylist = item.type === "playlist";
    const showsSingleTrackCallout = !isPlaylist || (state.playlistReady && state.soundList.length === 1);

    const section = container.createDiv({
      cls: `music-pro-playlist-tracks ${isPlaylist && !state.playlistReady ? "is-loading" : ""} ${showsSingleTrackCallout ? "is-single-track" : ""}`
    });
    const header = section.createDiv({ cls: "music-pro-playlist-header" });
    header.createEl("div", { cls: "music-pro-section-title", text: "Tracks" });

    if (!isPlaylist) {
      this.renderSingleTrackCallout(section);
      return;
    }

    if (!state.playlistReady) {
      section.createDiv({ cls: "music-pro-playlist-empty music-pro-playlist-loading-label", text: "Loading SoundCloud Playlist…" });
      this.renderPlaylistTrackSkeleton(section);
      return;
    }

    if (state.soundList.length === 0) {
      section.createDiv({ cls: "music-pro-playlist-empty", text: "No Tracks Longer Than 30 Seconds." });
      return;
    }

    if (state.soundList.length === 1) {
      this.renderSingleTrackCallout(section);
      return;
    }

    const list = section.createDiv({ cls: "music-pro-playlist-list" });
    const orderedSounds = this.plugin.getOrderedSounds();
    orderedSounds.forEach((sound, index) => {
      const isActive = sound.originalIndex === state.currentSoundIndex;
      const isUnavailable = sound.isPlayable === false;
      const row = list.createDiv({
        cls: `music-pro-playlist-track is-track-reorderable ${isActive ? "is-active" : ""} ${isUnavailable ? "is-unavailable" : ""}`,
        attr: { "data-sound-id": sound.id }
      });
      this.renderPlaylistTrackDragHandle(row, sound);

      const number = row.createSpan({ cls: "music-pro-playlist-number", text: String(index + 1).padStart(2, "0") });
      const body = row.createSpan({ cls: "music-pro-playlist-body" });
      const safeTitle = sound.title || `Track ${index + 1}`;
      body.createSpan({ cls: "music-pro-playlist-title", text: safeTitle, attr: { "data-music-pro-full-name": safeTitle } });
      body.createSpan({ cls: "music-pro-playlist-artist", text: sound.artist || "SoundCloud" });
      row.createSpan({
        cls: `music-pro-playlist-duration ${sound.isPreview ? "is-preview" : ""} ${isUnavailable ? "is-unavailable" : ""}`,
        text: isUnavailable
          ? "Unavailable"
          : sound.durationMs > 0
            ? `${formatDuration(sound.durationMs)}${sound.isPreview ? " Preview" : ""}`
            : "—"
      });
      if (isActive && state.isPlaying) {
        number.empty();
        setIcon(number, "volume-2");
      }
      body.addEventListener("click", () => this.plugin.skipToPlaylistTrack(sound.originalIndex));
      number.addEventListener("click", () => this.plugin.skipToPlaylistTrack(sound.originalIndex));
    });
  }

  private renderSingleTrackCallout(section: HTMLElement): void {
    const callout = section.createDiv({ cls: "music-pro-playlist-empty music-pro-single-track-callout" });
    const icon = callout.createSpan({ cls: "music-pro-single-track-icon" });
    setIcon(icon, "music-2");
    const copy = callout.createDiv({ cls: "music-pro-single-track-copy" });
    copy.createDiv({ cls: "music-pro-single-track-title", text: "This is a single track" });
    copy.createDiv({ cls: "music-pro-single-track-desc", text: "This SoundCloud link is not a playlist, so there are no playlist tracks to show." });
  }

  private renderPlaylistTrackDragHandle(row: HTMLElement, sound: SoundCloudSound): void {
    const handle = row.createSpan({
      cls: "music-pro-drag-handle",
      attr: {
        role: "button",
        tabindex: "0",
        draggable: "true",
        "data-music-pro-sound-id": sound.id,
        "aria-label": "Drag To Reorder. Use Up Or Down Arrows To Move.",
        "aria-label-position": "top"
      }
    });
    handle.draggable = true;
    setIcon(handle, "grip-vertical");
    const clearDragVisual = () => {
      row.removeClass("is-track-dragging");
      handle.removeClass("is-dragging");
    };
    const clearDragVisualOnPointerEnd = () => {
      const clearOnce = () => {
        window.removeEventListener("pointerup", clearOnce);
        window.removeEventListener("pointercancel", clearOnce);
        clearDragVisual();
      };
      window.addEventListener("pointerup", clearOnce);
      window.addEventListener("pointercancel", clearOnce);
    };

    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      row.addClass("is-track-dragging");
      handle.addClass("is-dragging");
      clearDragVisualOnPointerEnd();
    });
    handle.addEventListener("pointerup", clearDragVisual);
    handle.addEventListener("pointercancel", clearDragVisual);
    handle.addEventListener("keydown", async (event) => {
      event.stopPropagation();
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      await this.movePlaylistTrackWithKeyboard(sound, event.key === "ArrowUp" ? -1 : 1);
    });
    handle.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      row.addClass("is-track-dragging");
      handle.addClass("is-dragging");
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/music-pro-sound-id", sound.id);
      event.dataTransfer.setData("text/plain", sound.id);
      event.dataTransfer.setDragImage(row, 18, Math.max(12, row.offsetHeight / 2));
    });
    handle.addEventListener("dragend", () => {
      clearDragVisual();
      this.clearPlaylistTrackDropState();
    });

    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const placement = this.getPlaylistTrackDropPlacement(row, event);
      row.toggleClass("is-track-drop-before", placement === "before");
      row.toggleClass("is-track-drop-after", placement === "after");
    });
    row.addEventListener("dragleave", () => {
      row.removeClass("is-track-drop-before");
      row.removeClass("is-track-drop-after");
    });
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = event.dataTransfer?.getData("text/music-pro-sound-id") || "";
      const placement = this.getPlaylistTrackDropPlacement(row, event);
      this.clearPlaylistTrackDropState();
      if (!sourceId || sourceId === sound.id) return;
      await this.plugin.reorderCurrentPlaylistTrack(sourceId, sound.id, placement);
    });
  }

  private async movePlaylistTrackWithKeyboard(sound: SoundCloudSound, direction: -1 | 1): Promise<void> {
    const sourceId = sound.id;
    const orderedSounds = this.plugin.getOrderedSounds();
    const sourceIndex = orderedSounds.findIndex((candidate) => candidate.id === sourceId);
    if (sourceIndex === -1) return;
    const target = orderedSounds[sourceIndex + direction];
    if (!target) return;
    await this.plugin.reorderCurrentPlaylistTrack(
      sourceId,
      target.id,
      direction < 0 ? "before" : "after"
    );
    window.setTimeout(() => {
      const handles = this.contentEl.querySelectorAll<HTMLElement>(".music-pro-drag-handle");
      for (const candidate of handles) {
        if (candidate.getAttribute("data-music-pro-sound-id") !== sourceId) continue;
        candidate.focus();
        break;
      }
    }, 40);
  }

  private getPlaylistTrackDropPlacement(row: HTMLElement, event: DragEvent): "before" | "after" {
    const rect = row.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
  }

  private clearPlaylistTrackDropState(): void {
    for (const row of this.contentEl.querySelectorAll<HTMLElement>(".music-pro-playlist-track.is-track-reorderable")) {
      row.removeClass("is-track-dragging");
      row.removeClass("is-track-drop-before");
      row.removeClass("is-track-drop-after");
    }
  }

  private renderPlaylistTrackSkeleton(section: HTMLElement): void {
    const list = section.createDiv({ cls: "music-pro-playlist-list music-pro-playlist-skeleton-list", attr: { "aria-hidden": "true" } });
    for (let index = 0; index < 5; index += 1) {
      const row = list.createDiv({ cls: "music-pro-playlist-track music-pro-playlist-skeleton-track" });
      row.createSpan({ cls: "music-pro-drag-handle music-pro-skeleton-dot" });
      const body = row.createSpan({ cls: "music-pro-playlist-body" });
      body.createSpan({ cls: "music-pro-skeleton-line is-title" });
      body.createSpan({ cls: "music-pro-skeleton-line is-subtitle" });
      row.createSpan({ cls: "music-pro-skeleton-time" });
    }
  }

  private captureScrollSnapshot(anchorEl?: HTMLElement, anchorItemId = ""): ScrollSnapshot {
    const parent = this.contentEl.parentElement as HTMLElement | null;
    const viewContent = this.containerEl.querySelector<HTMLElement>(".view-content");
    const playlistCategoryRail = this.contentEl.querySelector<HTMLElement>(".music-pro-playlist-categories");
    const trackList = this.getTrackListScroller();
    const currentItemId = this.plugin.store.getState().currentItem?.id || "";
    const snapshot: ScrollSnapshot = {
      contentTop: this.normalizeScrollTop(this.contentEl.scrollTop || 0),
      containerTop: this.normalizeScrollTop(this.containerEl.scrollTop || 0),
      parentTop: this.normalizeScrollTop(parent?.scrollTop || 0),
      viewContentTop: this.normalizeScrollTop(viewContent?.scrollTop || 0),
      playlistCategoryScrollLeft: playlistCategoryRail?.scrollLeft || 0,
      playlistCategoryScrollTop: playlistCategoryRail?.scrollTop || 0,
      trackListScrollTop: trackList?.scrollTop || 0,
      trackListScrollLeft: trackList?.scrollLeft || 0,
      trackListItemId: currentItemId,
      interactionVersion: this.scrollInteractionVersion,
      expiresAt: anchorItemId ? Date.now() + this.playlistLoadScrollLockMs : Date.now() + 1200,
      ...(anchorItemId ? { lockItemId: anchorItemId } : {})
    };
    if (anchorEl && anchorItemId) {
      snapshot.anchorItemId = anchorItemId;
      snapshot.anchorViewportTop = anchorEl.getBoundingClientRect().top;
    }
    return snapshot;
  }

  private normalizeScrollTop(value: number): number {
    // Preserve exact scroll positions across reactive playback renders. Only
    // squash sub-pixel noise, never a real near-top offset, so loading stages
    // cannot yank the sidebar back to the player/header.
    return Math.abs(value) < 1 ? 0 : value;
  }

  private getTrackListScroller(): HTMLElement | null {
    return this.contentEl.querySelector<HTMLElement>(".music-pro-playlist-tracks .music-pro-playlist-list");
  }

  private isScrollSnapshotUsable(snapshot: ScrollSnapshot): boolean {
    if (snapshot.interactionVersion !== this.scrollInteractionVersion) return false;
    if (Date.now() > snapshot.expiresAt) return false;
    if (!snapshot.lockItemId) return true;
    const currentItemId = this.plugin.store.getState().currentItem?.id || "";
    return !currentItemId || currentItemId === snapshot.lockItemId;
  }

  private shouldKeepPendingScrollSnapshot(snapshot: ScrollSnapshot): boolean {
    return Boolean(snapshot.lockItemId) && this.isScrollSnapshotUsable(snapshot);
  }

  private restoreScrollSnapshot(snapshot: ScrollSnapshot): void {
    this.pendingScrollSnapshot = snapshot;
    const token = ++this.scrollRestoreToken;
    const apply = () => {
      this.contentEl.scrollTop = snapshot.contentTop;
      this.containerEl.scrollTop = snapshot.containerTop;
      const parent = this.contentEl.parentElement as HTMLElement | null;
      if (parent) parent.scrollTop = snapshot.parentTop;
      const viewContent = this.containerEl.querySelector<HTMLElement>(".view-content");
      if (viewContent) viewContent.scrollTop = snapshot.viewContentTop;
      const playlistCategoryRail = this.contentEl.querySelector<HTMLElement>(".music-pro-playlist-categories");
      if (playlistCategoryRail) {
        playlistCategoryRail.scrollLeft = snapshot.playlistCategoryScrollLeft;
        playlistCategoryRail.scrollTop = snapshot.playlistCategoryScrollTop;
      }
      this.restoreTrackListScroll(snapshot);
      this.restoreScrollAnchor(snapshot);
    };
    const applyIfCurrent = () => {
      if (token !== this.scrollRestoreToken) return;
      if (!this.isScrollSnapshotUsable(snapshot)) {
        if (this.pendingScrollSnapshot === snapshot) this.pendingScrollSnapshot = null;
        return;
      }
      apply();
    };

    apply();
    requestAnimationFrame(() => {
      applyIfCurrent();
      requestAnimationFrame(() => applyIfCurrent());
    });
    window.setTimeout(() => {
      applyIfCurrent();
      if (token !== this.scrollRestoreToken || this.pendingScrollSnapshot !== snapshot) return;
      if (!this.shouldKeepPendingScrollSnapshot(snapshot)) this.pendingScrollSnapshot = null;
    }, 260);
  }

  private restoreTrackListScroll(snapshot: ScrollSnapshot): void {
    const currentItemId = this.plugin.store.getState().currentItem?.id || "";
    if (!snapshot.trackListItemId || snapshot.trackListItemId !== currentItemId) return;
    const trackList = this.getTrackListScroller();
    if (!trackList) return;
    trackList.scrollTop = snapshot.trackListScrollTop;
    trackList.scrollLeft = snapshot.trackListScrollLeft;
  }

  private rememberPlaylistItemScrollAnchor(row: HTMLElement, itemId: string): void {
    this.pendingScrollSnapshot = this.captureScrollSnapshot(row, itemId);
  }

  private suppressMouseFocus(element: HTMLElement): void {
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('button, a, input, textarea, select, .music-pro-folder-item-drag-handle, .music-pro-drag-handle')) return;
      event.preventDefault();
    });
  }

  private restoreScrollAnchor(snapshot: ScrollSnapshot): void {
    if (!snapshot.anchorItemId || typeof snapshot.anchorViewportTop !== "number") return;
    const anchor = this.findPlaylistItemAnchor(snapshot.anchorItemId);
    if (!anchor) return;
    const delta = anchor.getBoundingClientRect().top - snapshot.anchorViewportTop;
    if (Math.abs(delta) < 1) return;
    const scrollEl = this.getPrimaryScrollContainer();
    if (scrollEl) scrollEl.scrollTop += delta;
  }

  private findPlaylistItemAnchor(itemId: string): HTMLElement | null {
    for (const row of this.contentEl.querySelectorAll<HTMLElement>("[data-music-pro-item-id]")) {
      if (row.dataset.musicProItemId === itemId) return row;
    }
    return null;
  }

  private getPrimaryScrollContainer(): HTMLElement | null {
    const parent = this.contentEl.parentElement as HTMLElement | null;
    const viewContent = this.containerEl.querySelector<HTMLElement>(".view-content");
    const candidates = [viewContent, parent, this.contentEl, this.containerEl]
      .filter((element, index, array): element is HTMLElement => Boolean(element) && array.indexOf(element) === index);
    return candidates.find((element) => element.scrollHeight > element.clientHeight + 1 && element.scrollTop > 0)
      || candidates.find((element) => element.scrollHeight > element.clientHeight + 1)
      || null;
  }

  private renderPlaylistLibrary(container: HTMLElement): void {
    const shell = container.createDiv({ cls: "music-pro-playlist-browser" });
    const rail = shell.createDiv({ cls: "music-pro-playlist-rail" });
    const content = shell.createDiv({ cls: "music-pro-playlist-content" });
    this.renderPlaylistCategoryRail(rail);
    if (this.isAddMode) {
      this.renderInlineAddPanel(content);
      return;
    }
    const folderPickerItem = this.getInlineFolderPickerItem();
    if (folderPickerItem) {
      this.renderInlineFolderPickerPanel(content, folderPickerItem);
      return;
    }
    this.folderPickerItemId = "";
    this.renderSearch(content);
    const results = content.createDiv({ cls: "music-pro-playlist-results", attr: { "data-music-pro-results": "true" } });
    this.renderCatalog(results);
  }

  private renderPlaylistCategoryRail(container: HTMLElement): void {
    const head = container.createDiv({ cls: "music-pro-playlist-rail-head" });
    head.createEl("div", { cls: "music-pro-playlist-rail-title", text: "Playlists" });
    const actions = head.createDiv({ cls: "music-pro-playlist-rail-actions" });
    const add = actions.createEl("button", {
      cls: "music-pro-rail-icon-button",
      attr: {
        "aria-label": "Add SoundCloud link or Personal Playlist",
        "aria-label-position": "top"
      }
    });
    setIcon(add, "plus");
    add.toggleClass("is-active", this.isAddMode);
    add.addEventListener("click", () => this.openAddMode());

    const random = actions.createEl("button", {
      cls: `music-pro-rail-icon-button music-pro-random-toggle ${this.plugin.settings.randomPlaylistEnabled ? "is-active" : ""}`,
      attr: {
        "aria-label": this.plugin.settings.randomPlaylistEnabled ? "Turn random playlist off" : "Turn random playlist on",
        "aria-label-position": "top",
        "aria-pressed": String(this.plugin.settings.randomPlaylistEnabled)
      }
    });
    setIcon(random, "shuffle");
    random.addEventListener("click", () => this.plugin.toggleRandomPlaylistMode());

    const options = this.getPlaylistCategoryOptions();
    const list = container.createDiv({ cls: "music-pro-playlist-categories" });
    for (const option of options) {
      const definition = this.getCategoryDefinition(option.value);
      const isActive = option.value === this.category;
      const isPersonal = this.plugin.settings.personalCategories.some((category) => category.id === option.value);
      const button = list.createEl("button", {
        cls: `music-pro-playlist-category ${isActive ? "is-active" : ""}`,
        attr: {
          "aria-label": isPersonal
            ? `${definition.label} · ${option.count} playlists · Right-click to rename/delete`
            : definition.label,
          "aria-label-position": "top",
          "data-music-pro-category-id": option.value,
          "data-music-pro-category-kind": isPersonal ? "personal" : "system"
        }
      });
      button.toggleClass("is-personal", isPersonal);
      button.toggleClass("is-system", !isPersonal);
      if (isPersonal) {
        button.addEventListener("contextmenu", (event) => this.openPersonalCategoryMenu(event, option.value, definition.label));
      }
      this.attachHoldToDrag(button, (event) => {
        event.dataTransfer?.setData("text/music-pro-category-id", option.value);
        event.dataTransfer?.setData("text/plain", option.value);
      }, () => {
        for (const category of list.querySelectorAll<HTMLElement>(".music-pro-playlist-category")) category.removeClass("is-drag-over");
      });
      button.addEventListener("dragover", (event) => {
        event.preventDefault();
        button.addClass("is-drag-over");
      });
      button.addEventListener("dragleave", () => button.removeClass("is-drag-over"));
      button.addEventListener("drop", async (event) => {
        event.preventDefault();
        button.removeClass("is-drag-over");
        const sourceId = event.dataTransfer?.getData("text/music-pro-category-id") || "";
        if (sourceId) await this.plugin.reorderPlaylistCategory(sourceId, option.value);
      });
      const icon = button.createSpan({ cls: "music-pro-playlist-category-icon" });
      setIcon(icon, definition.icon);
      const label = button.createSpan({ cls: "music-pro-playlist-category-label", text: option.label });
      label.setAttr("data-full-label", definition.label);
      if (isPersonal) button.createSpan({ cls: "music-pro-playlist-category-count", text: String(option.count) });
      button.addEventListener("click", () => {
        this.isAddMode = false;
        this.folderPickerItemId = "";
        this.category = option.value;
        this.query = "";
        this.visibleItemLimit = this.visibleItemStep;
        this.plugin.settings.lastSelectedCategory = option.value;
        this.plugin.saveSettings().catch(() => undefined);
        this.render();
      });
    }
  }

  private attachHoldToDrag(source: HTMLElement, onDragStart: (event: DragEvent) => void, onDragEnd?: () => void): void {
    let holdTimer: number | null = null;
    let dragArmed = false;
    let downX = 0;
    let downY = 0;
    const cancelMovePx = 7;

    const clearTimer = () => {
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    const disarm = () => {
      clearTimer();
      dragArmed = false;
      source.draggable = false;
      source.removeClass("is-drag-armed");
      source.removeClass("is-dragging");
    };

    source.draggable = false;
    source.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      downX = event.clientX;
      downY = event.clientY;
      disarm();
      holdTimer = window.setTimeout(() => {
        dragArmed = true;
        source.draggable = true;
        source.addClass("is-drag-armed");
      }, this.dragHoldDelayMs);
    });
    source.addEventListener("pointermove", (event) => {
      if (dragArmed || holdTimer === null) return;
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > cancelMovePx) disarm();
    });
    source.addEventListener("pointerup", () => window.setTimeout(disarm, 0));
    source.addEventListener("pointercancel", disarm);
    source.addEventListener("contextmenu", disarm);
    source.addEventListener("dragstart", (event) => {
      if (!dragArmed) {
        event.preventDefault();
        return;
      }
      clearTimer();
      source.addClass("is-dragging");
      onDragStart(event);
    });
    source.addEventListener("dragend", () => {
      onDragEnd?.();
      disarm();
    });
  }

  private openPersonalCategoryMenu(event: MouseEvent, categoryId: string, label: string): void {
    event.preventDefault();
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle("Rename Playlist")
        .setIcon("pencil")
        .onClick(async () => {
          const nextLabel = window.prompt("Rename Personal Playlist", label);
          if (nextLabel === null || !nextLabel.trim() || nextLabel.trim() === label) return;
          try {
            await this.plugin.renamePersonalCategory(categoryId, nextLabel);
            this.addSelectedCategories = this.addSelectedCategories.map((selected) => (
              normalizePlaylistText(selected) === normalizePlaylistText(label) ? nextLabel.trim() : selected
            ));
            this.render();
          } catch (error) {
            this.logSidebarActionError(error);
          }
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("Delete Playlist")
        .setIcon("trash-2")
        .onClick(async () => {
          if (!window.confirm(`Delete Personal Playlist “${label}”? Playlists stay in your library.`)) return;
          try {
            await this.plugin.deletePersonalCategory(categoryId);
            if (this.category === categoryId) this.category = DEFAULT_PLAYLIST_CATEGORY_ID;
            this.addSelectedCategories = this.addSelectedCategories.filter((selected) => (
              normalizePlaylistText(selected) !== normalizePlaylistText(label)
            ));
            this.render();
          } catch (error) {
            this.logSidebarActionError(error);
          }
        });
    });
    menu.showAtMouseEvent(event);
  }

  private renderSearch(container: HTMLElement): void {
    const searchWrap = container.createDiv({ cls: "music-pro-search-wrap" });
    setIcon(searchWrap.createSpan({ cls: "music-pro-search-icon" }), "search");
    const input = searchWrap.createEl("input", {
      cls: "music-pro-search-input",
      attr: {
        placeholder: "Search playlist, mood, artist…",
        value: this.query
      }
    }) as HTMLInputElement;
    const onSearch = debounce(() => {
      this.query = input.value;
      this.visibleItemLimit = this.visibleItemStep;
      this.renderCatalogOnly();
    }, 120);
    input.addEventListener("input", onSearch);
  }

  private renderInlineAddPanel(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "music-pro-inline-add-panel" });
    const header = panel.createDiv({ cls: "music-pro-inline-add-header" });
    header.createDiv({ cls: "music-pro-inline-add-title", text: "Add Music" });
    const close = header.createEl("button", { cls: "music-pro-icon-button", attr: { "aria-label": "Close Add Mode", "aria-label-position": "top" } });
    setIcon(close, "x");
    close.addEventListener("click", () => {
      this.isAddMode = false;
      this.render();
    });

    const urlRow = panel.createDiv({ cls: "music-pro-inline-field" });
    urlRow.createEl("label", { cls: "music-pro-inline-label", text: "SoundCloud Link" });
    const urlInput = urlRow.createEl("input", {
      cls: "music-pro-inline-add-url",
      attr: {
        placeholder: "Paste track or playlist URL…",
        value: this.addUrl
      }
    }) as HTMLInputElement;
    const preview = urlRow.createDiv({ cls: "music-pro-inline-preview" });

    const categorySection = panel.createDiv({ cls: "music-pro-inline-category-section" });
    categorySection.createEl("div", { cls: "music-pro-inline-label", text: "Personal Playlists" });
    const chips = categorySection.createDiv({ cls: "music-pro-inline-category-chips" });
    const personalCategoryDefinitions = this.getPersonalAddCategoryDefinitions();
    for (const category of personalCategoryDefinitions) {
      const selected = this.addSelectedCategories.some((value) => normalizePlaylistText(value) === normalizePlaylistText(category.label));
      const chip = chips.createEl("button", {
        cls: `music-pro-chip ${selected ? "is-active" : ""}`,
        attr: { type: "button" }
      });
      setIcon(chip.createSpan({ cls: "music-pro-chip-icon" }), category.icon);
      chip.createSpan({ cls: "music-pro-chip-label", text: category.label });
      chip.addEventListener("click", () => this.toggleInlineAddCategory(category.label));
    }
    if (personalCategoryDefinitions.length === 0) {
      categorySection.createDiv({ cls: "music-pro-inline-hint", text: "Create a Personal Playlist below, then select it for this playlist." });
    }

    const folderRow = panel.createDiv({ cls: "music-pro-inline-folder-row" });
    folderRow.createEl("div", { cls: "music-pro-inline-label", text: "New Personal Playlist" });
    const folderInput = folderRow.createEl("input", {
      cls: "music-pro-inline-folder-input",
      attr: {
        placeholder: "Playlist Name",
        value: this.addNewCategoryName
      }
    }) as HTMLInputElement;
    folderInput.addEventListener("input", () => (this.addNewCategoryName = folderInput.value));
    folderInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.createInlineFolder();
      }
    });
    const createFolder = folderRow.createEl("button", { cls: "music-pro-text-button", text: "Create" });
    createFolder.addEventListener("click", () => this.createInlineFolder());

    const actions = panel.createDiv({ cls: "music-pro-inline-add-actions" });
    const submit = actions.createEl("button", { cls: "music-pro-text-button music-pro-inline-submit", text: this.isAddSaving ? "Adding…" : "Add & Play" });
    submit.toggleClass("is-cta", true);
    const cancel = actions.createEl("button", { cls: "music-pro-text-button", text: "Cancel" });
    cancel.addEventListener("click", () => {
      this.isAddMode = false;
      this.render();
    });

    const syncPreview = () => {
      const previewText = this.getInlineAddPreview();
      preview.toggleClass("is-empty", !previewText);
      preview.setText(previewText);
      submit.disabled = this.isAddSaving || !this.canSubmitInlineAdd();
    };
    urlInput.addEventListener("input", () => {
      this.addUrl = urlInput.value;
      syncPreview();
    });
    urlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submitInlineAdd();
      }
    });
    submit.addEventListener("click", () => this.submitInlineAdd());
    syncPreview();
    window.setTimeout(() => urlInput.focus(), 30);
  }

  private openInlineFolderPicker(item: CatalogItem): void {
    this.isAddMode = false;
    this.folderPickerItemId = item.id;
    this.folderPickerNewName = "";
    this.query = "";
    this.visibleItemLimit = this.visibleItemStep;
    this.render();
    window.setTimeout(() => this.contentEl.querySelector<HTMLInputElement>(".music-pro-inline-folder-picker-input")?.focus(), 40);
  }

  private closeInlineFolderPicker(): void {
    this.folderPickerItemId = "";
    this.folderPickerNewName = "";
    this.isFolderPickerSaving = false;
    this.render();
  }

  private getInlineFolderPickerItem(): CatalogItem | null {
    if (!this.folderPickerItemId) return null;
    return this.plugin.getCatalogItemsWithPersonalAssignments().find((item) => item.id === this.folderPickerItemId)
      || this.plugin.catalog.getItems().find((item) => item.id === this.folderPickerItemId)
      || null;
  }

  private renderInlineFolderPickerPanel(container: HTMLElement, item: CatalogItem): void {
    const displayTitle = getDisplayTitle(item);
    const panel = container.createDiv({ cls: "music-pro-inline-add-panel music-pro-inline-folder-picker" });
    const header = panel.createDiv({ cls: "music-pro-inline-add-header" });
    const title = header.createDiv();
    title.createDiv({ cls: "music-pro-inline-add-title", text: "Add To Playlist" });
    title.createDiv({ cls: "music-pro-inline-folder-picker-subtitle", text: displayTitle });
    const close = header.createEl("button", { cls: "music-pro-icon-button", attr: { "aria-label": "Close Folder Picker", "aria-label-position": "top" } });
    setIcon(close, "x");
    close.addEventListener("click", () => this.closeInlineFolderPicker());

    const categorySection = panel.createDiv({ cls: "music-pro-inline-category-section" });
    categorySection.createEl("div", { cls: "music-pro-inline-label", text: "Personal Playlists" });
    const folders = this.plugin.settings.personalCategories;
    if (folders.length > 0) {
      const chips = categorySection.createDiv({ cls: "music-pro-inline-category-chips music-pro-inline-folder-picker-chips" });
      for (const folder of folders) {
        const isAdded = this.plugin.isItemInPersonalCategory(item, folder.id);
        const chip = chips.createEl("button", {
          cls: `music-pro-chip ${isAdded ? "is-active" : ""}`,
          attr: {
            type: "button",
            "aria-pressed": String(isAdded),
            "aria-label": isAdded ? `Remove from ${folder.label}` : `Add to ${folder.label}`,
            "aria-label-position": "top"
          }
        });
        setIcon(chip.createSpan({ cls: "music-pro-chip-icon" }), isAdded ? "folder-check" : "folder");
        chip.createSpan({ cls: "music-pro-chip-label", text: folder.label });
        chip.addEventListener("click", () => this.toggleInlineFolderAssignment(item, folder.id));
      }
    } else {
      categorySection.createDiv({ cls: "music-pro-inline-hint", text: "Create a Personal Playlist below, then add this playlist to it." });
    }

    const folderRow = panel.createDiv({ cls: "music-pro-inline-folder-row" });
    folderRow.createEl("div", { cls: "music-pro-inline-label", text: "New Personal Playlist" });
    const folderInput = folderRow.createEl("input", {
      cls: "music-pro-inline-folder-input music-pro-inline-folder-picker-input",
      attr: {
        placeholder: "Playlist Name",
        value: this.folderPickerNewName
      }
    }) as HTMLInputElement;
    folderInput.addEventListener("input", () => (this.folderPickerNewName = folderInput.value));
    folderInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.createInlineFolderForItem(item);
      }
    });
    const createFolder = folderRow.createEl("button", { cls: "music-pro-text-button", text: this.isFolderPickerSaving ? "Creating…" : "Create & Add" });
    createFolder.disabled = this.isFolderPickerSaving;
    createFolder.addEventListener("click", () => this.createInlineFolderForItem(item));

    const actions = panel.createDiv({ cls: "music-pro-inline-add-actions" });
    const done = actions.createEl("button", { cls: "music-pro-text-button music-pro-inline-submit", text: "Done" });
    done.addEventListener("click", () => this.closeInlineFolderPicker());
  }

  private async toggleInlineFolderAssignment(item: CatalogItem, folderId: string): Promise<void> {
    try {
      if (this.plugin.isItemInPersonalCategory(item, folderId)) {
        await this.plugin.removeItemFromPersonalCategory(item, folderId);
      } else {
        await this.plugin.addItemToPersonalCategory(item, folderId);
      }
    } catch (error) {
      this.logSidebarActionError(error);
    }
  }

  private async createInlineFolderForItem(item: CatalogItem): Promise<void> {
    if (this.isFolderPickerSaving) return;
    this.isFolderPickerSaving = true;
    try {
      const folder = await this.plugin.createPersonalCategory(this.folderPickerNewName);
      this.folderPickerNewName = "";
      await this.plugin.addItemToPersonalCategory(item, folder.id);
    } catch (error) {
      this.logSidebarActionError(error);
    } finally {
      this.isFolderPickerSaving = false;
      if (this.folderPickerItemId) this.render();
    }
  }

  private parseAddCategories(value: string): string[] {
    const categories = value.split(",").map((category) => category.trim()).filter(Boolean);
    const personalKeys = new Map(this.plugin.settings.personalCategories.map((category) => [normalizePlaylistText(category.label), category.label]));
    const out: string[] = [];
    for (const category of categories) {
      const personal = personalKeys.get(normalizePlaylistText(category));
      if (personal && !out.some((value) => normalizePlaylistText(value) === normalizePlaylistText(personal))) out.push(personal);
    }
    return out;
  }

  private toggleInlineAddCategory(label: string): void {
    const key = normalizePlaylistText(label);
    const exists = this.addSelectedCategories.some((value) => normalizePlaylistText(value) === key);
    this.addSelectedCategories = exists
      ? this.addSelectedCategories.filter((value) => normalizePlaylistText(value) !== key)
      : [...this.addSelectedCategories, label];
    this.render();
  }

  private getPersonalAddCategoryDefinitions() {
    const personalIds = new Set(this.plugin.settings.personalCategories.map((category) => category.id));
    return this.plugin.getPlaylistCategoryDefinitions().filter((category) => personalIds.has(category.id));
  }

  private canSubmitInlineAdd(): boolean {
    try {
      assertEmbeddableSoundCloudUrl(this.addUrl);
      return true;
    } catch {
      return false;
    }
  }

  private getInlineAddPreview(): string {
    if (!this.addUrl.trim()) return "";
    try {
      const normalized = assertEmbeddableSoundCloudUrl(this.addUrl);
      const parts = new URL(normalized).pathname.split("/").filter(Boolean);
      const type = normalized.includes("on.soundcloud.com")
        ? "Short link"
        : parts.includes("sets")
          ? "Playlist"
          : parts.includes("albums")
            ? "Album"
            : parts.length <= 1
              ? "Profile"
              : "Track";
      return `${type} detected`;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid URL";
    }
  }

  private async createInlineFolder(): Promise<void> {
    try {
      const category = await this.plugin.createPersonalCategory(this.addNewCategoryName);
      this.addNewCategoryName = "";
      this.addSelectedCategories = [
        ...this.addSelectedCategories.filter((value) => normalizePlaylistText(value) !== normalizePlaylistText(category.label)),
        category.label
      ];
      this.plugin.settings.lastAddCategory = this.addSelectedCategories.join(", ");
      await this.plugin.saveSettings();
      this.render();
    } catch (error) {
      this.logSidebarActionError(error);
    }
  }

  private async submitInlineAdd(): Promise<void> {
    if (this.isAddSaving || !this.canSubmitInlineAdd()) return;
    this.isAddSaving = true;
    this.render();
    try {
      const categories = this.addSelectedCategories;
      const result = await this.plugin.addUserSoundCloudUrl(this.addUrl, ["User"]);
      const item = result.item;
      await this.applySelectedPersonalFolders(item);

      this.plugin.settings.lastAddCategory = categories.join(", ");
      this.plugin.settings.lastSelectedCategory = this.getBestCategoryIdForItem(item, categories);
      await this.plugin.saveSettings();

      this.category = this.plugin.settings.lastSelectedCategory;
      this.query = getDisplayTitle(item);
      this.visibleItemLimit = this.visibleItemStep;
      this.isAddMode = false;
      this.isAddSaving = false;
      this.addUrl = "";
      this.addNewCategoryName = "";
      this.addSelectedCategories = this.parseAddCategories(this.plugin.settings.lastAddCategory || "");

      this.pendingScrollSnapshot = this.captureScrollSnapshot();
      await this.plugin.playItem(item);
    } catch (error) {
      this.isAddSaving = false;
      this.logSidebarActionError(error);
      this.render();
    }
  }

  private async applySelectedPersonalFolders(item: CatalogItem): Promise<void> {
    const selectedKeys = new Set(this.addSelectedCategories.map(normalizePlaylistText));
    for (const category of this.plugin.settings.personalCategories) {
      if (!selectedKeys.has(normalizePlaylistText(category.label))) continue;
      await this.plugin.addItemToPersonalCategory(item, category.id);
    }
  }

  private getBestCategoryIdForItem(item: CatalogItem, preferredLabels: string[]): string {
    const preferred = this.getCategoryIdFromLabels(preferredLabels);
    if (preferred) return preferred;
    const itemCategory = this.getCategoryIdFromLabels(item.categories);
    if (itemCategory) return itemCategory;
    const ids = getPlaylistCategoryIds(item);
    return ids[0] || DEFAULT_PLAYLIST_CATEGORY_ID;
  }

  private getCategoryIdFromLabels(labels: string[]): string | null {
    const labelKeys = new Set(labels.map(normalizePlaylistText));
    for (const category of this.plugin.getPlaylistCategoryDefinitions()) {
      if (category.id === RECENT_PLAYLIST_CATEGORY_ID || category.id === DEFAULT_PLAYLIST_CATEGORY_ID || category.id === COMMUNITY_PLAYLIST_CATEGORY_ID) continue;
      if (labelKeys.has(normalizePlaylistText(category.label))) return category.id;
    }
    return labelKeys.has("user")
      ? (this.plugin.isPlaylistCategoryEnabled(DEFAULT_PLAYLIST_CATEGORY_ID) ? DEFAULT_PLAYLIST_CATEGORY_ID : this.plugin.getFallbackPlaylistCategoryId())
      : null;
  }

  private renderCatalog(container: HTMLElement): void {
    this.renderCatalogIntro(container);

    if (this.category === RECENT_PLAYLIST_CATEGORY_ID && !this.query.trim()) {
      this.renderRecentlyPlayedContent(container);
      return;
    }

    const section = container.createDiv({ cls: "music-pro-list-section" });
    const list = section.createDiv({ cls: "music-pro-list", attr: { "data-music-pro-list": "true" } });
    this.populateList(list);
  }

  private renderCatalogOnly(): void {
    const results = this.contentEl.querySelector<HTMLElement>('[data-music-pro-results="true"]');
    if (!results) {
      this.render();
      return;
    }
    this.disconnectImageObserver();
    results.empty();
    this.renderCatalog(results);
  }

  private renderCatalogIntro(container: HTMLElement): void {
    const q = this.query.trim();
    const definition = this.getCategoryDefinition(this.category);
    if (q || this.category === RECENT_PLAYLIST_CATEGORY_ID || this.plugin.isPersonalCategory(this.category) || !definition.description.trim()) return;

    const intro = container.createDiv({ cls: "music-pro-playlist-category-intro" });
    const title = intro.createDiv({ cls: "music-pro-playlist-category-title" });
    setIcon(title.createSpan(), definition.icon);
    title.createSpan({ text: definition.label });
    intro.createEl("div", {
      cls: "music-pro-playlist-category-desc",
      text: definition.description
    });
  }

  private populateList(list: HTMLElement): void {
    if (this.query.trim()) {
      this.populateSearchResults(list);
      return;
    }

    const items = this.getVisibleCatalogItems();
    if (items.length === 0) {
      this.renderEmptyState(list, this.category === DEFAULT_PLAYLIST_CATEGORY_ID
        ? "No editor picks yet. Add links manually when you want them here."
        : "Try another playlist or broader search.");
      return;
    }
    const visibleItems = items.slice(0, this.visibleItemLimit);
    const staging = document.createElement("div");
    for (const [index, item] of visibleItems.entries()) this.renderItem(staging, item, index);
    const fragment = document.createDocumentFragment();
    while (staging.firstChild) fragment.appendChild(staging.firstChild);
    list.appendChild(fragment);
    if (visibleItems.length < items.length) this.renderShowMore(list);
  }

  private populateSearchResults(list: HTMLElement): void {
    const groups = this.getSearchResultGroups();
    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    if (total === 0) {
      this.renderEmptyState(list, "Search all playlists with another keyword.");
      return;
    }

    let shown = 0;
    let itemIndex = 0;
    for (const group of groups) {
      if (shown >= this.visibleItemLimit) break;
      const remaining = this.visibleItemLimit - shown;
      const visibleItems = group.items.slice(0, remaining);
      if (visibleItems.length === 0) continue;

      const groupEl = list.createDiv({ cls: `music-pro-search-group ${group.isCurrent ? "is-current" : ""}` });
      const head = groupEl.createDiv({ cls: "music-pro-search-group-head" });
      const title = head.createDiv({ cls: "music-pro-search-group-title" });
      title.createSpan({ text: group.label });
      if (group.isCurrent) title.createSpan({ cls: "music-pro-search-current-badge", text: "Current" });
      head.createSpan({ cls: "music-pro-search-group-count", text: `${group.items.length}` });

      const groupList = groupEl.createDiv({ cls: "music-pro-search-group-list" });
      const staging = document.createElement("div");
      for (const item of visibleItems) this.renderItem(staging, item, itemIndex++);
      const fragment = document.createDocumentFragment();
      while (staging.firstChild) fragment.appendChild(staging.firstChild);
      groupList.appendChild(fragment);
      shown += visibleItems.length;
    }

    if (shown < total) this.renderShowMore(list);
  }

  private renderEmptyState(list: HTMLElement, message: string): void {
    const empty = list.createDiv({ cls: "music-pro-empty" });
    setIcon(empty.createDiv({ cls: "music-pro-empty-icon" }), "search-x");
    empty.createEl("div", { cls: "music-pro-empty-title", text: "No Playlist Found." });
    empty.createEl("div", { cls: "music-pro-empty-text", text: message });
  }

  private renderShowMore(list: HTMLElement): void {
    const more = list.createDiv({ cls: "music-pro-show-more-row" });
    const button = more.createEl("button", {
      cls: "music-pro-text-button music-pro-show-more",
      text: "Show More"
    });
    button.addEventListener("click", () => {
      this.visibleItemLimit += this.visibleItemStep;
      this.renderCatalogOnly();
    });
  }

  private renderItem(list: HTMLElement, item: CatalogItem, index = 0): void {
    const state = this.plugin.store.getState();
    const isCurrent = state.currentItem?.id === item.id;
    const displayTitle = getDisplayTitle(item);
    const canReorderFolderItem = this.canReorderPersonalFolderItems();
    const isEditorChoiceListItem = this.category === DEFAULT_PLAYLIST_CATEGORY_ID && !this.query.trim();
    const row = list.createDiv({
      cls: `music-pro-item ${isCurrent ? "is-current" : ""} ${canReorderFolderItem ? "is-folder-reorderable" : ""} ${isEditorChoiceListItem ? "is-editor-choice" : ""}`,
      attr: { role: "button", tabindex: "0", "data-music-pro-item-id": item.id }
    });
    this.suppressMouseFocus(row);
    const playItem = () => {
      this.rememberPlaylistItemScrollAnchor(row, item.id);
      if (isCurrent) this.plugin.playPause();
      else this.plugin.playItem(item);
    };
    row.addEventListener("click", playItem);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        playItem();
      }
    });
    if (canReorderFolderItem) this.renderPersonalFolderItemDragHandle(row, item);
    const art = row.createDiv({ cls: "music-pro-item-art" });
    this.renderArtwork(art, item.artworkUrl, displayTitle, "music", index < 8, item);

    const body = row.createDiv({ cls: "music-pro-item-body" });
    body.createEl("div", { cls: "music-pro-item-title", text: displayTitle, attr: { "data-music-pro-full-name": item.title || displayTitle } });
    body.createEl("div", { cls: "music-pro-item-subtitle", text: getDisplaySubtitle(item) || item.artist });

    const actions = row.createDiv({ cls: "music-pro-item-actions" });
    this.renderAddToFolderButton(actions, item);
    const open = actions.createEl("button", { cls: "music-pro-icon-button", attr: { "aria-label": "Open in SoundCloud", "aria-label-position": "top" } });
    setIcon(open, "external-link");
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      window.open(item.url, "_blank");
    });

    if (item.source === "user" && !this.plugin.isPersonalCategory(this.category)) {
      const remove = actions.createEl("button", { cls: "music-pro-icon-button", attr: { "aria-label": "Remove personal link", "aria-label-position": "top" } });
      setIcon(remove, "trash-2");
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.plugin.removeUserItem(item.id);
      });
    }

    if (isEditorChoiceListItem) this.renderRecentPlaylistContext(row, item, 2);
  }

  private canReorderPersonalFolderItems(): boolean {
    return !this.query.trim() && this.plugin.isPersonalCategory(this.category);
  }

  private renderPersonalFolderItemDragHandle(row: HTMLElement, item: CatalogItem): void {
    const itemKey = this.plugin.getItemOrderKey(item);
    const handle = row.createSpan({
      cls: "music-pro-folder-item-drag-handle",
      attr: {
        role: "button",
        tabindex: "0",
        draggable: "true",
        "data-music-pro-folder-item-key": itemKey,
        "aria-label": "Drag To Reorder. Use Up Or Down Arrows To Move."
      }
    });
    handle.draggable = true;
    setIcon(handle, "grip-vertical");
    const clearDragVisual = () => {
      row.removeClass("is-folder-dragging");
      handle.removeClass("is-dragging");
    };
    const clearDragVisualOnPointerEnd = () => {
      const clearOnce = () => {
        window.removeEventListener("pointerup", clearOnce);
        window.removeEventListener("pointercancel", clearOnce);
        clearDragVisual();
      };
      window.addEventListener("pointerup", clearOnce);
      window.addEventListener("pointercancel", clearOnce);
    };
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      row.addClass("is-folder-dragging");
      handle.addClass("is-dragging");
      clearDragVisualOnPointerEnd();
    });
    handle.addEventListener("pointerup", clearDragVisual);
    handle.addEventListener("pointercancel", clearDragVisual);
    handle.addEventListener("keydown", async (event) => {
      event.stopPropagation();
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      await this.movePersonalFolderItemWithKeyboard(item, event.key === "ArrowUp" ? -1 : 1);
    });
    handle.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      row.addClass("is-folder-dragging");
      handle.addClass("is-dragging");
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/music-pro-personal-folder-item-key", itemKey);
      event.dataTransfer.setData("text/plain", itemKey);
      event.dataTransfer.setDragImage(row, 18, Math.max(12, row.offsetHeight / 2));
    });
    handle.addEventListener("dragend", () => {
      clearDragVisual();
      this.clearPersonalFolderDropState();
    });

    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const placement = this.getPersonalFolderDropPlacement(row, event);
      row.toggleClass("is-folder-drop-before", placement === "before");
      row.toggleClass("is-folder-drop-after", placement === "after");
    });
    row.addEventListener("dragleave", () => {
      row.removeClass("is-folder-drop-before");
      row.removeClass("is-folder-drop-after");
    });
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceKey = event.dataTransfer?.getData("text/music-pro-personal-folder-item-key") || "";
      const placement = this.getPersonalFolderDropPlacement(row, event);
      this.clearPersonalFolderDropState();
      if (!sourceKey || sourceKey === itemKey) return;
      await this.plugin.reorderPersonalFolderItem(this.category, sourceKey, itemKey, placement);
    });
  }

  private async movePersonalFolderItemWithKeyboard(item: CatalogItem, direction: -1 | 1): Promise<void> {
    if (!this.canReorderPersonalFolderItems()) return;
    const sourceKey = this.plugin.getItemOrderKey(item);
    const visibleKeys = this.getVisibleCatalogItems().map((visibleItem) => this.plugin.getItemOrderKey(visibleItem));
    const sourceIndex = visibleKeys.indexOf(sourceKey);
    if (sourceIndex === -1) return;
    const targetKey = visibleKeys[sourceIndex + direction];
    if (!targetKey) return;
    await this.plugin.reorderPersonalFolderItem(
      this.category,
      sourceKey,
      targetKey,
      direction < 0 ? "before" : "after"
    );
    window.setTimeout(() => {
      const handles = this.contentEl.querySelectorAll<HTMLElement>(".music-pro-folder-item-drag-handle");
      for (const candidate of handles) {
        if (candidate.getAttribute("data-music-pro-folder-item-key") !== sourceKey) continue;
        candidate.focus();
        break;
      }
    }, 40);
  }

  private getPersonalFolderDropPlacement(row: HTMLElement, event: DragEvent): "before" | "after" {
    const rect = row.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
  }

  private clearPersonalFolderDropState(): void {
    for (const row of this.contentEl.querySelectorAll<HTMLElement>(".music-pro-item.is-folder-reorderable")) {
      row.removeClass("is-folder-dragging");
      row.removeClass("is-folder-drop-before");
      row.removeClass("is-folder-drop-after");
    }
  }

  private renderAddToFolderButton(container: HTMLElement, item: CatalogItem): void {
    const assignedIds = this.plugin.getItemPersonalCategoryIds(item);
    const assignedCount = assignedIds.length;
    const currentFolderId = assignedIds.includes(this.category) ? this.category : "";
    const removeFolderId = currentFolderId || (assignedCount === 1 ? assignedIds[0] : "");
    const removeFolderLabel = removeFolderId ? this.getCategoryDefinition(removeFolderId).label : "";
    const button = container.createEl("button", {
      cls: `music-pro-icon-button music-pro-folder-add-button ${assignedCount > 0 ? "is-active" : ""}`,
      attr: {
        "aria-label": removeFolderId
          ? `Remove from ${removeFolderLabel}`
          : assignedCount > 0
            ? "Manage personal playlists"
            : "Add to personal playlist",
        "aria-label-position": "top"
      }
    });
    setIcon(button, removeFolderId ? "folder-minus" : assignedCount > 0 ? "folder-check" : "folder-plus");
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (removeFolderId) {
        try {
          const removed = await this.plugin.removeItemFromPersonalCategory(item, removeFolderId);
          if (removed && item.source === "user" && this.plugin.getItemPersonalCategoryIds(item).length === 0) {
            await this.plugin.removeUserItem(item.id);
          }
        } catch (error) {
          this.logSidebarActionError(error);
        }
        return;
      }
      this.openInlineFolderPicker(item);
    });
  }

  private renderRecentlyPlayedContent(container: HTMLElement): void {
    const state = this.plugin.store.getState();
    const current = state.currentItem;
    const recent = this.plugin.getRecentlyPlayedItems();
    const recentItems = current ? recent.filter((item) => item.id !== current.id) : recent;
    const hasAnyItem = Boolean(current) || recentItems.length > 0;
    const section = container.createDiv({ cls: "music-pro-recent-section" });

    if (current) this.renderCurrentAlbumCard(section, current);

    const header = section.createDiv({ cls: "music-pro-recent-header" });
    const copy = header.createDiv();
    copy.createEl("div", { cls: "music-pro-recent-title", text: "Recently Played" });

    if (recent.length > 0) {
      const clear = header.createEl("button", { cls: "music-pro-text-button music-pro-recent-clear", text: "Clear" });
      clear.addEventListener("click", () => this.plugin.clearRecentlyPlayed());
    }

    if (!hasAnyItem) {
      const empty = section.createDiv({ cls: "music-pro-empty music-pro-recent-empty" });
      setIcon(empty.createDiv({ cls: "music-pro-empty-icon" }), "history");
      empty.createEl("div", { cls: "music-pro-empty-title", text: "No Recent Playlists Yet." });
      empty.createEl("div", { cls: "music-pro-empty-text", text: "Press play on any playlist or album and it will be saved here." });
      return;
    }

    if (recentItems.length > 0) {
      const list = section.createDiv({ cls: "music-pro-recent-list" });
      for (const item of recentItems) this.renderRecentAlbumItem(list, item);
    }
  }

  private renderCurrentAlbumCard(container: HTMLElement, item: CatalogItem): void {
    const state = this.plugin.store.getState();
    const displayTitle = getDisplayTitle(item);
    const card = container.createDiv({
      cls: "music-pro-recent-now",
      attr: { role: "button", tabindex: "0", "data-music-pro-item-id": item.id }
    });
    this.suppressMouseFocus(card);
    const activate = () => this.plugin.playPause();
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
    const art = card.createDiv({ cls: "music-pro-recent-now-art" });
    this.renderArtwork(art, this.plugin.getRecentArtworkUrl(item), displayTitle, "disc-3", true, item);

    const body = card.createDiv({ cls: "music-pro-recent-now-body" });
    const eyebrow = body.createDiv({ cls: "music-pro-recent-now-eyebrow" });
    setIcon(eyebrow.createSpan(), state.isPlaying ? "volume-2" : "disc-3");
    eyebrow.createSpan({ text: state.isPlaying ? "Playing Now" : "Selected Now" });
    body.createEl("div", { cls: "music-pro-recent-now-title", text: displayTitle, attr: { "data-music-pro-full-name": item.title || displayTitle } });
    body.createEl("div", { cls: "music-pro-recent-now-subtitle", text: getDisplaySubtitle(item) || item.artist });

    const actions = card.createDiv({ cls: "music-pro-recent-actions music-pro-recent-now-actions" });
    this.renderAddToFolderButton(actions, item);
    const open = actions.createEl("button", { cls: "music-pro-icon-button", attr: { "aria-label": "Open in SoundCloud", "aria-label-position": "top" } });
    setIcon(open, "external-link");
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      window.open(item.url, "_blank");
    });
    this.renderRecentPlaylistContext(card, item, 3);
  }

  private renderRecentAlbumItem(list: HTMLElement, item: CatalogItem): void {
    const state = this.plugin.store.getState();
    const isCurrent = state.currentItem?.id === item.id;
    const displayTitle = getDisplayTitle(item);
    const row = list.createDiv({
      cls: `music-pro-recent-item ${isCurrent ? "is-current" : ""}`,
      attr: { role: "button", tabindex: "0", "data-music-pro-item-id": item.id }
    });
    this.suppressMouseFocus(row);
    const activate = () => {
      this.rememberPlaylistItemScrollAnchor(row, item.id);
      if (isCurrent) this.plugin.playPause();
      else this.plugin.playItem(item);
    };
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });

    const art = row.createDiv({ cls: "music-pro-recent-art" });
    this.renderArtwork(art, this.plugin.getRecentArtworkUrl(item), displayTitle, "disc-3", true, item);

    const body = row.createDiv({ cls: "music-pro-recent-body" });
    body.createEl("div", { cls: "music-pro-recent-item-title", text: displayTitle, attr: { "data-music-pro-full-name": item.title || displayTitle } });
    body.createEl("div", { cls: "music-pro-recent-item-subtitle", text: getDisplaySubtitle(item) || item.artist });

    const actions = row.createDiv({ cls: "music-pro-recent-actions" });
    if (isCurrent) {
      const badge = actions.createSpan({ cls: "music-pro-recent-playing-badge" });
      setIcon(badge, state.isPlaying ? "volume-2" : "check");
    }
    this.renderAddToFolderButton(actions, item);
    const open = actions.createEl("button", { cls: "music-pro-icon-button", attr: { "aria-label": "Open in SoundCloud", "aria-label-position": "top" } });
    setIcon(open, "external-link");
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      window.open(item.url, "_blank");
    });
    this.renderRecentPlaylistContext(row, item, 2);
  }

  private renderRecentPlaylistContext(container: HTMLElement, item: CatalogItem, maxVisible: number): void {
    const labels = this.getRecentPlaylistLabels(item);
    if (labels.length === 0) return;
    const visible = labels.slice(0, Math.max(1, maxVisible));
    const hiddenCount = Math.max(0, labels.length - visible.length);
    const context = container.createDiv({
      cls: "music-pro-recent-playlist-context",
      attr: { "aria-label": `In playlists: ${labels.join(", ")}` }
    });
    const lead = context.createSpan({ cls: "music-pro-recent-playlist-lead", attr: { "aria-hidden": "true" } });
    setIcon(lead, "list-music");
    for (const label of visible) {
      context.createSpan({ cls: "music-pro-recent-playlist-chip", text: label });
    }
    if (hiddenCount > 0) context.createSpan({ cls: "music-pro-recent-playlist-chip is-more", text: `+${hiddenCount}` });
  }

  private getRecentPlaylistLabels(item: CatalogItem): string[] {
    const labels: string[] = [];
    const seen = new Set<string>();
    const addLabel = (label: string | undefined) => {
      const clean = String(label || "").trim();
      if (!clean) return;
      const key = normalizePlaylistText(clean);
      if (!key || seen.has(key)) return;
      seen.add(key);
      labels.push(clean);
    };

    for (const categoryId of this.plugin.getItemPersonalCategoryIds(item)) {
      const definition = this.getCategoryDefinition(categoryId);
      addLabel(definition.shortLabel || definition.label);
    }

    const baseIds = getPlaylistCategoryIds(item)
      .filter((categoryId) => categoryId !== DEFAULT_PLAYLIST_CATEGORY_ID);
    for (const categoryId of baseIds) {
      if (categoryId === RECENT_PLAYLIST_CATEGORY_ID) continue;
      const definition = this.getCategoryDefinition(categoryId);
      addLabel(definition.shortLabel || definition.label);
    }

    if (labels.length === 0 && isEditorsChoice(item)) {
      const definition = this.getCategoryDefinition(DEFAULT_PLAYLIST_CATEGORY_ID);
      addLabel(definition.shortLabel || definition.label);
    }

    return labels;
  }

  private renderArtwork(container: HTMLElement, artworkUrl: string | undefined, alt: string, fallbackIcon: string, eager = false, placeholderSeed: string | CatalogItem = alt): void {
    if (!this.shouldShowArtwork(artworkUrl)) {
      this.renderArtworkPlaceholder(container, placeholderSeed, fallbackIcon);
      return;
    }

    const img = container.createEl("img", {
      attr: {
        alt,
        loading: eager ? "eager" : "lazy",
        decoding: "async"
      }
    }) as HTMLImageElement;
    img.addEventListener("error", () => {
      img.remove();
      this.renderArtworkPlaceholder(container, placeholderSeed, fallbackIcon);
    });

    if (eager || typeof IntersectionObserver === "undefined") {
      img.src = artworkUrl;
      return;
    }

    img.addClass("music-pro-lazy-artwork");
    img.dataset.src = artworkUrl;
    this.getImageObserver().observe(img);
  }

  private renderArtworkPlaceholder(container: HTMLElement, seed: string | CatalogItem, fallbackIcon: string): void {
    const icon = applyArtworkPlaceholderStyle(container, seed, fallbackIcon);
    setIcon(container, icon);
  }

  private getImageObserver(): IntersectionObserver {
    if (!this.imageObserver) {
      this.imageObserver = new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target as HTMLImageElement;
          const src = img.dataset.src;
          if (src) {
            img.src = src;
            img.removeAttribute("data-src");
          }
          observer.unobserve(img);
        }
      }, { root: null, rootMargin: "240px 0px", threshold: 0.01 });
    }
    return this.imageObserver;
  }

  private disconnectImageObserver(): void {
    this.imageObserver?.disconnect();
    this.imageObserver = null;
  }

  private shouldShowArtwork(url?: string): url is string {
    return Boolean(url && !url.includes("soundcloud.com/images/fb_placeholder"));
  }

  private getPlaylistCategoryOptions(): LibraryFilterOption[] {
    const index = this.getPlaylistIndex();
    return this.plugin.getPlaylistCategoryDefinitions().map((definition) => ({
      value: definition.id,
      label: definition.shortLabel || definition.label,
      count: this.countPlaylistCategory(definition.id, index)
    }));
  }

  private countPlaylistCategory(categoryId: string, index: PlaylistIndex): number {
    if (categoryId === DEFAULT_PLAYLIST_CATEGORY_ID) return index.editorsChoiceItems.length;
    if (categoryId === RECENT_PLAYLIST_CATEGORY_ID) return this.plugin.getRecentlyPlayedItems().length;
    if (categoryId === COMMUNITY_PLAYLIST_CATEGORY_ID) return this.plugin.getCommunityPlaylistItemsFromBuckets(index.byCategory).length;
    return index.counts.get(categoryId) || 0;
  }

  private getSearchResultGroups(): SearchResultGroup[] {
    const index = this.getPlaylistIndex();
    const q = normalizePlaylistText(this.query);
    if (!q) return [];

    const orderedCategoryIds = [
      this.category,
      ...this.plugin.getPlaylistCategoryDefinitions()
        .map((definition) => definition.id)
        .filter((id) => id !== this.category)
    ];
    const seenCategories = new Set<string>();
    const seenItems = new Set<string>();
    const groups: SearchResultGroup[] = [];

    for (const categoryId of orderedCategoryIds) {
      if (seenCategories.has(categoryId)) continue;
      seenCategories.add(categoryId);
      const items = this.getCategoryItems(categoryId, index)
        .filter((item) => !seenItems.has(item.id) && (index.searchTextById.get(item.id) || "").includes(q));
      if (items.length === 0) continue;
      for (const item of items) seenItems.add(item.id);
      groups.push({
        categoryId,
        label: this.getCategoryDefinition(categoryId).label,
        items,
        isCurrent: categoryId === this.category
      });
    }

    return groups;
  }

  private getCategoryItems(categoryId: string, index: PlaylistIndex): CatalogItem[] {
    if (categoryId === DEFAULT_PLAYLIST_CATEGORY_ID) return this.plugin.rankCatalogItemsForCategory(categoryId, index.editorsChoiceItems);
    if (categoryId === RECENT_PLAYLIST_CATEGORY_ID) return this.plugin.getRecentlyPlayedItems();
    if (categoryId === COMMUNITY_PLAYLIST_CATEGORY_ID) return this.plugin.getCommunityPlaylistItemsFromBuckets(index.byCategory);
    const items = index.byCategory.get(categoryId) || [];
    if (this.plugin.isPersonalCategory(categoryId)) return this.plugin.getOrderedPersonalFolderItems(categoryId, items);
    return this.plugin.rankCatalogItemsForCategory(categoryId, items);
  }

  private getVisibleCatalogItems(): CatalogItem[] {
    const index = this.getPlaylistIndex();
    const q = normalizePlaylistText(this.query);
    const items = this.getCategoryItems(this.category, index);
    if (!q) return items;
    return items.filter((item) => {
      return (index.searchTextById.get(item.id) || "").includes(q);
    });
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

  private getCategoryDefinition(categoryId: string) {
    return this.plugin.getPlaylistCategoryDefinitions().find((category) => category.id === categoryId)
      || getPlaylistCategoryDefinition(categoryId);
  }

  private updateProgress(): void {
    const state = this.plugin.store.getState();
    const ratio = state.durationMs > 0 ? Math.min(1, Math.max(0, state.positionMs / state.durationMs)) : 0;
    if (this.progressFill) this.progressFill.style.width = `${ratio * 100}%`;
    const seek = this.seekInput;
    if (seek && document.activeElement !== seek) {
      seek.max = String(Math.max(0, state.durationMs));
      seek.value = String(Math.max(0, state.positionMs));
      seek.title = formatDuration(state.positionMs);
      this.syncRangeVisual(seek, state.positionMs, state.durationMs);
    }
    if (this.leftTimeEl) this.leftTimeEl.setText(formatDuration(state.positionMs));
    if (this.rightTimeEl) this.rightTimeEl.setText(formatDuration(state.durationMs));
    if (this.progressLabel) this.progressLabel.setText(`${formatDuration(state.positionMs)} / ${formatDuration(state.durationMs)}`);
    this.updateVolumeControls(state.volume);
  }

  private updateVolumeControls(volume: number): void {
    const safeVolume = this.clampVolume(volume);
    const volumeChanged = safeVolume !== this.lastRenderedVolume;
    const input = this.volumeInput;
    if (input) {
      if (document.activeElement !== input) {
        if (input.value !== String(safeVolume)) input.value = String(safeVolume);
        if (volumeChanged) this.syncRangeVisual(input, safeVolume, 100);
      }
      input.title = `${safeVolume}%`;
    }
    if (volumeChanged && this.volumeValueEl) this.volumeValueEl.setText(`${safeVolume}%`);
    if (volumeChanged && this.volumeIconEl) this.renderVolumeIcon(this.volumeIconEl, safeVolume);
    this.lastRenderedVolume = safeVolume;
  }

  private renderVolumeIcon(container: HTMLElement, volume: number): void {
    container.empty();
    setIcon(container, this.volumeIconName(volume));
    container.toggleClass("is-muted", this.clampVolume(volume) === 0);
  }

  private volumeIconName(volume: number): string {
    const safeVolume = this.clampVolume(volume);
    if (safeVolume === 0) return "volume-x";
    if (safeVolume < 36) return "volume-1";
    return "volume-2";
  }

  private clampVolume(volume: number): number {
    return Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
  }

  private rangeValueFromPointer(input: HTMLInputElement, event: PointerEvent, max: number): number {
    const rect = input.getBoundingClientRect();
    const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
    if (rect.width <= 0 || safeMax <= 0) return Number(input.value) || 0;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const step = Math.max(1, Number(input.step) || 1);
    return Math.min(safeMax, Math.max(0, Math.round((ratio * safeMax) / step) * step));
  }

  private syncRangeVisual(input: HTMLInputElement, value: number, max: number): void {
    const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
    const safeValue = Number.isFinite(value) ? value : 0;
    const percent = safeMax > 0 ? Math.min(100, Math.max(0, (safeValue / safeMax) * 100)) : 0;
    input.style.setProperty("--music-pro-range-progress", `${percent}%`);
  }
}
