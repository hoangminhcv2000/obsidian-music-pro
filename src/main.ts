import { Notice, Platform, Plugin, WorkspaceLeaf } from "obsidian";
import { CatalogService, type AddUserSoundCloudResult } from "./catalog/CatalogService";
import { buildPlaylistIndex } from "./catalog/PlaylistIndex";
import {
  ALL_PLAYLIST_CATEGORIES,
  COMMUNITY_PLAYLIST_CATEGORY_ID,
  DEFAULT_PLAYLIST_CATEGORY_ID,
  PLAYLIST_CATEGORIES,
  RECENT_PLAYLIST_CATEGORY_ID,
  comparePlaylistItemsForCategory,
  getPlaylistCategoryIds,
  getPlaylistCurationScore,
  itemMatchesPlaylistCategory,
  normalizePlaylistText,
  type PlaylistCategoryDefinition
} from "./catalog/playlistCategories";
import type { CatalogItem } from "./catalog/types";
import { ExternalAudioMonitor } from "./integrations/ExternalAudioMonitor";
import { PlayerStore } from "./player/PlayerStore";
import { SoundCloudPlayer } from "./player/SoundCloudPlayer";
import type { PlaybackResumeTarget, PlaybackState, PlayerMode, SoundCloudSound } from "./player/types";
import { DEFAULT_ACCENT_COLOR, DEFAULT_PLAYLIST_CATEGORY_ORDER, DEFAULT_SETTINGS, LEGACY_PLAYLIST_CATEGORY_ORDER, type MusicProBehaviorStats, type MusicProSettings, type PersonalPlaylistCategory } from "./settings";
import { MiniDock } from "./ui/MiniDock";
import { QuickPickerModal } from "./ui/QuickPickerModal";
import { MusicProSettingsTab } from "./ui/SettingsTab";
import { MUSIC_PRO_VIEW_TYPE, MusicProSidebarView } from "./ui/SidebarView";
import { assertEmbeddableSoundCloudUrl, inferSoundCloudType, makeDisplayTitle, normalizeSoundCloudArtworkUrl, normalizeSoundCloudUrl, today } from "./utils/normalize";

interface PlayItemOptions {
  resume?: boolean | PlaybackResumeTarget;
}

interface PlaybackBehaviorSession {
  itemId: string;
  soundIndex: number;
  startedAt: number;
  lastPositionMs: number;
  maxPositionMs: number;
  listenMs: number;
  playCounted: boolean;
}

const RAINBOW_ACCENT_COLORS = ["#2f7cf6", "#5e5ce6", "#bf5af2", "#ff4f9a", "#ff6b4a", "#ff9f0a", "#32d74b", "#30b0c7"] as const;
const RAINBOW_ACCENT_STEP_MS = 12_000;
const RAINBOW_ACCENT_TICK_MS = 280;
const BEHAVIOR_RANKING_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const COMMUNITY_TOP_PER_CATEGORY = 3;
const RESTRICTED_TRACK_BURST_WINDOW_MS = 45_000;
const RESTRICTED_TRACK_BURST_LIMIT = 3;

export default class MusicProPlugin extends Plugin {
  settings!: MusicProSettings;
  store!: PlayerStore;
  player!: SoundCloudPlayer;
  catalog!: CatalogService;
  private miniDock: MiniDock | null = null;
  private externalAudioMonitor: ExternalAudioMonitor | null = null;
  private externalAudioResumeTimer: number | null = null;
  private volumeFadeTimer: number | null = null;
  private userVolumeSaveTimer: number | null = null;
  private playbackSessionSaveTimer: number | null = null;
  private behaviorSaveTimer: number | null = null;
  private settingsSaveTimer: number | null = null;
  private behaviorSession: PlaybackBehaviorSession | null = null;
  private fullNameTooltipEl: HTMLElement | null = null;
  private fullNameTooltipTarget: HTMLElement | null = null;
  private fullNameTooltipRaf: number | null = null;
  private fullNameTooltipHideTimer: number | null = null;
  private catalogItemsByIdCache: { sourceItems: CatalogItem[]; itemsById: Map<string, CatalogItem> } | null = null;
  private personalAssignmentFingerprintCache: {
    categories: PersonalPlaylistCategory[];
    assignments: Record<string, string[]>;
    fingerprint: string;
  } | null = null;
  private personalCategoryIdSetCache: { categories: PersonalPlaylistCategory[]; ids: Set<string> } | null = null;
  private rankedItemsCache = new Map<string, {
    sourceItems: CatalogItem[];
    behaviorScores: Record<string, number>;
    behaviorUpdatedAt: string;
    items: CatalogItem[];
  }>();
  private communityItemsCache: {
    source: CatalogItem[] | Map<string, CatalogItem[]>;
    enabledKey: string;
    behaviorScores: Record<string, number>;
    behaviorUpdatedAt: string;
    items: CatalogItem[];
  } | null = null;
  private orderedSoundsCache: {
    itemId: string;
    sounds: SoundCloudSound[];
    orderSignature: string;
    ordered: SoundCloudSound[];
  } | null = null;
  private restrictedTrackBurst: { itemId: string; startedAt: number; count: number } | null = null;
  private onAccentColorCache = new Map<string, "#ffffff" | "#08111f">();
  private rainbowAccentFrame: number | null = null;
  private rainbowAccentLastTick = 0;
  private rainbowAccentLastColor = "";
  private assignedItemsCache: { sourceItems: CatalogItem[]; fingerprint: string; items: CatalogItem[] } | null = null;
  private enabledItemsCache: { sourceItems: CatalogItem[]; fingerprint: string; items: CatalogItem[] } | null = null;
  private externalAudioPaused = false;
  private externalAudioBaseVolume = 40;
  private finishHandler = (event: Event) => this.handleTrackFinish(event as CustomEvent);
  private readonly fullNamePointerOverHandler = (event: PointerEvent) => this.handleFullNamePointerOver(event);
  private readonly fullNamePointerOutHandler = (event: PointerEvent) => this.handleFullNamePointerOut(event);
  private readonly fullNameFocusInHandler = (event: FocusEvent) => this.handleFullNameFocusIn(event);
  private readonly fullNameFocusOutHandler = () => this.scheduleHideFullNameTooltip();
  private readonly fullNameLayoutHandler = () => this.scheduleFullNameTooltipPosition();
  private readonly fullNameKeydownHandler = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.hideFullNameTooltip();
  };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MusicProSettingsTab(this.app, this));

    if (this.isMobileModeBlocked()) {
      console.info("Music Pro: mobile mode is disabled in settings.");
      return;
    }

    this.store = new PlayerStore({ mode: this.settings.viewMode, volume: this.settings.volume });
    this.player = new SoundCloudPlayer(this.store);
    this.catalog = new CatalogService(this.settings, () => this.saveSettings());

    this.registerView(MUSIC_PRO_VIEW_TYPE, (leaf: WorkspaceLeaf) => new MusicProSidebarView(leaf, this));

    const ribbonIcon = this.addRibbonIcon("music-2", "Music Pro", () => this.toggleMode());
    ribbonIcon.addClass("music-pro-ribbon-action");
    this.addCommand({ id: "open", name: "Open", callback: () => this.setMode("sidebar") });
    this.addCommand({ id: "shutdown", name: "Shutdown", callback: () => this.shutdown() });
    this.addCommand({ id: "play-pause", name: "Play/Pause", callback: () => this.playPause() });
    this.addCommand({ id: "next-track", name: "Next Track", callback: () => this.next() });
    this.addCommand({ id: "previous-track", name: "Previous Track", callback: () => this.previous() });
    this.addCommand({ id: "compact-fullsize", name: "Compact/Fullsize", callback: () => this.toggleMode() });
    this.addCommand({ id: "volume-0", name: "Volume 0%", callback: () => this.setUserVolume(0, true) });
    this.addCommand({ id: "volume-30", name: "Volume 30%", callback: () => this.setUserVolume(30, true) });
    this.addCommand({ id: "volume-60", name: "Volume 60%", callback: () => this.setUserVolume(60, true) });
    this.addCommand({ id: "volume-90", name: "Volume 90%", callback: () => this.setUserVolume(90, true) });

    this.miniDock = new MiniDock(this);
    this.configureExternalAudioMonitor();
    this.configureRainbowAccent();
    this.registerFullNameTooltip();

    this.register(this.store.subscribe((state) => {
      this.rememberPlaybackSession(state);
      this.observePlaybackBehavior(state);
    }));
    document.addEventListener("music-pro:finish", this.finishHandler);
    this.register(() => document.removeEventListener("music-pro:finish", this.finishHandler));

    this.app.workspace.onLayoutReady(() => this.startMusicProUi());
  }

  private startMusicProUi(): void {
    const firstRun = !this.settings.firstRunComplete;
    const shouldAutoplay = this.settings.autoplayOnStartup;
    this.refreshBehaviorRankingIfStale();
    this.selectInitialItem({ preload: !shouldAutoplay });
    this.renderChrome();

    if (shouldAutoplay) {
      window.setTimeout(() => {
        const item = this.getStartupPlaybackItem() || this.store.getState().currentItem || this.getDefaultItem();
        if (item) this.playItem(item, { resume: true }).catch(() => undefined);
      }, 900);
    }

    if (firstRun) {
      this.settings.firstRunComplete = true;
      this.saveSettings().catch(() => undefined);
      new Notice("Music Pro is ready. Click the music icon or use the mini dock to play.");
    }

    // Refresh remote catalog on every Obsidian/plugin open, but schedule it as background work
    // so a 500+ item catalog does not compete with Obsidian startup/sidebar rendering.
    this.scheduleIdleTask(() => {
      this.refreshCatalog(true, true).then(() => this.selectInitialItem()).catch(() => undefined);
    }, 6000);

    // Honor the user's Default view after onboarding; open sidebar only on first run for discovery.
    const startupMode: PlayerMode = firstRun ? "sidebar" : this.settings.viewMode;
    this.settings.viewMode = startupMode;
    this.store.setMode(startupMode);
    this.saveSettings().catch(() => undefined);
    if (startupMode === "sidebar") {
      window.setTimeout(() => this.openSidebar(), 300);
    } else {
      window.setTimeout(() => this.renderChrome(), 300);
    }
  }

  private scheduleIdleTask(task: () => void, timeout = 3000): void {
    const requestIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;

    if (requestIdle) {
      requestIdle(task, { timeout });
      return;
    }

    window.setTimeout(task, Math.min(timeout, 2500));
  }

  onunload(): void {
    if (this.store) this.rememberPlaybackSession(this.store.getState(), true);
    this.externalAudioPaused = false;
    this.externalAudioMonitor?.stop();
    this.externalAudioMonitor = null;
    this.clearExternalAudioResumeTimer();
    this.cancelVolumeFade();
    this.flushUserVolumeSaveTimer();
    this.clearPlaybackSessionSaveTimer();
    this.finalizeBehaviorSession("unload");
    this.clearBehaviorSaveTimer();
    this.flushScheduledSettingsSave();
    this.destroyFullNameTooltip();
    this.stopRainbowAccent(false);
    this.miniDock?.destroy();
    this.player?.destroy();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.userItems = this.normalizeUserItems(this.settings.userItems);
    this.settings.userItemOrder = this.settings.userItemOrder || this.settings.userItems.map((item) => item.id);
    this.settings.personalCategories = this.normalizePersonalCategories(this.settings.personalCategories);
    this.settings.playlistCategoryOrder = this.normalizePlaylistCategoryOrder(this.settings.playlistCategoryOrder);
    this.settings.disabledPlaylistCategoryIds = this.normalizeDisabledPlaylistCategoryIds(this.settings.disabledPlaylistCategoryIds);
    this.settings.personalPlaylistAssignments = this.normalizePersonalPlaylistAssignments(this.settings.personalPlaylistAssignments);
    this.settings.personalFolderItemOrders = this.normalizePersonalFolderItemOrders(this.settings.personalFolderItemOrders);
    this.settings.playlistTrackOrders = this.settings.playlistTrackOrders || {};
    this.settings.recentlyPlayedItemIds = this.normalizeRecentItemIds(this.settings.recentlyPlayedItemIds);
    this.settings.recentlyPlayedArtworkByItemId = this.normalizeRecentArtworkByItemId(this.settings.recentlyPlayedArtworkByItemId);
    this.trimRecentArtworkSnapshots();
    if (this.settings.disabledPlaylistCategoryIds.includes(RECENT_PLAYLIST_CATEGORY_ID)) {
      this.settings.recentlyPlayedItemIds = [];
      this.settings.recentlyPlayedArtworkByItemId = {};
    }
    this.settings.autoplayOnStartup = this.settings.autoplayOnStartup !== false;
    this.settings.enableMobileMode = this.settings.enableMobileMode === true;
    this.settings.firstRunComplete = Boolean(this.settings.firstRunComplete);
    this.settings.lastAddCategory = this.settings.lastAddCategory || "User";
    this.settings.pauseForExternalAudio = this.settings.pauseForExternalAudio !== false;
    this.settings.randomPlaylistEnabled = this.settings.randomPlaylistEnabled === true;
    this.settings.loopTrackEnabled = Boolean(this.settings.loopTrackEnabled);
    this.settings.behaviorStats = this.normalizeBehaviorStats(this.settings.behaviorStats);
    this.settings.behaviorRankingScores = this.normalizeBehaviorRankingScores(this.settings.behaviorRankingScores);
    this.settings.behaviorRankingUpdatedAt = typeof this.settings.behaviorRankingUpdatedAt === "string" ? this.settings.behaviorRankingUpdatedAt : "";
    this.settings.currentItemId = typeof this.settings.currentItemId === "string" ? this.settings.currentItemId : "";
    this.settings.currentSoundIndex = Math.max(0, Math.floor(Number(this.settings.currentSoundIndex || 0)));
    this.settings.currentPositionMs = Math.max(0, Math.floor(Number(this.settings.currentPositionMs || 0)));
    this.settings.accentColor = this.normalizeAccentColor(this.settings.accentColor);
    this.settings.rainbowAccentEnabled = Boolean(this.settings.rainbowAccentEnabled);
    delete (this.settings as MusicProSettings & { adaptiveThemeEnabled?: boolean }).adaptiveThemeEnabled;
    this.settings.adaptAccentToTheme = false;
    this.settings.volume = Math.max(0, Math.min(100, Number(this.settings.volume || 40)));
    this.settings.refreshIntervalDays = Math.max(1, Number(this.settings.refreshIntervalDays || 14));
    this.settings.lastSelectedCategory = typeof this.settings.lastSelectedCategory === "string"
      ? this.settings.lastSelectedCategory
      : DEFAULT_PLAYLIST_CATEGORY_ID;
    if (!this.isPlaylistCategoryEnabled(this.settings.lastSelectedCategory)) {
      this.settings.lastSelectedCategory = this.getFallbackPlaylistCategoryId();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  isMobileModeBlocked(): boolean {
    return Platform.isMobile && !this.settings.enableMobileMode;
  }

  async setMobileModeEnabled(enabled: boolean): Promise<void> {
    this.settings.enableMobileMode = Boolean(enabled);
    await this.saveSettings();
    if (Platform.isMobile) {
      new Notice("Music Pro: reload Obsidian to apply mobile mode.");
    }
  }

  private saveSettingsSoon(delay = 220): void {
    if (this.settingsSaveTimer !== null) window.clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = window.setTimeout(() => {
      this.settingsSaveTimer = null;
      this.saveSettings().catch(() => undefined);
    }, delay);
  }

  private flushScheduledSettingsSave(): void {
    if (this.settingsSaveTimer === null) return;
    window.clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = null;
    this.saveSettings().catch(() => undefined);
  }

  private normalizeUserItems(value: unknown): CatalogItem[] {
    if (!Array.isArray(value)) return [];
    const out: CatalogItem[] = [];
    const seen = new Set<string>();
    for (const raw of value as Partial<CatalogItem>[]) {
      if (!raw || typeof raw !== "object") continue;
      const rawUrl = String(raw.url || "").trim();
      if (!rawUrl) continue;
      let url = rawUrl;
      let embeddable = true;
      try {
        url = normalizeSoundCloudUrl(rawUrl);
        assertEmbeddableSoundCloudUrl(url);
      } catch {
        embeddable = false;
      }

      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const title = String(raw.title || "SoundCloud link").trim() || "SoundCloud link";
      const artist = String(raw.artist || "SoundCloud").trim() || "SoundCloud";
      const categories = Array.isArray(raw.categories) && raw.categories.length > 0
        ? raw.categories.map((category) => String(category).trim()).filter(Boolean)
        : ["User"];
      const tags = Array.isArray(raw.tags)
        ? raw.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : [];
      const finalTags = embeddable ? tags : [...new Set([...tags, "unembeddable"])];
      const status = embeddable
        ? (["active", "broken", "hidden"].includes(String(raw.status)) ? raw.status as CatalogItem["status"] : "active")
        : "broken";
      const artworkUrl = normalizeSoundCloudArtworkUrl(raw.artworkUrl);

      out.push({
        id: String(raw.id || `soundcloud-${Date.now().toString(36)}-${out.length}`),
        provider: "soundcloud",
        type: raw.type || inferSoundCloudType(url),
        title,
        displayTitle: raw.displayTitle || makeDisplayTitle(title, artist, categories, finalTags),
        artist,
        url,
        ...(artworkUrl ? { artworkUrl } : {}),
        ...(raw.authorUrl ? { authorUrl: String(raw.authorUrl) } : {}),
        categories,
        tags: finalTags,
        source: "user",
        addedAt: raw.addedAt || today(),
        verifiedAt: raw.verifiedAt || today(),
        status
      });
    }
    return out;
  }

  private normalizeBehaviorStats(value: unknown): Record<string, MusicProBehaviorStats> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value as Record<string, Partial<MusicProBehaviorStats>>)
      .filter(([key]) => Boolean(key))
      .map(([key, stats]) => [key, this.normalizeBehaviorStat(stats)] as const)
      .sort(([, a], [, b]) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .slice(0, 300);
    return Object.fromEntries(entries);
  }

  private normalizeBehaviorRankingScores(value: unknown): Record<string, number> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => Boolean(key))
      .map(([key, rawScore]) => [key, Number(rawScore)] as const)
      .filter(([, score]) => Number.isFinite(score) && Math.abs(score) > 0.001)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
      .slice(0, 300);
    return Object.fromEntries(entries);
  }

  private normalizeBehaviorStat(stats: Partial<MusicProBehaviorStats> | null | undefined): MusicProBehaviorStats {
    return {
      playCount: Math.max(0, Math.floor(Number(stats?.playCount || 0))),
      completionCount: Math.max(0, Math.floor(Number(stats?.completionCount || 0))),
      skipCount: Math.max(0, Math.floor(Number(stats?.skipCount || 0))),
      replayCount: Math.max(0, Math.floor(Number(stats?.replayCount || 0))),
      folderAddCount: Math.max(0, Math.floor(Number(stats?.folderAddCount || 0))),
      unavailableCount: Math.max(0, Math.floor(Number(stats?.unavailableCount || 0))),
      previewCount: Math.max(0, Math.floor(Number(stats?.previewCount || 0))),
      totalListenMs: Math.max(0, Math.floor(Number(stats?.totalListenMs || 0))),
      lastPlayedAt: typeof stats?.lastPlayedAt === "string" ? stats.lastPlayedAt : "",
      updatedAt: typeof stats?.updatedAt === "string" ? stats.updatedAt : ""
    };
  }

  private scheduleBehaviorSave(): void {
    if (this.behaviorSaveTimer !== null) return;
    this.behaviorSaveTimer = window.setTimeout(() => {
      this.behaviorSaveTimer = null;
      this.settings.behaviorStats = this.normalizeBehaviorStats(this.settings.behaviorStats);
      this.saveSettings().catch(() => undefined);
    }, 6000);
  }

  private clearBehaviorSaveTimer(): void {
    if (this.behaviorSaveTimer !== null) {
      window.clearTimeout(this.behaviorSaveTimer);
      this.behaviorSaveTimer = null;
      this.settings.behaviorStats = this.normalizeBehaviorStats(this.settings.behaviorStats);
      this.saveSettings().catch(() => undefined);
    }
  }

  private getBehaviorKey(item: CatalogItem | null | undefined): string {
    return item?.id || "";
  }

  private updateBehaviorStats(itemId: string, update: Partial<MusicProBehaviorStats>): void {
    if (!itemId) return;
    const numericKeys: (keyof MusicProBehaviorStats)[] = [
      "playCount",
      "completionCount",
      "skipCount",
      "replayCount",
      "folderAddCount",
      "unavailableCount",
      "previewCount",
      "totalListenMs"
    ];
    const hasUsefulUpdate = numericKeys.some((key) => Math.max(0, Math.floor(Number(update[key] || 0))) > 0) || Boolean(update.lastPlayedAt);
    if (!hasUsefulUpdate) return;
    const now = new Date().toISOString();
    const current = this.normalizeBehaviorStat(this.settings.behaviorStats?.[itemId]);
    const next: MusicProBehaviorStats = {
      ...current,
      playCount: current.playCount + Math.max(0, Math.floor(Number(update.playCount || 0))),
      completionCount: current.completionCount + Math.max(0, Math.floor(Number(update.completionCount || 0))),
      skipCount: current.skipCount + Math.max(0, Math.floor(Number(update.skipCount || 0))),
      replayCount: current.replayCount + Math.max(0, Math.floor(Number(update.replayCount || 0))),
      folderAddCount: current.folderAddCount + Math.max(0, Math.floor(Number(update.folderAddCount || 0))),
      unavailableCount: current.unavailableCount + Math.max(0, Math.floor(Number(update.unavailableCount || 0))),
      previewCount: current.previewCount + Math.max(0, Math.floor(Number(update.previewCount || 0))),
      totalListenMs: current.totalListenMs + Math.max(0, Math.floor(Number(update.totalListenMs || 0))),
      lastPlayedAt: update.lastPlayedAt || current.lastPlayedAt,
      updatedAt: now
    };
    this.settings.behaviorStats = {
      ...(this.settings.behaviorStats || {}),
      [itemId]: next
    };
    this.scheduleBehaviorSave();
  }

  getActiveAccentColor(): string {
    if (!this.settings.rainbowAccentEnabled) return this.settings.accentColor;
    return this.getRainbowAccentColor();
  }

  private getRainbowAccentColor(now = Date.now()): string {
    const paletteSize = RAINBOW_ACCENT_COLORS.length;
    const cycleMs = paletteSize * RAINBOW_ACCENT_STEP_MS;
    const position = ((now % cycleMs) + cycleMs) % cycleMs;
    const fromIndex = Math.floor(position / RAINBOW_ACCENT_STEP_MS);
    const toIndex = (fromIndex + 1) % paletteSize;
    const rawProgress = (position - fromIndex * RAINBOW_ACCENT_STEP_MS) / RAINBOW_ACCENT_STEP_MS;
    const easedProgress = 0.5 - Math.cos(rawProgress * Math.PI) / 2;
    return this.mixHexColors(RAINBOW_ACCENT_COLORS[fromIndex]!, RAINBOW_ACCENT_COLORS[toIndex]!, easedProgress);
  }

  private mixHexColors(from: string, to: string, progress: number): string {
    const [fromR, fromG, fromB] = this.hexToRgb(from);
    const [toR, toG, toB] = this.hexToRgb(to);
    const t = Math.max(0, Math.min(1, progress));
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
    return this.rgbToHex(mix(fromR, toR), mix(fromG, toG), mix(fromB, toB));
  }

  private hexToRgb(color: string): [number, number, number] {
    const hex = this.normalizeAccentColor(color).slice(1);
    return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
  }

  private rgbToHex(r: number, g: number, b: number): string {
    const toHex = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  private configureRainbowAccent(): void {
    if (this.settings.rainbowAccentEnabled) this.startRainbowAccent();
    else this.stopRainbowAccent(false);
    this.applyAccentToUi();
  }

  private startRainbowAccent(): void {
    if (this.rainbowAccentFrame !== null) return;
    this.rainbowAccentLastTick = 0;
    this.rainbowAccentLastColor = "";
    const tick = (timestamp: number) => {
      this.rainbowAccentFrame = window.requestAnimationFrame(tick);
      if (!this.settings.rainbowAccentEnabled) {
        this.stopRainbowAccent();
        return;
      }
      if (this.rainbowAccentLastTick > 0 && timestamp - this.rainbowAccentLastTick < RAINBOW_ACCENT_TICK_MS) return;
      this.rainbowAccentLastTick = timestamp;
      const color = this.getRainbowAccentColor();
      if (color === this.rainbowAccentLastColor) return;
      this.rainbowAccentLastColor = color;
      this.applyAccentToUi();
    };
    this.rainbowAccentFrame = window.requestAnimationFrame(tick);
  }

  private stopRainbowAccent(applyStaticAccent = true): void {
    if (this.rainbowAccentFrame !== null) {
      window.cancelAnimationFrame(this.rainbowAccentFrame);
      this.rainbowAccentFrame = null;
    }
    this.rainbowAccentLastTick = 0;
    this.rainbowAccentLastColor = "";
    if (applyStaticAccent) this.applyAccentToUi();
  }

  async setRainbowAccentEnabled(enabled: boolean): Promise<void> {
    this.settings.rainbowAccentEnabled = Boolean(enabled);
    this.settings.adaptAccentToTheme = false;
    await this.saveSettings();
    this.configureRainbowAccent();
    this.renderChrome();
  }

  applyAccentToElement(element: HTMLElement | null | undefined, accentColor?: string): void {
    if (!element) return;
    const color = accentColor || this.getActiveAccentColor();
    const accentKey = `bg-v3|fixed|${color || "theme"}`;
    if (element.getAttribute("data-music-pro-accent-cache") === accentKey) return;
    element.addClass("music-pro-fixed-appearance");
    element.removeClass("music-pro-adaptive-appearance");
    const props = [
      "--interactive-accent",
      "--music-pro-accent",
      "--music-pro-user-accent",
      "--music-pro-on-accent",
      "--music-pro-accent-strong",
      "--music-pro-accent-soft",
      "--music-pro-range-fill",
      "--music-pro-background-accent",
      "--music-pro-background-glow",
      "--music-pro-background-soft",
      "--music-pro-background-deep",
      "--music-pro-background-mid",
      "--music-pro-background-bottom",
      "--text-on-accent"
    ];
    if (!color) {
      for (const prop of props) element.style.removeProperty(prop);
      element.removeClass("music-pro-custom-accent");
      element.addClass("music-pro-theme-accent");
      element.setAttribute("data-music-pro-accent-cache", accentKey);
      return;
    }
    element.addClass("music-pro-custom-accent");
    element.removeClass("music-pro-theme-accent");
    const deepBase = "#06111f";
    const midBase = "#111722";
    const bottomBase = "#0e1219";
    const onAccent = this.getOnAccentColor(color);
    element.style.setProperty("--interactive-accent", color);
    element.style.setProperty("--music-pro-accent", color);
    element.style.setProperty("--music-pro-user-accent", color);
    element.style.setProperty("--music-pro-on-accent", onAccent);
    element.style.setProperty("--music-pro-accent-strong", `color-mix(in srgb, ${color} 88%, #ffffff 12%)`);
    element.style.setProperty("--music-pro-accent-soft", `color-mix(in srgb, ${color} 13%, transparent)`);
    element.style.setProperty("--music-pro-range-fill", color);
    element.style.setProperty("--music-pro-background-accent", color);
    element.style.setProperty("--music-pro-background-glow", `color-mix(in srgb, ${color} 36%, transparent)`);
    element.style.setProperty("--music-pro-background-soft", `color-mix(in srgb, ${color} 16%, transparent)`);
    element.style.setProperty("--music-pro-background-deep", `color-mix(in srgb, ${color} 22%, ${deepBase} 78%)`);
    element.style.setProperty("--music-pro-background-mid", `color-mix(in srgb, ${color} 10%, ${midBase} 90%)`);
    element.style.setProperty("--music-pro-background-bottom", `color-mix(in srgb, ${color} 5%, ${bottomBase} 95%)`);
    element.style.setProperty("--text-on-accent", onAccent);
    element.setAttribute("data-music-pro-accent-cache", accentKey);
  }

  applyAccentToUi(): void {
    const color = this.getActiveAccentColor();
    for (const element of document.querySelectorAll<HTMLElement>(".music-pro-sidebar, .music-pro-mini-dock, .music-pro-quick-picker, .music-pro-settings")) {
      this.applyAccentToElement(element, color);
    }
  }

  async setAccentColor(color: string): Promise<void> {
    this.settings.accentColor = this.normalizeAccentColor(color);
    this.settings.adaptAccentToTheme = false;
    await this.saveSettings();
    this.applyAccentToUi();
    this.renderChrome();
  }

  getPlaylistCategoryDefinitions(): PlaylistCategoryDefinition[] {
    return this.getAllPlaylistCategoryDefinitions().filter((category) => this.isPlaylistCategoryEnabled(category.id));
  }

  getAllPlaylistCategoryDefinitions(): PlaylistCategoryDefinition[] {
    const builtIns = new Map(ALL_PLAYLIST_CATEGORIES.map((category) => [category.id, category]));
    const personal = this.getPersonalCategoryDefinitions();
    const personalMap = new Map(personal.map((category) => [category.id, category]));
    const all = new Map<string, PlaylistCategoryDefinition>([...builtIns, ...personalMap]);
    const order = this.normalizePlaylistCategoryOrder(this.settings.playlistCategoryOrder);
    return order.map((id) => all.get(id)).filter(Boolean) as PlaylistCategoryDefinition[];
  }

  getEnabledBasePlaylistCategoryDefinitions(): PlaylistCategoryDefinition[] {
    return ALL_PLAYLIST_CATEGORIES.filter((category) => this.isPlaylistCategoryEnabled(category.id));
  }

  getEnabledPersonalCategoryDefinitions(): PlaylistCategoryDefinition[] {
    return this.getPersonalCategoryDefinitions().filter((category) => this.isPlaylistCategoryEnabled(category.id));
  }

  private getPersonalCategoryIdSet(): Set<string> {
    const categories = this.settings.personalCategories;
    if (this.personalCategoryIdSetCache?.categories === categories) return this.personalCategoryIdSetCache.ids;
    const ids = new Set(categories.map((category) => category.id));
    this.personalCategoryIdSetCache = { categories, ids };
    return ids;
  }

  private hasPlaylistCategoryDefinition(categoryId: string): boolean {
    return ALL_PLAYLIST_CATEGORIES.some((category) => category.id === categoryId)
      || this.settings.personalCategories.some((category) => category.id === categoryId);
  }

  isPlaylistCategoryEnabled(categoryId: string): boolean {
    return Boolean(categoryId)
      && this.hasPlaylistCategoryDefinition(categoryId)
      && !this.settings.disabledPlaylistCategoryIds.includes(categoryId);
  }

  getFallbackPlaylistCategoryId(): string {
    if (this.isPlaylistCategoryEnabled(DEFAULT_PLAYLIST_CATEGORY_ID)) return DEFAULT_PLAYLIST_CATEGORY_ID;
    return this.getPlaylistCategoryDefinitions()[0]?.id || DEFAULT_PLAYLIST_CATEGORY_ID;
  }

  async setPlaylistCategoryEnabled(categoryId: string, enabled: boolean): Promise<void> {
    if (!categoryId) return;
    const disabled = new Set(this.normalizeDisabledPlaylistCategoryIds(this.settings.disabledPlaylistCategoryIds));
    if (enabled) disabled.delete(categoryId);
    else disabled.add(categoryId);
    this.settings.disabledPlaylistCategoryIds = this.normalizeDisabledPlaylistCategoryIds([...disabled]);
    if (categoryId === RECENT_PLAYLIST_CATEGORY_ID && !enabled) {
      this.settings.recentlyPlayedItemIds = [];
      this.settings.recentlyPlayedArtworkByItemId = {};
    }
    this.enabledItemsCache = null;
    if (!this.isPlaylistCategoryEnabled(this.settings.lastSelectedCategory)) {
      this.settings.lastSelectedCategory = this.getFallbackPlaylistCategoryId();
    }
    await this.saveSettings();
    this.renderAll();
  }

  async setAllPlaylistCategoriesEnabled(enabled: boolean): Promise<void> {
    const ids = this.getAllPlaylistCategoryDefinitions()
      .map((category) => category.id);
    this.settings.disabledPlaylistCategoryIds = enabled ? [] : this.normalizeDisabledPlaylistCategoryIds(ids);
    if (!enabled) {
      this.settings.recentlyPlayedItemIds = [];
      this.settings.recentlyPlayedArtworkByItemId = {};
    }
    this.enabledItemsCache = null;
    if (!this.isPlaylistCategoryEnabled(this.settings.lastSelectedCategory)) {
      this.settings.lastSelectedCategory = this.getFallbackPlaylistCategoryId();
    }
    await this.saveSettings();
    this.renderAll();
  }

  getPersonalCategoryDefinitions(): PlaylistCategoryDefinition[] {
    return this.settings.personalCategories.map((category) => ({
      id: category.id,
      label: category.label,
      description: "",
      icon: "folder-heart",
      keywords: [category.label]
    }));
  }

  getCatalogItemsWithPersonalAssignments(): CatalogItem[] {
    const sourceItems = this.catalog.getItems();
    const fingerprint = this.getPersonalAssignmentFingerprint();
    if (
      this.assignedItemsCache
      && this.assignedItemsCache.sourceItems === sourceItems
      && this.assignedItemsCache.fingerprint === fingerprint
    ) {
      return this.assignedItemsCache.items;
    }

    const validIds = this.getPersonalCategoryIdSet();
    const labelById = new Map(this.settings.personalCategories.map((category) => [category.id, category.label]));
    const categoryIdByLabelKey = new Map(this.settings.personalCategories.map((category) => [normalizePlaylistText(category.label), category.id]));
    const assignments = this.settings.personalPlaylistAssignments || {};
    const items = sourceItems.map((item) => {
      const categoryKeys = new Set(item.categories.map(normalizePlaylistText));
      const explicitIds = (assignments[this.getItemAssignmentKey(item)] || []).filter((id) => validIds.has(id));
      const legacyIds = [...categoryKeys].map((key) => categoryIdByLabelKey.get(key)).filter(Boolean) as string[];
      const labels = [...new Set([...explicitIds, ...legacyIds])]
        .map((id) => labelById.get(id))
        .filter(Boolean) as string[];
      if (labels.length === 0) return item;
      const merged = [...item.categories];
      for (const label of labels) {
        if (!categoryKeys.has(normalizePlaylistText(label))) merged.push(label);
      }
      return merged.length === item.categories.length ? item : { ...item, categories: merged };
    });

    this.assignedItemsCache = { sourceItems, fingerprint, items };
    return items;
  }

  getEnabledCatalogItemsWithPersonalAssignments(): CatalogItem[] {
    const items = this.getCatalogItemsWithPersonalAssignments();
    const baseDefinitions = this.getEnabledBasePlaylistCategoryDefinitions();
    const personalDefinitions = this.getEnabledPersonalCategoryDefinitions();
    const fingerprint = [
      baseDefinitions.map((category) => `${category.id}:${category.label}`).join("|"),
      personalDefinitions.map((category) => `${category.id}:${category.label}`).join("|"),
      this.getPersonalAssignmentFingerprint(),
      this.settings.disabledPlaylistCategoryIds.join("|")
    ].join("::");

    if (
      this.enabledItemsCache
      && this.enabledItemsCache.sourceItems === items
      && this.enabledItemsCache.fingerprint === fingerprint
    ) {
      return this.enabledItemsCache.items;
    }

    const index = buildPlaylistIndex(items, personalDefinitions, baseDefinitions);
    this.enabledItemsCache = { sourceItems: items, fingerprint, items: index.items };
    return this.enabledItemsCache.items;
  }

  getPersonalAssignmentFingerprint(): string {
    const categories = this.settings.personalCategories;
    const assignmentsObject = this.settings.personalPlaylistAssignments || {};
    if (
      this.personalAssignmentFingerprintCache?.categories === categories
      && this.personalAssignmentFingerprintCache.assignments === assignmentsObject
    ) {
      return this.personalAssignmentFingerprintCache.fingerprint;
    }
    const labels = this.settings.personalCategories.map((category) => `${category.id}:${category.label}`).join("|");
    const assignments = Object.entries(assignmentsObject)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, ids]) => `${key}:${ids.join(",")}`)
      .join("|");
    const fingerprint = `${labels}::${assignments}`;
    this.personalAssignmentFingerprintCache = { categories, assignments: assignmentsObject, fingerprint };
    return fingerprint;
  }

  getItemPersonalCategoryIds(item: CatalogItem): string[] {
    const validIds = this.getPersonalCategoryIdSet();
    const key = this.getItemAssignmentKey(item);
    const explicitIds = (this.settings.personalPlaylistAssignments?.[key] || []).filter((id) => validIds.has(id));
    const categoryKeys = new Set(item.categories.map(normalizePlaylistText));
    const legacyIds = this.settings.personalCategories
      .filter((category) => categoryKeys.has(normalizePlaylistText(category.label)))
      .map((category) => category.id);
    return [...new Set([...explicitIds, ...legacyIds])];
  }

  isPersonalCategory(categoryId: string): boolean {
    return this.settings.personalCategories.some((category) => category.id === categoryId);
  }

  isItemInPersonalCategory(item: CatalogItem, categoryId: string): boolean {
    return this.getItemPersonalCategoryIds(item).includes(categoryId);
  }

  getItemOrderKey(item: CatalogItem): string {
    return this.getItemAssignmentKey(item);
  }

  getOrderedPersonalFolderItems(categoryId: string, items: CatalogItem[]): CatalogItem[] {
    if (!this.isPersonalCategory(categoryId)) return items;
    const order = this.settings.personalFolderItemOrders?.[categoryId] || [];
    if (order.length === 0) return items;
    const positionByKey = new Map(order.map((key, index) => [key, index]));
    return items.slice().sort((a, b) => {
      const aPos = positionByKey.get(this.getItemOrderKey(a));
      const bPos = positionByKey.get(this.getItemOrderKey(b));
      if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
      if (aPos !== undefined) return -1;
      if (bPos !== undefined) return 1;
      return 0;
    });
  }

  async reorderPersonalFolderItem(categoryId: string, sourceKey: string, targetKey: string, placement: "before" | "after" = "before"): Promise<void> {
    if (!this.isPersonalCategory(categoryId) || !sourceKey || !targetKey || sourceKey === targetKey) return;
    const folderItems = this.getCatalogItemsWithPersonalAssignments().filter((item) => this.isItemInPersonalCategory(item, categoryId));
    const visibleKeys = folderItems.map((item) => this.getItemOrderKey(item));
    const visibleKeySet = new Set(visibleKeys);
    if (!visibleKeySet.has(sourceKey) || !visibleKeySet.has(targetKey)) return;

    const currentOrder = this.settings.personalFolderItemOrders?.[categoryId] || [];
    const orderedVisibleKeys = [
      ...currentOrder.filter((key) => visibleKeySet.has(key)),
      ...visibleKeys.filter((key) => !currentOrder.includes(key))
    ];
    const uniqueVisibleKeys = [...new Set(orderedVisibleKeys)];
    const staleKeys = currentOrder.filter((key) => !visibleKeySet.has(key));
    const nextVisibleKeys = uniqueVisibleKeys.filter((key) => key !== sourceKey);
    const targetIndex = nextVisibleKeys.indexOf(targetKey);
    if (targetIndex === -1) return;
    nextVisibleKeys.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, sourceKey);

    this.settings.personalFolderItemOrders = {
      ...(this.settings.personalFolderItemOrders || {}),
      [categoryId]: [...nextVisibleKeys, ...staleKeys]
    };
    this.renderAll();
    this.saveSettingsSoon();
  }

  async addItemToPersonalCategory(item: CatalogItem, categoryId: string): Promise<boolean> {
    const category = this.settings.personalCategories.find((entry) => entry.id === categoryId);
    if (!category) throw new Error("Personal playlist not found.");
    if (this.isItemInPersonalCategory(item, categoryId)) return false;

    const key = this.getItemAssignmentKey(item);
    const currentIds = this.normalizeAssignmentIds(this.settings.personalPlaylistAssignments?.[key] || []);
    this.settings.personalPlaylistAssignments = {
      ...(this.settings.personalPlaylistAssignments || {}),
      [key]: [...currentIds, categoryId]
    };
    this.appendItemToPersonalFolderOrder(categoryId, key);
    this.updateBehaviorStats(this.getBehaviorKey(item), { folderAddCount: 1 });
    this.assignedItemsCache = null;
    this.enabledItemsCache = null;
    await this.saveSettings();
    this.renderAll();
    return true;
  }

  async removeItemFromPersonalCategory(item: CatalogItem, categoryId: string): Promise<boolean> {
    const category = this.settings.personalCategories.find((entry) => entry.id === categoryId);
    if (!category) throw new Error("Personal playlist not found.");

    const key = this.getItemAssignmentKey(item);
    const currentIds = this.normalizeAssignmentIds(this.settings.personalPlaylistAssignments?.[key] || []);
    const nextIds = currentIds.filter((id) => id !== categoryId);
    let changed = nextIds.length !== currentIds.length;

    if (changed) {
      const assignments = { ...(this.settings.personalPlaylistAssignments || {}) };
      if (nextIds.length > 0) assignments[key] = nextIds;
      else delete assignments[key];
      this.settings.personalPlaylistAssignments = assignments;
      this.removeItemFromPersonalFolderOrder(categoryId, key);
    }

    const categoryKey = normalizePlaylistText(category.label);
    let userItemsChanged = false;
    this.settings.userItems = this.settings.userItems.map((userItem) => {
      if (this.getItemAssignmentKey(userItem) !== key) return userItem;
      const categories = userItem.categories.filter((label) => normalizePlaylistText(label) !== categoryKey);
      if (categories.length === userItem.categories.length) return userItem;
      userItemsChanged = true;
      return { ...userItem, categories: categories.length ? categories : ["User"] };
    });

    if (!changed && !userItemsChanged) return false;

    this.assignedItemsCache = null;
    this.enabledItemsCache = null;
    if (userItemsChanged) this.catalog.reloadFromSettings(this.settings);
    await this.saveSettings();
    this.renderAll();
    return true;
  }

  async createPersonalCategory(label: string): Promise<PersonalPlaylistCategory> {
    const clean = this.cleanCategoryLabel(label);
    if (!clean) throw new Error("Playlist name cannot be empty.");
    if (this.categoryLabelExists(clean)) throw new Error("This playlist already exists.");
    const category: PersonalPlaylistCategory = {
      id: `personal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: clean,
      createdAt: new Date().toISOString()
    };
    this.settings.personalCategories = [...this.settings.personalCategories, category];
    this.settings.playlistCategoryOrder = this.normalizePlaylistCategoryOrder([...this.settings.playlistCategoryOrder, category.id]);
    this.assignedItemsCache = null;
    this.enabledItemsCache = null;
    await this.saveSettings();
    this.renderAll();
    return category;
  }

  async renamePersonalCategory(categoryId: string, nextLabel: string): Promise<void> {
    const clean = this.cleanCategoryLabel(nextLabel);
    if (!clean) throw new Error("Playlist name cannot be empty.");
    const existing = this.settings.personalCategories.find((category) => category.id === categoryId);
    if (!existing) throw new Error("Personal playlist not found.");
    const oldLabel = existing.label;
    if (normalizePlaylistText(oldLabel) !== normalizePlaylistText(clean) && this.categoryLabelExists(clean)) {
      throw new Error("This playlist already exists.");
    }
    this.settings.personalCategories = this.settings.personalCategories.map((category) => (
      category.id === categoryId ? { ...category, label: clean } : category
    ));
    this.settings.userItems = this.settings.userItems.map((item) => ({
      ...item,
      categories: item.categories.map((category) => normalizePlaylistText(category) === normalizePlaylistText(oldLabel) ? clean : category)
    }));
    this.assignedItemsCache = null;
    this.enabledItemsCache = null;
    this.catalog.reloadFromSettings(this.settings);
    await this.saveSettings();
    this.renderAll();
  }

  async deletePersonalCategory(categoryId: string): Promise<void> {
    const existing = this.settings.personalCategories.find((category) => category.id === categoryId);
    if (!existing) return;
    const oldLabel = existing.label;
    this.settings.personalCategories = this.settings.personalCategories.filter((category) => category.id !== categoryId);
    this.settings.playlistCategoryOrder = this.settings.playlistCategoryOrder.filter((id) => id !== categoryId);
    this.settings.disabledPlaylistCategoryIds = this.settings.disabledPlaylistCategoryIds.filter((id) => id !== categoryId);
    delete this.settings.personalFolderItemOrders[categoryId];
    this.settings.personalPlaylistAssignments = this.removePersonalCategoryFromAssignments(categoryId);
    this.settings.userItems = this.settings.userItems.map((item) => {
      const categories = item.categories.filter((category) => normalizePlaylistText(category) !== normalizePlaylistText(oldLabel));
      return { ...item, categories: categories.length ? categories : ["User"] };
    });
    this.assignedItemsCache = null;
    this.enabledItemsCache = null;
    this.catalog.reloadFromSettings(this.settings);
    await this.saveSettings();
    this.renderAll();
  }

  async reorderPlaylistCategory(sourceId: string, targetId: string): Promise<void> {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const order = this.normalizePlaylistCategoryOrder(this.settings.playlistCategoryOrder);
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    this.settings.playlistCategoryOrder = order;
    this.renderAll();
    this.saveSettingsSoon();
  }

  async resetPlaylistCategoryOrder(): Promise<void> {
    this.settings.playlistCategoryOrder = [
      ...DEFAULT_PLAYLIST_CATEGORY_ORDER,
      ...this.settings.personalCategories.map((category) => category.id)
    ];
    await this.saveSettings();
    this.renderAll();
  }

  private normalizePersonalCategories(value: unknown): PersonalPlaylistCategory[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: PersonalPlaylistCategory[] = [];
    for (const raw of value) {
      const label = this.cleanCategoryLabel(raw?.label || "");
      const id = typeof raw?.id === "string" && raw.id.startsWith("personal-")
        ? raw.id
        : `personal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const key = normalizePlaylistText(label);
      if (!label || seen.has(key)) continue;
      seen.add(key);
      out.push({ id, label, createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : new Date().toISOString() });
    }
    return out;
  }

  private normalizeAccentColor(value: unknown): string {
    const color = String(value || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_ACCENT_COLOR;
  }

  private getOnAccentColor(color: string): "#ffffff" | "#08111f" {
    const cached = this.onAccentColorCache.get(color);
    if (cached) return cached;
    const accentLum = this.getRelativeLuminance(color);
    const whiteContrast = this.getContrastRatio(accentLum, 1);
    const inkContrast = this.getContrastRatio(accentLum, this.getRelativeLuminance("#08111f"));
    const onAccent = whiteContrast >= 4.5 || whiteContrast >= inkContrast ? "#ffffff" : "#08111f";
    this.onAccentColorCache.set(color, onAccent);
    return onAccent;
  }

  private getContrastRatio(leftLum: number, rightLum: number): number {
    const lighter = Math.max(leftLum, rightLum);
    const darker = Math.min(leftLum, rightLum);
    return (lighter + 0.05) / (darker + 0.05);
  }

  private getRelativeLuminance(color: string): number {
    const hex = this.normalizeAccentColor(color).slice(1);
    const [r, g, b] = [0, 2, 4].map((index) => {
      const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  }

  private normalizePlaylistCategoryOrder(value: unknown): string[] {
    const personalIds = this.settings.personalCategories.map((category) => category.id);
    const validIds = new Set([...DEFAULT_PLAYLIST_CATEGORY_ORDER, ...personalIds]);
    const input = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && validIds.has(id)) : [];
    const seen = new Set<string>();
    const order: string[] = [];
    for (const id of input) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const id of DEFAULT_PLAYLIST_CATEGORY_ORDER) {
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    for (const id of personalIds) {
      if (!seen.has(id)) order.push(id);
    }
    const builtInOrder = order.filter((id) => DEFAULT_PLAYLIST_CATEGORY_ORDER.includes(id));
    const personalOrder = order.filter((id) => personalIds.includes(id));
    const previousCommunityDefaultOrder = [
      RECENT_PLAYLIST_CATEGORY_ID,
      DEFAULT_PLAYLIST_CATEGORY_ID,
      COMMUNITY_PLAYLIST_CATEGORY_ID,
      ...DEFAULT_PLAYLIST_CATEGORY_ORDER.filter((id) => (
        id !== RECENT_PLAYLIST_CATEGORY_ID
        && id !== DEFAULT_PLAYLIST_CATEGORY_ID
        && id !== COMMUNITY_PLAYLIST_CATEGORY_ID
      ))
    ];
    if (
      builtInOrder.join("|") === LEGACY_PLAYLIST_CATEGORY_ORDER.join("|")
      || builtInOrder.join("|") === previousCommunityDefaultOrder.join("|")
    ) {
      return [
        ...DEFAULT_PLAYLIST_CATEGORY_ORDER,
        ...personalOrder.filter((id) => !DEFAULT_PLAYLIST_CATEGORY_ORDER.includes(id))
      ];
    }
    return order;
  }

  private normalizeDisabledPlaylistCategoryIds(value: unknown): string[] {
    const personalIds = this.settings.personalCategories.map((category) => category.id);
    const validIds = new Set([...DEFAULT_PLAYLIST_CATEGORY_ORDER, ...personalIds]);
    const input = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && validIds.has(id)) : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of input) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  private normalizePersonalPlaylistAssignments(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string[]> = {};
    for (const [rawKey, rawIds] of Object.entries(value as Record<string, unknown>)) {
      const key = this.cleanAssignmentKey(rawKey);
      const ids = this.normalizeAssignmentIds(rawIds);
      if (key && ids.length > 0) out[key] = ids;
    }
    return out;
  }

  private normalizePersonalFolderItemOrders(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const validCategoryIds = new Set(this.settings.personalCategories.map((category) => category.id));
    const out: Record<string, string[]> = {};
    for (const [categoryId, rawKeys] of Object.entries(value as Record<string, unknown>)) {
      if (!validCategoryIds.has(categoryId) || !Array.isArray(rawKeys)) continue;
      const seen = new Set<string>();
      const keys: string[] = [];
      for (const rawKey of rawKeys) {
        if (typeof rawKey !== "string") continue;
        const key = this.cleanAssignmentKey(rawKey);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
      if (keys.length > 0) out[categoryId] = keys;
    }
    return out;
  }

  private normalizeAssignmentIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const validIds = new Set(this.settings.personalCategories.map((category) => category.id));
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of value) {
      if (typeof id !== "string" || !validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  private removePersonalCategoryFromAssignments(categoryId: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [key, ids] of Object.entries(this.settings.personalPlaylistAssignments || {})) {
      const next = ids.filter((id) => id !== categoryId);
      if (next.length > 0) out[key] = next;
    }
    return out;
  }

  private appendItemToPersonalFolderOrder(categoryId: string, key: string): void {
    if (!categoryId || !key) return;
    const current = this.settings.personalFolderItemOrders?.[categoryId] || [];
    if (current.includes(key)) return;
    this.settings.personalFolderItemOrders = {
      ...(this.settings.personalFolderItemOrders || {}),
      [categoryId]: [...current, key]
    };
  }

  private removeItemFromPersonalFolderOrder(categoryId: string, key: string): void {
    if (!categoryId || !key) return;
    const current = this.settings.personalFolderItemOrders?.[categoryId] || [];
    const next = current.filter((value) => value !== key);
    if (next.length === current.length) return;
    const orders = { ...(this.settings.personalFolderItemOrders || {}) };
    if (next.length > 0) orders[categoryId] = next;
    else delete orders[categoryId];
    this.settings.personalFolderItemOrders = orders;
  }

  private removeItemFromAllPersonalFolderOrders(key: string): void {
    if (!key) return;
    const orders: Record<string, string[]> = {};
    for (const [categoryId, keys] of Object.entries(this.settings.personalFolderItemOrders || {})) {
      const next = keys.filter((value) => value !== key);
      if (next.length > 0) orders[categoryId] = next;
    }
    this.settings.personalFolderItemOrders = orders;
  }

  private getItemAssignmentKey(item: CatalogItem): string {
    try {
      return this.cleanAssignmentKey(normalizeSoundCloudUrl(item.url));
    } catch {
      return this.cleanAssignmentKey(item.id);
    }
  }

  private cleanAssignmentKey(value: string): string {
    return String(value || "").trim().toLowerCase();
  }

  private cleanCategoryLabel(label: string): string {
    return String(label || "").replace(/\s+/g, " ").trim().slice(0, 36);
  }

  private categoryLabelExists(label: string): boolean {
    const key = normalizePlaylistText(label);
    return ALL_PLAYLIST_CATEGORIES.some((category) => normalizePlaylistText(category.label) === key)
      || this.settings.personalCategories.some((category) => normalizePlaylistText(category.label) === key);
  }

  private getNavigationItems(): CatalogItem[] {
    const enabledItems = this.getEnabledCatalogItemsWithPersonalAssignments();
    if (enabledItems.length > 0) return enabledItems;
    return this.getRecentlyPlayedItems();
  }

  private getCatalogItemsById(): Map<string, CatalogItem> {
    const items = this.getCatalogItemsWithPersonalAssignments();
    if (this.catalogItemsByIdCache?.sourceItems === items) return this.catalogItemsByIdCache.itemsById;
    const itemsById = new Map(items.map((item) => [item.id, item]));
    this.catalogItemsByIdCache = { sourceItems: items, itemsById };
    return itemsById;
  }

  private getCatalogItemById(itemId: string): CatalogItem | null {
    if (!itemId) return null;
    return this.getCatalogItemsById().get(itemId) || null;
  }

  private getSavedSessionItem(): CatalogItem | null {
    return this.getCatalogItemById(this.settings.currentItemId);
  }

  private getStartupPlaybackItem(): CatalogItem | null {
    return this.getSavedSessionItem() || this.getDefaultItem();
  }

  getDefaultItem(): CatalogItem | null {
    const saved = this.getSavedSessionItem();
    if (saved) return saved;
    const items = this.getNavigationItems();
    return items[0] || null;
  }

  private normalizePlaybackResumeTarget(target?: PlaybackResumeTarget | null): PlaybackResumeTarget | undefined {
    const soundIndex = Math.max(0, Math.floor(Number(target?.soundIndex || 0)));
    const positionMs = Math.max(0, Math.floor(Number(target?.positionMs || 0)));
    if (soundIndex <= 0 && positionMs <= 0) return undefined;
    return { soundIndex, positionMs };
  }

  private getSavedPlaybackTarget(item: CatalogItem | null | undefined): PlaybackResumeTarget | undefined {
    if (!item || item.id !== this.settings.currentItemId) return undefined;
    return this.normalizePlaybackResumeTarget({
      soundIndex: this.settings.currentSoundIndex,
      positionMs: this.settings.currentPositionMs
    });
  }

  selectInitialItem(options: { preload?: boolean } = {}): void {
    const state = this.store.getState();
    if (state.currentItem) return;
    const item = this.getDefaultItem();
    if (!item) return;
    const resume = this.getSavedPlaybackTarget(item);
    this.store.setCurrentItem(item, resume);
    if (options.preload !== false) this.player.preload(item, resume).catch(() => undefined);
  }

  async playItem(item: CatalogItem, options: PlayItemOptions = {}): Promise<void> {
    const resume = options.resume === true
      ? this.getSavedPlaybackTarget(item)
      : this.normalizePlaybackResumeTarget(options.resume || undefined);
    this.settings.currentItemId = item.id;
    this.settings.currentSoundIndex = resume?.soundIndex ?? 0;
    this.settings.currentPositionMs = resume?.positionMs ?? 0;
    this.rememberRecentlyPlayed(item.id);
    this.saveSettingsSoon();
    await this.player.load(item, true, resume);
  }

  getRecentlyPlayedItems(): CatalogItem[] {
    if (!this.isPlaylistCategoryEnabled(RECENT_PLAYLIST_CATEGORY_ID)) return [];
    const byId = this.getCatalogItemsById();
    return this.normalizeRecentItemIds(this.settings.recentlyPlayedItemIds)
      .map((id) => byId.get(id))
      .filter(Boolean) as CatalogItem[];
  }

  getRecentArtworkUrl(item: CatalogItem | null | undefined): string | undefined {
    return item ? normalizeSoundCloudArtworkUrl(item.artworkUrl) : undefined;
  }

  async clearRecentlyPlayed(): Promise<void> {
    this.settings.recentlyPlayedItemIds = [];
    this.settings.recentlyPlayedArtworkByItemId = {};
    this.renderAll();
    this.saveSettingsSoon();
  }

  async toggleRandomPlaylistMode(): Promise<void> {
    this.settings.randomPlaylistEnabled = !this.settings.randomPlaylistEnabled;
    this.renderAll();
    this.saveSettingsSoon();
  }

  async toggleLoopTrackMode(): Promise<void> {
    this.settings.loopTrackEnabled = !this.settings.loopTrackEnabled;
    this.renderAll();
    this.saveSettingsSoon();
  }

  private getRandomPlaylistItem(): CatalogItem | null {
    const items = this.getEnabledCatalogItemsWithPersonalAssignments();
    const playlists = items.filter((item) => item.status === "active" && item.type === "playlist");
    const pool = playlists.length > 0 ? playlists : items;
    if (pool.length === 0) return null;

    const currentId = this.store.getState().currentItem?.id || this.settings.currentItemId;
    const candidates = pool.length > 1 ? pool.filter((item) => item.id !== currentId) : pool;
    return this.weightedRandomCatalogItem(candidates);
  }

  private weightedRandomCatalogItem(items: CatalogItem[]): CatalogItem | null {
    if (items.length === 0) return null;
    const weights = items.map((item) => {
      const categoryId = this.getPrimaryPlaylistCategoryId(item);
      const score = this.getCatalogItemRankingScore(item, categoryId, { randomMode: true });
      return Math.max(1, Math.min(180, 18 + score));
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let target = Math.random() * total;
    for (let index = 0; index < items.length; index++) {
      target -= weights[index];
      if (target <= 0) return items[index];
    }
    return items[items.length - 1] || null;
  }

  configureExternalAudioMonitor(): void {
    const previous = this.externalAudioMonitor;
    this.externalAudioMonitor = null;
    previous?.stop();
    this.clearExternalAudioResumeTimer();
    if (!this.settings.pauseForExternalAudio) return;

    this.externalAudioMonitor = new ExternalAudioMonitor((isActive) => this.handleExternalAudioChange(isActive));
    this.externalAudioMonitor.start();
  }

  private rememberRecentlyPlayed(itemId: string): void {
    if (!this.isPlaylistCategoryEnabled(RECENT_PLAYLIST_CATEGORY_ID)) return;
    const normalized = this.normalizeRecentItemIds([itemId, ...(this.settings.recentlyPlayedItemIds || [])]);
    this.settings.recentlyPlayedItemIds = normalized.slice(0, 30);
    this.trimRecentArtworkSnapshots();
  }

  private observePlaybackBehavior(state: PlaybackState): void {
    const item = state.currentItem;
    if (!item) {
      this.finalizeBehaviorSession("no-item");
      return;
    }

    const itemId = this.getBehaviorKey(item);
    const soundIndex = Math.max(0, Math.floor(Number(state.currentSoundIndex || 0)));
    if (!this.behaviorSession || this.behaviorSession.itemId !== itemId || this.behaviorSession.soundIndex !== soundIndex) {
      this.finalizeBehaviorSession("switch");
      this.behaviorSession = {
        itemId,
        soundIndex,
        startedAt: Date.now(),
        lastPositionMs: Math.max(0, Math.floor(Number(state.positionMs || 0))),
        maxPositionMs: Math.max(0, Math.floor(Number(state.positionMs || 0))),
        listenMs: 0,
        playCounted: false
      };
    }

    const session = this.behaviorSession;
    const positionMs = Math.max(0, Math.floor(Number(state.positionMs || 0)));
    if (state.isPlaying && !session.playCounted) {
      session.playCounted = true;
      this.updateBehaviorStats(itemId, { playCount: 1, lastPlayedAt: new Date().toISOString() });
    }

    if (state.isPlaying) {
      const delta = positionMs - session.lastPositionMs;
      if (delta > 0 && delta < 12_000) session.listenMs += delta;
    }

    session.lastPositionMs = positionMs;
    session.maxPositionMs = Math.max(session.maxPositionMs, positionMs);
  }

  private finalizeBehaviorSession(reason: "switch" | "finish" | "unload" | "no-item"): void {
    const session = this.behaviorSession;
    if (!session) return;
    this.behaviorSession = null;
    if (!session.playCounted) return;

    const listenMs = Math.max(session.listenMs, Math.min(session.maxPositionMs, Date.now() - session.startedAt));
    const update: Partial<MusicProBehaviorStats> = {};
    if (listenMs > 0 && reason !== "finish") update.totalListenMs = listenMs;
    if (reason === "switch" && listenMs < 15_000 && session.maxPositionMs < 20_000) update.skipCount = 1;
    this.updateBehaviorStats(session.itemId, update);
  }

  private recordPlaybackFinish(detail: Record<string, unknown> | undefined): void {
    const itemId = this.getBehaviorKey(this.store.getState().currentItem);
    if (!itemId) return;
    const completedMs = Math.max(0, Math.floor(Number(detail?.completedMs || this.store.getState().positionMs || 0)));
    const advertisedMs = Math.max(0, Math.floor(Number(detail?.advertisedMs || this.store.getState().durationMs || 0)));
    const unavailable = Boolean(detail?.unavailable);
    const previewLimited = Boolean(detail?.previewLimited);
    const ratio = advertisedMs > 0 ? completedMs / advertisedMs : 0;
    this.updateBehaviorStats(itemId, {
      ...(completedMs > 0 ? { totalListenMs: completedMs } : {}),
      ...(unavailable ? { unavailableCount: 1 } : {}),
      ...(previewLimited ? { previewCount: 1 } : {}),
      ...(!unavailable && !previewLimited && (ratio >= 0.68 || completedMs >= 60_000) ? { completionCount: 1 } : {}),
      ...(this.settings.loopTrackEnabled && !unavailable && !previewLimited ? { replayCount: 1 } : {})
    });
    if (unavailable || previewLimited) {
      this.refreshBehaviorRankingIfStale(true);
      this.saveSettings().catch(() => undefined);
    }
    this.finalizeBehaviorSession("finish");
  }

  private calculateBehaviorScore(stats: MusicProBehaviorStats | undefined): number {
    if (!stats) return 0;
    const daysSinceLastPlay = stats.lastPlayedAt
      ? Math.max(0, (Date.now() - new Date(stats.lastPlayedAt).getTime()) / 86_400_000)
      : Number.POSITIVE_INFINITY;
    const positive =
      Math.log1p(stats.playCount) * 4
      + stats.completionCount * 10
      + stats.replayCount * 8
      + stats.folderAddCount * 16
      + Math.log1p(stats.totalListenMs / 60_000) * 5
      + (daysSinceLastPlay < 14 ? Math.max(0, 6 - daysSinceLastPlay * 0.45) : 0);
    const negative =
      stats.skipCount * 8
      + stats.unavailableCount * 18
      + stats.previewCount * 16;
    return positive - negative;
  }

  private refreshBehaviorRankingIfStale(force = false): boolean {
    const lastUpdated = new Date(this.settings.behaviorRankingUpdatedAt || "").getTime();
    const stale = !Number.isFinite(lastUpdated) || Date.now() - lastUpdated >= BEHAVIOR_RANKING_REFRESH_INTERVAL_MS;
    if (!force && !stale) return false;
    this.settings.behaviorStats = this.normalizeBehaviorStats(this.settings.behaviorStats);
    this.settings.behaviorRankingScores = this.normalizeBehaviorRankingScores(
      Object.fromEntries(
        Object.entries(this.settings.behaviorStats || {})
          .map(([itemId, stats]) => [itemId, this.calculateBehaviorScore(stats)] as const)
          .filter(([, score]) => Math.abs(score) > 0.001)
      )
    );
    this.settings.behaviorRankingUpdatedAt = new Date().toISOString();
    this.enabledItemsCache = null;
    this.rankedItemsCache.clear();
    this.communityItemsCache = null;
    return true;
  }

  private getPersonalBehaviorScore(item: CatalogItem, _randomMode = false): number {
    const snapshotScore = Number(this.settings.behaviorRankingScores?.[this.getBehaviorKey(item)] || 0);
    return Number.isFinite(snapshotScore) ? snapshotScore : 0;
  }

  private getPrimaryPlaylistCategoryId(item: CatalogItem): string {
    return getPlaylistCategoryIds(item)
      .find((id) => id !== DEFAULT_PLAYLIST_CATEGORY_ID && id !== RECENT_PLAYLIST_CATEGORY_ID && id !== COMMUNITY_PLAYLIST_CATEGORY_ID)
      || "";
  }

  getCatalogItemRankingScore(item: CatalogItem, categoryId = "", options: { randomMode?: boolean } = {}): number {
    return getPlaylistCurationScore(item, categoryId) + this.getPersonalBehaviorScore(item, Boolean(options.randomMode));
  }

  compareCatalogItemsForUser(categoryId: string, a: CatalogItem, b: CatalogItem): number {
    const scoreDelta = this.getCatalogItemRankingScore(b, categoryId) - this.getCatalogItemRankingScore(a, categoryId);
    if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
    return comparePlaylistItemsForCategory(categoryId, a, b);
  }

  rankCatalogItemsForCategory(categoryId: string, items: CatalogItem[]): CatalogItem[] {
    if (this.isPersonalCategory(categoryId)) return this.getOrderedPersonalFolderItems(categoryId, items);
    if (categoryId === COMMUNITY_PLAYLIST_CATEGORY_ID) return this.getCommunityPlaylistItemsFromBuckets();
    const behaviorScores = this.settings.behaviorRankingScores || {};
    const behaviorUpdatedAt = this.settings.behaviorRankingUpdatedAt || "";
    const cached = this.rankedItemsCache.get(categoryId);
    if (
      cached
      && cached.sourceItems === items
      && cached.behaviorScores === behaviorScores
      && cached.behaviorUpdatedAt === behaviorUpdatedAt
    ) {
      return cached.items;
    }
    const scoreById = new Map(items.map((item) => [item.id, this.getCatalogItemRankingScore(item, categoryId)]));
    const ranked = items.slice().sort((a, b) => {
      const scoreDelta = (scoreById.get(b.id) || 0) - (scoreById.get(a.id) || 0);
      if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
      return comparePlaylistItemsForCategory(categoryId, a, b);
    });
    this.rankedItemsCache.set(categoryId, { sourceItems: items, behaviorScores, behaviorUpdatedAt, items: ranked });
    return ranked;
  }

  getCommunityPlaylistItemsFromBuckets(byCategory?: Map<string, CatalogItem[]>): CatalogItem[] {
    if (!this.isPlaylistCategoryEnabled(COMMUNITY_PLAYLIST_CATEGORY_ID)) return [];
    const allItems = byCategory ? [] : this.getCatalogItemsWithPersonalAssignments();
    const source = byCategory || allItems;
    const behaviorScores = this.settings.behaviorRankingScores || {};
    const behaviorUpdatedAt = this.settings.behaviorRankingUpdatedAt || "";
    const enabledKey = PLAYLIST_CATEGORIES
      .filter((category) => this.isPlaylistCategoryEnabled(category.id))
      .map((category) => category.id)
      .join("|");
    if (
      this.communityItemsCache?.source === source
      && this.communityItemsCache.enabledKey === enabledKey
      && this.communityItemsCache.behaviorScores === behaviorScores
      && this.communityItemsCache.behaviorUpdatedAt === behaviorUpdatedAt
    ) {
      return this.communityItemsCache.items;
    }
    const seen = new Set<string>();
    const rankedByCategory = PLAYLIST_CATEGORIES
      .filter((category) => this.isPlaylistCategoryEnabled(category.id))
      .map((category) => {
        const sourceItems = byCategory?.get(category.id) || allItems.filter((item) => itemMatchesPlaylistCategory(item, category.id));
        return this.rankCatalogItemsForCategory(category.id, sourceItems).slice(0, COMMUNITY_TOP_PER_CATEGORY);
      });
    const out: CatalogItem[] = [];
    for (let rank = 0; rank < COMMUNITY_TOP_PER_CATEGORY; rank++) {
      for (const bucket of rankedByCategory) {
        const item = bucket[rank];
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    this.communityItemsCache = { source, enabledKey, behaviorScores, behaviorUpdatedAt, items: out };
    return out;
  }

  private normalizeRecentItemIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of value) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= 30) break;
    }
    return ids;
  }

  private normalizeRecentArtworkByItemId(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const artworkById: Record<string, string> = {};
    for (const [id, url] of Object.entries(value as Record<string, unknown>)) {
      const cleanId = id.trim();
      const cleanArtworkUrl = normalizeSoundCloudArtworkUrl(url);
      if (!cleanId || !cleanArtworkUrl || !this.isUsableRecentArtworkUrl(cleanArtworkUrl)) continue;
      artworkById[cleanId] = cleanArtworkUrl;
      if (Object.keys(artworkById).length >= 30) break;
    }
    return artworkById;
  }

  private isUsableRecentArtworkUrl(url: unknown): url is string {
    return Boolean(normalizeSoundCloudArtworkUrl(url));
  }

  private trimRecentArtworkSnapshots(): void {
    const recentIds = this.normalizeRecentItemIds(this.settings.recentlyPlayedItemIds);
    if (recentIds.length === 0) {
      this.settings.recentlyPlayedArtworkByItemId = {};
      return;
    }

    const artworkById = this.normalizeRecentArtworkByItemId(this.settings.recentlyPlayedArtworkByItemId);
    const trimmed: Record<string, string> = {};
    for (const id of recentIds) {
      const artworkUrl = artworkById[id];
      if (artworkUrl) trimmed[id] = artworkUrl;
    }
    this.settings.recentlyPlayedArtworkByItemId = trimmed;
  }

  private rememberRecentArtworkSnapshot(state: PlaybackState): boolean {
    if (!this.isPlaylistCategoryEnabled(RECENT_PLAYLIST_CATEGORY_ID)) return false;
    const item = state.currentItem;
    if (!item) return false;
    const artworkUrl = this.getRecentArtworkUrl(item) || "";
    if (!this.isUsableRecentArtworkUrl(artworkUrl)) return false;

    const artworkById = this.normalizeRecentArtworkByItemId(this.settings.recentlyPlayedArtworkByItemId);
    const cleanArtworkUrl = artworkUrl.trim();
    if (artworkById[item.id] === cleanArtworkUrl) return false;

    artworkById[item.id] = cleanArtworkUrl;
    this.settings.recentlyPlayedArtworkByItemId = artworkById;
    this.trimRecentArtworkSnapshots();
    return true;
  }

  private handleExternalAudioChange(isActive: boolean): void {
    if (!this.settings.pauseForExternalAudio) return;
    if (isActive) {
      this.pauseForExternalAudio();
      return;
    }
    this.scheduleExternalAudioResume();
  }

  private pauseForExternalAudio(): void {
    this.clearExternalAudioResumeTimer();
    const state = this.store.getState();

    if (this.externalAudioPaused) {
      if (state.isPlaying) this.player.pause();
      return;
    }

    if (!state.isPlaying) return;
    this.externalAudioPaused = true;
    this.externalAudioBaseVolume = Math.max(0, Math.min(100, state.volume || this.settings.volume || 40));

    this.fadeVolumeTo(0, 700, () => {
      if (this.externalAudioMonitor?.hasExternalAudio()) {
        this.player.pause();
      } else {
        this.scheduleExternalAudioResume();
      }
    });
  }

  private scheduleExternalAudioResume(): void {
    if (!this.externalAudioPaused) return;
    this.clearExternalAudioResumeTimer();
    this.externalAudioResumeTimer = window.setTimeout(() => {
      this.externalAudioResumeTimer = null;
      if (this.externalAudioMonitor?.hasExternalAudio()) return;
      this.resumeAfterExternalAudio();
    }, 1000);
  }

  private resumeAfterExternalAudio(): void {
    if (!this.externalAudioPaused) return;
    this.externalAudioPaused = false;
    const targetVolume = Math.max(0, Math.min(100, this.settings.volume || this.externalAudioBaseVolume || 40));
    this.cancelVolumeFade();
    this.player.setVolume(0);
    this.player.play();
    this.fadeVolumeTo(targetVolume, 1000);
  }

  private fadeVolumeTo(targetVolume: number, durationMs: number, done?: () => void): void {
    this.cancelVolumeFade();
    const state = this.store.getState();
    const startVolume = Math.max(0, Math.min(100, Number(state.volume || 0)));
    const target = Math.max(0, Math.min(100, targetVolume));
    const startedAt = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const progress = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(startVolume + (target - startVolume) * eased);
      this.player.setVolume(value);
      if (progress >= 1) {
        this.cancelVolumeFade();
        done?.();
      }
    };

    tick();
    if (durationMs > 0) this.volumeFadeTimer = window.setInterval(tick, 40);
  }

  private clearExternalAudioResumeTimer(): void {
    if (!this.externalAudioResumeTimer) return;
    window.clearTimeout(this.externalAudioResumeTimer);
    this.externalAudioResumeTimer = null;
  }

  private cancelVolumeFade(): void {
    if (!this.volumeFadeTimer) return;
    window.clearInterval(this.volumeFadeTimer);
    this.volumeFadeTimer = null;
  }

  setUserVolume(volume: number, commit = false): void {
    const safeVolume = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    this.settings.volume = safeVolume;
    this.cancelVolumeFade();
    this.player.setVolume(safeVolume);

    this.clearUserVolumeSaveTimer();
    if (commit) {
      this.saveSettings().catch(() => undefined);
      return;
    }

    this.userVolumeSaveTimer = window.setTimeout(() => {
      this.userVolumeSaveTimer = null;
      this.saveSettings().catch(() => undefined);
    }, 300);
  }

  private clearUserVolumeSaveTimer(): void {
    if (!this.userVolumeSaveTimer) return;
    window.clearTimeout(this.userVolumeSaveTimer);
    this.userVolumeSaveTimer = null;
  }

  private flushUserVolumeSaveTimer(): void {
    if (!this.userVolumeSaveTimer) return;
    window.clearTimeout(this.userVolumeSaveTimer);
    this.userVolumeSaveTimer = null;
    this.saveSettings().catch(() => undefined);
  }

  private rememberPlaybackSession(state: PlaybackState, commit = false): void {
    if (!state.currentItem) return;
    const soundIndex = Math.max(0, Math.floor(Number(state.currentSoundIndex || 0)));
    const positionMs = Math.max(0, Math.floor(Number(state.positionMs || 0)));
    const savedPositionMs = Math.max(0, Math.floor(Number(this.settings.currentPositionMs || 0)));
    const artworkChanged = this.rememberRecentArtworkSnapshot(state);
    const changed = this.settings.currentItemId !== state.currentItem.id
      || this.settings.currentSoundIndex !== soundIndex
      || Math.abs(savedPositionMs - positionMs) >= 1000;

    if (!changed && !commit && !artworkChanged) return;

    this.settings.currentItemId = state.currentItem.id;
    this.settings.currentSoundIndex = soundIndex;
    this.settings.currentPositionMs = positionMs;

    if (commit) {
      this.clearPlaybackSessionSaveTimer();
      this.saveSettings().catch(() => undefined);
      return;
    }

    this.schedulePlaybackSessionSave();
  }

  private schedulePlaybackSessionSave(): void {
    if (this.playbackSessionSaveTimer) return;
    this.playbackSessionSaveTimer = window.setTimeout(() => {
      this.playbackSessionSaveTimer = null;
      this.saveSettings().catch(() => undefined);
    }, 2500);
  }

  private clearPlaybackSessionSaveTimer(): void {
    if (!this.playbackSessionSaveTimer) return;
    window.clearTimeout(this.playbackSessionSaveTimer);
    this.playbackSessionSaveTimer = null;
  }

  async playPause(): Promise<void> {
    const state = this.store.getState();
    let item = state.currentItem || this.getSavedSessionItem() || (this.settings.randomPlaylistEnabled ? this.getRandomPlaylistItem() : this.getDefaultItem());
    if (!item) {
      new Notice("Music Pro: add a SoundCloud link or refresh the catalog first.");
      return;
    }
    if (state.currentItem?.type === "playlist" && (state.currentSoundIsUnavailable || state.currentSoundIsPreview)) {
      const nextPlayable = this.getAdjacentPlayableSound("next");
      if (nextPlayable) {
        this.player.skipToSound(nextPlayable.originalIndex);
        window.setTimeout(() => this.player.play(), 180);
      } else {
        new Notice("Music Pro: no playable remaining tracks in this SoundCloud playlist.");
      }
      return;
    }
    if (!state.currentItem || !state.isReady) {
      await this.playItem(item, { resume: true });
      return;
    }
    this.player.toggle();
  }

  async next(): Promise<void> {
    const state = this.store.getState();
    if (state.currentItem?.type === "playlist" && state.soundList.length > 0) {
      const next = this.getAdjacentPlayableSound("next");
      if (next) {
        this.player.skipToSound(next.originalIndex);
        return;
      }
    }
    await this.nextCatalogItem();
  }

  async previous(): Promise<void> {
    const state = this.store.getState();
    if (state.currentItem?.type === "playlist" && state.soundList.length > 0) {
      const previous = this.getAdjacentPlayableSound("previous");
      if (previous) {
        this.player.skipToSound(previous.originalIndex);
        return;
      }
    }
    await this.previousCatalogItem();
  }

  skipToPlaylistTrack(index: number): void {
    const target = this.store.getState().soundList.find((sound) => sound.originalIndex === index);
    if (target && !this.isAutoplayFitSound(target)) {
      new Notice(`Music Pro: ${target.unplayableReason || "this track is unavailable or preview-only in the SoundCloud embed."}`);
      return;
    }
    const wasPlaying = this.store.getState().isPlaying;
    this.player.skipToSound(index);
    if (!wasPlaying) window.setTimeout(() => this.player.play(), 220);
  }

  getOrderedSounds(): SoundCloudSound[] {
    const state = this.store.getState();
    const item = state.currentItem;
    const sounds = state.soundList || [];
    if (!item || sounds.length === 0) return sounds;
    const order = this.settings.playlistTrackOrders[item.id] || [];
    if (order.length === 0) return sounds;
    const orderSignature = order.join("|");
    if (
      this.orderedSoundsCache?.itemId === item.id
      && this.orderedSoundsCache.sounds === sounds
      && this.orderedSoundsCache.orderSignature === orderSignature
    ) {
      return this.orderedSoundsCache.ordered;
    }
    const byId = new Map(sounds.map((sound) => [sound.id, sound]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean) as SoundCloudSound[];
    const orderedIds = new Set(order);
    const remaining = sounds.filter((sound) => !orderedIds.has(sound.id));
    const out = [...ordered, ...remaining];
    this.orderedSoundsCache = { itemId: item.id, sounds, orderSignature, ordered: out };
    return out;
  }

  getCurrentOrderedSoundPosition(): number {
    const state = this.store.getState();
    const ordered = this.getOrderedSounds();
    const index = ordered.findIndex((sound) => sound.originalIndex === state.currentSoundIndex);
    return index === -1 ? state.currentSoundIndex : index;
  }

  async reorderCurrentPlaylistTrack(sourceSoundId: string, targetSoundId: string, placement: "before" | "after" = "before"): Promise<void> {
    const item = this.store.getState().currentItem;
    if (!item) return;
    const ordered = this.getOrderedSounds();
    const from = ordered.findIndex((sound) => sound.id === sourceSoundId);
    if (from === -1 || sourceSoundId === targetSoundId) return;
    const [moved] = ordered.splice(from, 1);
    const targetIndex = ordered.findIndex((sound) => sound.id === targetSoundId);
    if (targetIndex === -1) return;
    ordered.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, moved);
    this.settings.playlistTrackOrders[item.id] = ordered.map((sound) => sound.id);
    this.renderAll();
    this.saveSettingsSoon();
  }

  private async handleTrackFinish(event?: CustomEvent): Promise<void> {
    const unavailable = Boolean(event?.detail?.unavailable);
    const previewLimited = Boolean(event?.detail?.previewLimited);
    const restricted = unavailable || previewLimited || Boolean(event?.detail?.widgetError);
    this.recordPlaybackFinish(event?.detail as Record<string, unknown> | undefined);
    if (this.settings.loopTrackEnabled && !restricted) {
      this.resetRestrictedTrackBurst();
      this.player.seekTo(0);
      this.player.play();
      return;
    }

    const state = this.store.getState();
    if (state.currentItem?.type === "playlist" && state.soundList.length > 1) {
      const restrictedBurstCount = restricted ? this.recordRestrictedTrackBurst(state.currentItem.id) : 0;
      if (!restricted) this.resetRestrictedTrackBurst(state.currentItem.id);
      if (restrictedBurstCount >= RESTRICTED_TRACK_BURST_LIMIT) {
        await this.skipDegradedPlaylist();
        return;
      }

      const failedIndex = Math.max(0, Math.floor(Number(event?.detail?.soundIndex ?? state.currentSoundIndex)));
      const next = this.getAdjacentPlayableSound("next", failedIndex);
      if (next) {
        this.player.skipToSound(next.originalIndex);
        if (restricted) window.setTimeout(() => this.player.play(), 160);
        return;
      }
      if (restricted) {
        this.player.pause();
        this.store.setState({
          isLoading: false,
          isPlaying: false,
          error: "SoundCloud exposed this playlist, but the remaining tracks are preview-only or unavailable in the embedded player."
        });
        this.renderAll();
        return;
      }
    }
    this.resetRestrictedTrackBurst();
    await this.nextCatalogItem();
  }

  private getAdjacentPlayableSound(direction: "next" | "previous", fromOriginalIndex?: number): SoundCloudSound | null {
    const state = this.store.getState();
    const ordered = this.getOrderedSounds();
    if (ordered.length === 0) return null;
    const origin = Number.isFinite(fromOriginalIndex) ? Math.floor(Number(fromOriginalIndex)) : state.currentSoundIndex;
    const activePos = ordered.findIndex((sound) => sound.originalIndex === origin);
    const start = activePos === -1 ? (direction === "next" ? -1 : ordered.length) : activePos;
    const step = direction === "next" ? 1 : -1;
    for (let pos = start + step; pos >= 0 && pos < ordered.length; pos += step) {
      const candidate = ordered[pos];
      if (candidate && this.isAutoplayFitSound(candidate)) return candidate;
    }
    return null;
  }

  private isAutoplayFitSound(sound: SoundCloudSound): boolean {
    return sound.isPlayable !== false && !sound.isPreview;
  }

  private recordRestrictedTrackBurst(itemId: string): number {
    const now = Date.now();
    if (
      !this.restrictedTrackBurst
      || this.restrictedTrackBurst.itemId !== itemId
      || now - this.restrictedTrackBurst.startedAt > RESTRICTED_TRACK_BURST_WINDOW_MS
    ) {
      this.restrictedTrackBurst = { itemId, startedAt: now, count: 1 };
      return 1;
    }
    this.restrictedTrackBurst.count += 1;
    return this.restrictedTrackBurst.count;
  }

  private resetRestrictedTrackBurst(itemId?: string): void {
    if (!this.restrictedTrackBurst) return;
    if (itemId && this.restrictedTrackBurst.itemId !== itemId) return;
    this.restrictedTrackBurst = null;
  }

  private async skipDegradedPlaylist(): Promise<void> {
    const current = this.store.getState().currentItem;
    if (current) {
      this.updateBehaviorStats(this.getBehaviorKey(current), {
        unavailableCount: 1,
        previewCount: 1
      });
      this.refreshBehaviorRankingIfStale(true);
      this.saveSettings().catch(() => undefined);
    }
    this.resetRestrictedTrackBurst();
    await this.nextCatalogItem();
  }

  private async nextCatalogItem(): Promise<void> {
    if (this.settings.randomPlaylistEnabled) {
      const random = this.getRandomPlaylistItem();
      if (random) {
        await this.playItem(random);
        return;
      }
    }

    const items = this.getNavigationItems();
    if (items.length === 0) return;
    const current = this.store.getState().currentItem;
    const index = current ? items.findIndex((item) => item.id === current.id) : -1;
    const next = items[(index + 1 + items.length) % items.length];
    await this.playItem(next);
  }

  private async previousCatalogItem(): Promise<void> {
    const items = this.getNavigationItems();
    if (items.length === 0) return;
    const current = this.store.getState().currentItem;
    const index = current ? items.findIndex((item) => item.id === current.id) : 0;
    const previous = items[(index - 1 + items.length) % items.length];
    await this.playItem(previous);
  }

  async addUserSoundCloudUrl(url: string, categories: string[]): Promise<AddUserSoundCloudResult> {
    const result = await this.catalog.addUserSoundCloudUrl(url, categories.length ? categories : ["User"]);
    if (result.item.type !== "playlist") new Notice("Music Pro: this is a single track.");
    this.assignedItemsCache = null;
    this.enabledItemsCache = null;
    this.renderAll();
    return result;
  }


  async moveUserItem(itemId: string, direction: "up" | "down"): Promise<void> {
    await this.catalog.moveUserItem(itemId, direction);
    this.assignedItemsCache = null;
    this.enabledItemsCache = null;
    this.renderAll();
  }

  async removeUserItem(itemId: string): Promise<void> {
    const removingCurrent = this.store.getState().currentItem?.id === itemId;
    const item = this.catalog.getItems().find((entry) => entry.id === itemId);
    const assignmentKey = item ? this.getItemAssignmentKey(item) : "";
    await this.catalog.removeUserItem(itemId);
    this.assignedItemsCache = null;
    this.enabledItemsCache = null;
    if (assignmentKey) this.removeItemFromAllPersonalFolderOrders(assignmentKey);
    if (assignmentKey && this.settings.personalPlaylistAssignments?.[assignmentKey]) {
      const { [assignmentKey]: _removed, ...rest } = this.settings.personalPlaylistAssignments;
      this.settings.personalPlaylistAssignments = rest;
      await this.saveSettings();
    }
    if (removingCurrent) {
      this.player.pause();
      const fallback = this.getDefaultItem();
      this.store.setCurrentItem(fallback);
      if (fallback) this.player.preload(fallback).catch(() => undefined);
      this.settings.currentItemId = fallback?.id || "";
      await this.saveSettings();
    }
    this.renderAll();
  }

  async refreshCatalog(force: boolean, quiet = false): Promise<void> {
    const rankingChanged = this.refreshBehaviorRankingIfStale();
    const changed = await this.catalog.refreshRemoteCatalog(force, quiet);
    if (changed || rankingChanged) {
      this.renderAll();
      if (!this.store.getState().currentItem) this.selectInitialItem();
      if (rankingChanged) this.saveSettings().catch(() => undefined);
    }
  }

  async checkBrokenSoundCloudLinks(limit = 80): Promise<void> {
    const candidates = this.catalog.getItems().filter((item) => item.status === "active").slice(0, limit);
    if (candidates.length === 0) {
      new Notice("Music Pro: no active SoundCloud links to check.");
      return;
    }

    new Notice(`Music Pro: checking ${candidates.length} SoundCloud links…`);
    const broken: CatalogItem[] = [];
    for (const [index, item] of candidates.entries()) {
      try {
        assertEmbeddableSoundCloudUrl(item.url);
        await this.catalog.fetchOEmbed(item.url);
      } catch {
        broken.push(item);
      }
      if (index < candidates.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    }

    if (broken.length > 0) {
      const brokenUrls = new Set(broken.map((item) => {
        try {
          return normalizeSoundCloudUrl(item.url).toLowerCase();
        } catch {
          return item.url.toLowerCase();
        }
      }));
      let changed = false;
      this.settings.userItems = this.settings.userItems.map((item) => {
        const key = (() => {
          try {
            return normalizeSoundCloudUrl(item.url).toLowerCase();
          } catch {
            return item.url.toLowerCase();
          }
        })();
        if (!brokenUrls.has(key) || item.status === "broken") return item;
        changed = true;
        return {
          ...item,
          status: "broken",
          tags: [...new Set([...(item.tags || []), "broken-link"])]
        };
      });
      if (changed) {
        this.catalog.reloadFromSettings(this.settings);
        this.assignedItemsCache = null;
        this.enabledItemsCache = null;
        await this.saveSettings();
        this.renderAll();
      }
    }

    new Notice(broken.length === 0
      ? `Music Pro: checked ${candidates.length} links — no broken links found.`
      : `Music Pro: ${broken.length}/${candidates.length} links look broken. User links were marked broken when matched.`);
  }

  openQuickPicker(): void {
    new QuickPickerModal(this).open();
  }

  async openInlineAddMode(): Promise<void> {
    await this.setMode("sidebar");
    const leaf = this.app.workspace.getLeavesOfType(MUSIC_PRO_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof MusicProSidebarView) view.openAddMode();
  }

  async shutdown(): Promise<void> {
    this.rememberPlaybackSession(this.store.getState(), true);
    this.cancelVolumeFade();
    this.clearExternalAudioResumeTimer();
    this.externalAudioPaused = false;
    this.player.pause();
    this.store.setState({ mode: "sidebar", isPlaying: false, isLoading: false });
    await this.closeSidebar();
    this.renderChrome();
  }

  async toggleMode(): Promise<void> {
    await this.setMode(this.store.getState().mode === "sidebar" ? "mini" : "sidebar");
  }

  async setMode(mode: PlayerMode): Promise<void> {
    const currentMode = this.store.getState().mode;
    this.settings.viewMode = mode;
    if (!this.store.getState().currentItem) this.selectInitialItem();
    this.saveSettingsSoon();
    if (mode === "sidebar") {
      await this.openSidebar();
      if (currentMode !== mode) this.store.setMode(mode);
    } else {
      if (currentMode !== mode) this.store.setMode(mode);
      await this.closeSidebar();
    }
  }

  async openSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MUSIC_PRO_VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: MUSIC_PRO_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async closeSidebar(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(MUSIC_PRO_VIEW_TYPE);
    for (const leaf of leaves) await leaf.detach();
  }

  renderChrome(): void {
    this.miniDock?.refresh();
  }

  renderAll(): void {
    this.renderChrome();
    for (const leaf of this.app.workspace.getLeavesOfType(MUSIC_PRO_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof MusicProSidebarView) view.render();
    }
  }

  private registerFullNameTooltip(): void {
    document.addEventListener("pointerover", this.fullNamePointerOverHandler, { passive: true });
    document.addEventListener("pointerout", this.fullNamePointerOutHandler, { passive: true });
    document.addEventListener("focusin", this.fullNameFocusInHandler);
    document.addEventListener("focusout", this.fullNameFocusOutHandler);
    document.addEventListener("scroll", this.fullNameLayoutHandler, true);
    window.addEventListener("resize", this.fullNameLayoutHandler);
    document.addEventListener("keydown", this.fullNameKeydownHandler);
    this.register(() => {
      document.removeEventListener("pointerover", this.fullNamePointerOverHandler);
      document.removeEventListener("pointerout", this.fullNamePointerOutHandler);
      document.removeEventListener("focusin", this.fullNameFocusInHandler);
      document.removeEventListener("focusout", this.fullNameFocusOutHandler);
      document.removeEventListener("scroll", this.fullNameLayoutHandler, true);
      window.removeEventListener("resize", this.fullNameLayoutHandler);
      document.removeEventListener("keydown", this.fullNameKeydownHandler);
      this.destroyFullNameTooltip();
    });
  }

  private handleFullNamePointerOver(event: PointerEvent): void {
    const target = this.getFullNameTooltipTarget(event.target);
    if (target) this.showFullNameTooltip(target);
  }

  private handleFullNamePointerOut(event: PointerEvent): void {
    const target = this.getFullNameTooltipTarget(event.target);
    if (!target || target !== this.fullNameTooltipTarget) return;
    const related = event.relatedTarget;
    if (related instanceof Node && target.contains(related)) return;
    this.scheduleHideFullNameTooltip();
  }

  private handleFullNameFocusIn(event: FocusEvent): void {
    const target = this.getFullNameTooltipTarget(event.target);
    if (target) this.showFullNameTooltip(target);
  }

  private getFullNameTooltipTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest<HTMLElement>("[data-music-pro-full-name]");
  }

  private showFullNameTooltip(target: HTMLElement): void {
    const text = (target.getAttribute("data-music-pro-full-name") || "").trim();
    if (!text || !this.shouldShowFullNameTooltip(target, text)) {
      this.hideFullNameTooltip();
      return;
    }

    if (this.fullNameTooltipHideTimer !== null) {
      window.clearTimeout(this.fullNameTooltipHideTimer);
      this.fullNameTooltipHideTimer = null;
    }

    if (!this.fullNameTooltipEl) {
      this.fullNameTooltipEl = document.body.createDiv({ cls: "music-pro-full-name-tooltip", attr: { role: "tooltip" } });
    }

    this.fullNameTooltipTarget?.removeClass("music-pro-full-name-source");
    this.fullNameTooltipTarget = target;
    target.addClass("music-pro-full-name-source");
    this.applyAccentToElement(this.fullNameTooltipEl);
    this.fullNameTooltipEl.setText(text);
    this.fullNameTooltipEl.removeClass("is-visible");
    this.fullNameTooltipEl.style.left = "0px";
    this.fullNameTooltipEl.style.top = "-9999px";
    this.scheduleFullNameTooltipPosition(true);
  }

  private shouldShowFullNameTooltip(target: HTMLElement, fullName: string): boolean {
    if (target.getAttribute("data-music-pro-full-name-force") === "true") return true;
    const visibleText = (target.textContent || "").trim();
    if (fullName && visibleText && fullName !== visibleText) return true;
    return target.scrollWidth > target.clientWidth + 2 || target.scrollHeight > target.clientHeight + 2;
  }

  private scheduleFullNameTooltipPosition(showAfterPosition = false): void {
    if (!this.fullNameTooltipEl || !this.fullNameTooltipTarget) return;
    if (this.fullNameTooltipRaf !== null) window.cancelAnimationFrame(this.fullNameTooltipRaf);
    this.fullNameTooltipRaf = window.requestAnimationFrame(() => {
      this.fullNameTooltipRaf = null;
      this.positionFullNameTooltip();
      if (showAfterPosition) this.fullNameTooltipEl?.addClass("is-visible");
    });
  }

  private positionFullNameTooltip(): void {
    const tooltip = this.fullNameTooltipEl;
    const target = this.fullNameTooltipTarget;
    if (!tooltip || !target || !document.body.contains(target)) {
      this.hideFullNameTooltip();
      return;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
      this.hideFullNameTooltip();
      return;
    }

    const viewportPadding = 12;
    tooltip.style.maxWidth = `${Math.min(520, window.innerWidth - viewportPadding * 2)}px`;

    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tooltipWidth - viewportPadding));

    let top = rect.top - tooltipHeight - 10;
    const showBelow = top < viewportPadding;
    if (showBelow) top = rect.bottom + 10;

    const anchor = Math.max(14, Math.min(tooltipWidth - 14, rect.left + rect.width / 2 - left));
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.setProperty("--music-pro-tooltip-anchor", `${Math.round(anchor)}px`);
    tooltip.toggleClass("is-below", showBelow);
  }

  private scheduleHideFullNameTooltip(): void {
    if (this.fullNameTooltipHideTimer !== null) window.clearTimeout(this.fullNameTooltipHideTimer);
    this.fullNameTooltipHideTimer = window.setTimeout(() => {
      this.fullNameTooltipHideTimer = null;
      this.hideFullNameTooltip();
    }, 70);
  }

  private hideFullNameTooltip(): void {
    if (this.fullNameTooltipHideTimer !== null) {
      window.clearTimeout(this.fullNameTooltipHideTimer);
      this.fullNameTooltipHideTimer = null;
    }
    if (this.fullNameTooltipRaf !== null) {
      window.cancelAnimationFrame(this.fullNameTooltipRaf);
      this.fullNameTooltipRaf = null;
    }
    this.fullNameTooltipTarget?.removeClass("music-pro-full-name-source");
    this.fullNameTooltipTarget = null;
    this.fullNameTooltipEl?.removeClass("is-visible");
  }

  private destroyFullNameTooltip(): void {
    this.hideFullNameTooltip();
    this.fullNameTooltipEl?.remove();
    this.fullNameTooltipEl = null;
  }
}
