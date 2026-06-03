import { setIcon } from "obsidian";
import type MusicProPlugin from "../main";
import type { CatalogItem } from "../catalog/types";
import { applyArtworkPlaceholderStyle } from "../utils/artworkPlaceholder";
import { formatDuration, getDisplaySubtitle, getDisplayTitle } from "../utils/normalize";

export class MiniDock {
  private plugin: MusicProPlugin;
  private root: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private lastKey = "";
  private progressFill: HTMLElement | null = null;
  private progressLabel: HTMLElement | null = null;
  private seekInput: HTMLInputElement | null = null;
  private leftTimeEl: HTMLElement | null = null;
  private rightTimeEl: HTMLElement | null = null;
  private volumeInput: HTMLInputElement | null = null;
  private volumeIconEl: HTMLElement | null = null;
  private volumeValueEl: HTMLElement | null = null;
  private lastRenderedVolume = -1;
  private proximityOpen = false;
  private trackPickerOpen = false;
  private collapseTimer: number | null = null;
  private readonly proximityXPadding = 56;
  private readonly proximityYPadding = 52;
  private readonly proximityTrailingPadding = 12;
  private readonly proximityCornerWidth = 48;
  private readonly proximityCollapseDelayMs = 30;
  private readonly handlePointerMove = (event: PointerEvent) => this.updateProximityFromPointer(event);
  private readonly handleDocumentPointerDown = (event: PointerEvent) => this.handleOutsidePointerDown(event);
  private readonly forceProximityOpen = () => this.setProximityOpen(true);
  private readonly scheduleProximityClose = () => this.queueProximityClose();

  constructor(plugin: MusicProPlugin) {
    this.plugin = plugin;
    this.root = document.body.createDiv({ cls: "music-pro-mini-dock" });
    document.addEventListener("pointermove", this.handlePointerMove, { passive: true });
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, { capture: true, passive: true });
    this.root.addEventListener("pointerenter", this.forceProximityOpen);
    this.root.addEventListener("focusin", this.forceProximityOpen);
    this.root.addEventListener("pointerleave", this.scheduleProximityClose);
    this.root.addEventListener("focusout", this.scheduleProximityClose);
    this.unsubscribe = plugin.store.subscribe(() => this.refresh());
  }

  destroy(): void {
    this.unsubscribe?.();
    document.removeEventListener("pointermove", this.handlePointerMove);
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, { capture: true });
    if (this.collapseTimer !== null) window.clearTimeout(this.collapseTimer);
    this.root.removeEventListener("pointerenter", this.forceProximityOpen);
    this.root.removeEventListener("focusin", this.forceProximityOpen);
    this.root.removeEventListener("pointerleave", this.scheduleProximityClose);
    this.root.removeEventListener("focusout", this.scheduleProximityClose);
    this.root.remove();
  }

  render(): void {
    const state = this.plugin.store.getState();
    this.lastKey = this.getRenderKey(state);
    this.plugin.applyAccentToElement(this.root);
    const item = state.currentItem || this.plugin.getDefaultItem();
    const displayTitle = state.currentSoundTitle || (item ? getDisplayTitle(item) : "") || "Music Pro";
    const fullTitle = state.currentSoundTitle || item?.title || displayTitle;
    const displayArtist = state.currentSoundArtist || (item ? getDisplaySubtitle(item) || item.artist : "Ready to play");
    const displayArtwork = state.currentSoundArtworkUrl || item?.artworkUrl;
    const autoHideActive = state.mode === "mini" && this.plugin.settings.autoHideMini;
    const canQuickPickTracks = item?.type === "playlist" && state.soundList.length > 0;
    if (state.mode !== "mini" || !canQuickPickTracks) this.trackPickerOpen = false;
    if (this.trackPickerOpen) this.proximityOpen = true;
    if (!autoHideActive) this.proximityOpen = false;

    this.root.empty();
    this.progressFill = null;
    this.progressLabel = null;
    this.seekInput = null;
    this.leftTimeEl = null;
    this.rightTimeEl = null;
    this.volumeInput = null;
    this.volumeIconEl = null;
    this.volumeValueEl = null;
    this.lastRenderedVolume = -1;
    this.root.toggleClass("is-visible", state.mode === "mini");
    this.root.toggleClass("is-playing", state.isPlaying);
    this.root.toggleClass("is-autohide", autoHideActive);
    this.root.toggleClass("is-proximity-open", autoHideActive && this.proximityOpen);
    this.root.toggleClass("is-track-picker-open", this.trackPickerOpen);

    const panel = this.root.createDiv({ cls: "music-pro-mini-panel" });
    const handle = panel.createDiv({ cls: "music-pro-mini-handle", attr: { "aria-hidden": "true" } });
    handle.createSpan();

    const controls = panel.createDiv({ cls: "music-pro-mini-transport" });
    const prev = controls.createEl("button", { cls: "music-pro-icon-button", attr: { "aria-label": "Previous", "aria-label-position": "top" } });
    setIcon(prev, "skip-back");
    prev.addEventListener("click", () => this.plugin.previous());

    const play = controls.createEl("button", { cls: "music-pro-mini-play", attr: { "aria-label": state.isPlaying ? "Pause" : "Play", "aria-label-position": "top" } });
    setIcon(play, state.isPlaying ? "pause" : "play");
    play.addEventListener("click", () => this.plugin.playPause());

    const next = controls.createEl("button", { cls: "music-pro-icon-button", attr: { "aria-label": "Next", "aria-label-position": "top" } });
    setIcon(next, "skip-forward");
    next.addEventListener("click", () => this.plugin.next());

    const loop = controls.createEl("button", {
      cls: `music-pro-icon-button music-pro-loop-toggle ${this.plugin.settings.loopTrackEnabled ? "is-active" : ""}`,
      attr: {
        "aria-label": this.plugin.settings.loopTrackEnabled ? "Turn Track Loop Off" : "Turn Track Loop On",
        "aria-label-position": "top",
        "aria-pressed": String(this.plugin.settings.loopTrackEnabled)
      }
    });
    setIcon(loop, "repeat");
    loop.addEventListener("click", () => this.plugin.toggleLoopTrackMode());

    const actions = controls.createSpan({ cls: "music-pro-mini-actions" });
    const picker = actions.createEl("button", {
      cls: `music-pro-icon-button music-pro-mini-track-picker-toggle ${this.trackPickerOpen ? "is-active" : ""}`,
      attr: {
        "aria-label": canQuickPickTracks ? "Quick Pick Current Playlist Tracks" : "Current playlist tracks unavailable",
        "aria-label-position": "top",
        "aria-pressed": String(this.trackPickerOpen)
      }
    });
    setIcon(picker, "list-music");
    picker.disabled = !canQuickPickTracks;
    picker.addEventListener("click", () => this.toggleTrackPicker());

    const expand = actions.createEl("button", { cls: "music-pro-icon-button music-pro-expand-button", attr: { "aria-label": "Expand sidebar", "aria-label-position": "top" } });
    setIcon(expand, "maximize-2");
    expand.addEventListener("click", () => this.plugin.setMode("sidebar"));

    const meta = panel.createDiv({ cls: "music-pro-mini-meta" });
    const art = meta.createDiv({ cls: "music-pro-mini-art" });
    if (this.shouldShowArtwork(displayArtwork)) {
      const img = art.createEl("img", { attr: { src: displayArtwork, alt: displayTitle, loading: "lazy" } });
      img.addEventListener("error", () => { img.remove(); this.renderArtworkPlaceholder(art, item || displayTitle, "music-2"); });
    } else this.renderArtworkPlaceholder(art, item || displayTitle, "music-2");

    const text = meta.createDiv({ cls: "music-pro-mini-text" });
    text.createEl("div", { cls: "music-pro-mini-title", text: displayTitle, attr: { "data-music-pro-full-name": fullTitle } });
    text.createEl("div", { cls: "music-pro-mini-subtitle", text: `${displayArtist}${state.currentSoundIsPreview ? " · Preview" : ""}${state.currentSoundIsUnavailable ? " · Unavailable" : ""}` });

    const sliders = panel.createDiv({ cls: "music-pro-mini-sliders" });

    const progress = sliders.createDiv({ cls: "music-pro-mini-progress" });
    const leftTime = progress.createSpan({ cls: "music-pro-mini-time music-pro-mini-time-left", text: formatDuration(state.positionMs) });
    const seek = progress.createEl("input", { cls: "music-pro-seek-slider music-pro-mini-seek-slider", type: "range" }) as HTMLInputElement;
    this.leftTimeEl = leftTime;
    this.seekInput = seek;
    seek.min = "0";
    seek.max = String(Math.max(0, state.durationMs));
    seek.step = "1000";
    seek.value = String(Math.max(0, state.positionMs));
    seek.title = formatDuration(state.positionMs);
    this.syncRangeVisual(seek, state.positionMs, state.durationMs);
    const rightTime = progress.createSpan({ cls: "music-pro-mini-time music-pro-mini-time-right", text: formatDuration(state.durationMs) });
    this.rightTimeEl = rightTime;

    const updateSeekPreview = () => {
      const target = Number(seek.value);
      const max = Number(seek.max) || 0;
      this.syncRangeVisual(seek, target, max);
      leftTime.setText(formatDuration(target));
      rightTime.setText(formatDuration(this.plugin.store.getState().durationMs));
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

    const volumeWrap = sliders.createDiv({ cls: "music-pro-mini-volume" });
    const volumeIcon = volumeWrap.createSpan({ cls: "music-pro-mini-volume-icon" });
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
    const volumeValue = volumeWrap.createSpan({ cls: "music-pro-mini-volume-value", text: `${state.volume}%` });
    this.volumeValueEl = volumeValue;
    this.lastRenderedVolume = this.clampVolume(state.volume);
    const updateVolumePreview = (commit = false) => {
      const value = this.clampVolume(Number(volume.value));
      volume.value = String(value);
      this.syncRangeVisual(volume, value, 100);
      volume.title = `${value}%`;
      volumeValue.setText(`${value}%`);
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
    this.progressLabel = null;
    this.updateProgress();

    if (this.trackPickerOpen) this.renderTrackPicker(panel);

    if (state.error) {
      panel.createDiv({ cls: "music-pro-mini-error", text: state.error });
    }
  }


  refresh(): void {
    const key = this.getRenderKey();
    if (key !== this.lastKey) this.render();
    else this.updateProgress();
  }

  private getRenderKey(state = this.plugin.store.getState()): string {
    return `${state.mode}|${state.currentItem?.id || ""}|${state.currentSoundIndex}|${state.currentSoundTitle}|${state.currentSoundIsPreview}|${state.currentSoundIsUnavailable}|${state.soundListVersion}|${state.playlistReady}|${state.isPlaying}|${state.isLoading}|${state.error || ""}|${this.plugin.settings.autoHideMini}|${this.plugin.settings.loopTrackEnabled}`;
  }

  private toggleTrackPicker(): void {
    const state = this.plugin.store.getState();
    const item = state.currentItem || this.plugin.getDefaultItem();
    if (item?.type !== "playlist" || state.soundList.length === 0) return;
    this.trackPickerOpen = !this.trackPickerOpen;
    if (this.trackPickerOpen) this.setProximityOpen(true);
    this.render();
  }

  private renderTrackPicker(panel: HTMLElement): void {
    const state = this.plugin.store.getState();
    const sounds = this.plugin.getOrderedSounds();
    const picker = panel.createDiv({ cls: "music-pro-mini-track-picker", attr: { "aria-label": "Playlist tracks" } });
    const list = picker.createDiv({ cls: "music-pro-mini-track-picker-list" });
    if (sounds.length === 0) {
      list.createDiv({ cls: "music-pro-mini-track-picker-empty", text: "No playlist tracks loaded yet." });
      return;
    }

    sounds.forEach((sound, index) => {
      const title = sound.title || `Track ${index + 1}`;
      const isActive = sound.originalIndex === state.currentSoundIndex;
      const isUnavailable = sound.isPlayable === false;
      const row = list.createEl("button", {
        cls: `music-pro-mini-track-row ${isActive ? "is-active" : ""} ${isUnavailable ? "is-unavailable" : ""}`,
        attr: {
          "aria-label": isUnavailable ? `${title} is unavailable` : `Play ${title}`,
          "aria-current": isActive ? "true" : "false"
        }
      });
      row.disabled = isUnavailable;
      row.createSpan({ cls: "music-pro-mini-track-number", text: String(index + 1).padStart(2, "0") });
      const body = row.createSpan({ cls: "music-pro-mini-track-body" });
      body.createSpan({ cls: "music-pro-mini-track-title", text: title });
      body.createSpan({ cls: "music-pro-mini-track-artist", text: sound.artist || "SoundCloud" });
      row.createSpan({
        cls: "music-pro-mini-track-duration",
        text: isUnavailable
          ? "Unavailable"
          : sound.durationMs > 0
            ? formatDuration(sound.durationMs)
            : "—"
      });
      row.addEventListener("click", () => {
        if (isUnavailable) return;
        this.trackPickerOpen = false;
        this.plugin.skipToPlaylistTrack(sound.originalIndex);
        this.render();
      });
    });
  }

  private handleOutsidePointerDown(event: PointerEvent): void {
    if (!this.trackPickerOpen) return;
    const target = event.target;
    if (target instanceof Node && this.root.contains(target)) return;
    this.trackPickerOpen = false;
    this.render();
  }

  private isAutoHideActive(): boolean {
    const state = this.plugin.store.getState();
    return state.mode === "mini" && this.plugin.settings.autoHideMini;
  }

  private setProximityOpen(open: boolean): void {
    if (this.collapseTimer !== null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    const shouldOpen = open && this.isAutoHideActive();
    if (this.proximityOpen === shouldOpen) {
      this.root.toggleClass("is-proximity-open", shouldOpen);
      return;
    }
    this.proximityOpen = shouldOpen;
    this.root.toggleClass("is-proximity-open", shouldOpen);
  }

  private queueProximityClose(): void {
    if (!this.isAutoHideActive()) {
      this.setProximityOpen(false);
      return;
    }
    if (this.trackPickerOpen) return;
    if (this.root.matches(":hover") || this.root.matches(":focus-within")) return;
    if (this.collapseTimer !== null) window.clearTimeout(this.collapseTimer);
    this.collapseTimer = window.setTimeout(() => {
      this.collapseTimer = null;
      if (!this.root.matches(":hover") && !this.root.matches(":focus-within")) this.setProximityOpen(false);
    }, this.proximityCollapseDelayMs);
  }

  private updateProximityFromPointer(event: PointerEvent): void {
    if (!this.isAutoHideActive()) {
      this.setProximityOpen(false);
      return;
    }

    if (this.trackPickerOpen) {
      this.setProximityOpen(true);
      return;
    }

    if (this.root.matches(":hover") || this.root.matches(":focus-within")) {
      this.setProximityOpen(true);
      return;
    }

    if (this.proximityOpen) {
      this.queueProximityClose();
      return;
    }

    const rect = this.root.getBoundingClientRect();
    const xPadding = this.proximityXPadding;
    const yPadding = this.proximityYPadding;
    const nearDock =
      event.clientX >= rect.left - xPadding &&
      event.clientX <= Math.min(window.innerWidth, rect.right + this.proximityTrailingPadding) &&
      event.clientY >= rect.top - yPadding &&
      event.clientY <= rect.bottom + yPadding;
    const nearCorner =
      event.clientX >= window.innerWidth - this.proximityCornerWidth &&
      event.clientY >= Math.max(0, rect.top - yPadding) &&
      event.clientY <= rect.bottom + yPadding;

    if (nearDock || nearCorner) {
      this.setProximityOpen(true);
      this.queueProximityClose();
    } else this.queueProximityClose();
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
    if (this.progressLabel) this.progressLabel.setText(`${formatDuration(state.positionMs)} / ${formatDuration(state.durationMs)}`);
    if (this.leftTimeEl) this.leftTimeEl.setText(formatDuration(state.positionMs));
    if (this.rightTimeEl) this.rightTimeEl.setText(formatDuration(state.durationMs));
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
    if (volumeChanged && this.volumeIconEl) this.renderVolumeIcon(this.volumeIconEl, safeVolume);
    if (volumeChanged && this.volumeValueEl) this.volumeValueEl.setText(`${safeVolume}%`);
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

  private shouldShowArtwork(url?: string): url is string {
    return Boolean(url && !url.includes("soundcloud.com/images/fb_placeholder"));
  }

  private renderArtworkPlaceholder(container: HTMLElement, seed: string | CatalogItem, fallbackIcon: string): void {
    const icon = applyArtworkPlaceholderStyle(container, seed, fallbackIcon);
    setIcon(container, icon);
  }

  private syncRangeVisual(input: HTMLInputElement, value: number, max: number): void {
    const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
    const safeValue = Number.isFinite(value) ? value : 0;
    const percent = safeMax > 0 ? Math.min(100, Math.max(0, (safeValue / safeMax) * 100)) : 0;
    input.style.setProperty("--music-pro-range-progress", `${percent}%`);
  }
}
