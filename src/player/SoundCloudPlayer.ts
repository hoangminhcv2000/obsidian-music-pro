import { requestUrl } from "obsidian";
import type { CatalogItem } from "../catalog/types";
import { assertEmbeddableSoundCloudUrl, normalizeSoundCloudArtworkUrl } from "../utils/normalize";
import type { PlayerStore } from "./PlayerStore";
import type { PlaybackResumeTarget, SoundCloudSound } from "./types";

interface SoundCloudWidget {
  bind(eventName: string, listener: (...args: any[]) => void): void;
  unbind(eventName: string): void;
  load(url: string, options: Record<string, any>): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seekTo(milliseconds: number): void;
  setVolume(volume: number): void;
  next?(): void;
  prev?(): void;
  skip?(soundIndex: number): void;
  getDuration(callback: (value: number) => void): void;
  getPosition(callback: (value: number) => void): void;
  getSounds?(callback: (value: any[]) => void): void;
  getCurrentSound?(callback: (value: any) => void): void;
  getCurrentSoundIndex?(callback: (value: number) => void): void;
  destroy?(): void;
}

const SOUNDCLOUD_WIDGET_ORIGIN = "https://w.soundcloud.com";
const SOUNDCLOUD_WIDGET_EVENTS = {
  LOAD_PROGRESS: "loadProgress",
  PLAY_PROGRESS: "playProgress",
  PLAY: "play",
  PAUSE: "pause",
  FINISH: "finish",
  SEEK: "seek",
  READY: "ready",
  ERROR: "error"
} as const;
const EXCLUDED_PLAYLIST_TRACK_MAX_DURATION_MS = 30_000;
const PLAYLIST_METADATA_CACHE_MS = 6 * 60 * 60 * 1000;
const PLAYLIST_METADATA_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
const POSITION_EMIT_MIN_INTERVAL_MS = 250;

function makeSoundCloudEmbedUrl(url: string, options: Record<string, any> = {}): string {
  const params = new URLSearchParams();
  params.set("url", url);
  for (const [key, value] of Object.entries(options)) {
    if (key === "callback" || value === undefined || value === null) continue;
    params.set(key, key === "start_track" ? String(parseInt(String(value), 10) || 0) : value ? "true" : "false");
  }
  return `${SOUNDCLOUD_WIDGET_ORIGIN}/player/?${params.toString()}`;
}

class SoundCloudWidgetBridge implements SoundCloudWidget {
  private iframe: HTMLIFrameElement;
  private isReady = false;
  private playEventFired = false;
  private eventCallbacks = new Map<string, Set<(...args: any[]) => void>>();
  private responseCallbacks = new Map<string, Array<(value: any) => void>>();
  private handleMessage = (event: MessageEvent) => this.onMessage(event);

  constructor(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
    window.addEventListener("message", this.handleMessage, false);
  }

  destroy(): void {
    window.removeEventListener("message", this.handleMessage, false);
    this.eventCallbacks.clear();
    this.responseCallbacks.clear();
  }

  bind(eventName: string, listener: (...args: any[]) => void): void {
    const callbacks = this.eventCallbacks.get(eventName) || new Set<(...args: any[]) => void>();
    callbacks.add(listener);
    this.eventCallbacks.set(eventName, callbacks);
    if (eventName === SOUNDCLOUD_WIDGET_EVENTS.READY && this.isReady) {
      window.setTimeout(() => listener(), 1);
      return;
    }
    if (this.isReady) this.send("addEventListener", eventName);
  }

  unbind(eventName: string): void {
    this.eventCallbacks.delete(eventName);
    if (this.isReady && eventName !== SOUNDCLOUD_WIDGET_EVENTS.READY) {
      this.send("removeEventListener", eventName);
    }
  }

  load(url: string, options: Record<string, any>): void {
    this.isReady = false;
    this.playEventFired = false;
    if (typeof options.callback === "function") {
      const onReady = () => {
        this.eventCallbacks.get(SOUNDCLOUD_WIDGET_EVENTS.READY)?.delete(onReady);
        options.callback();
      };
      this.bind(SOUNDCLOUD_WIDGET_EVENTS.READY, onReady);
    }
    this.iframe.src = makeSoundCloudEmbedUrl(url, options);
  }

  play(): void {
    this.send("play");
  }

  pause(): void {
    this.send("pause");
  }

  toggle(): void {
    this.send("toggle");
  }

  seekTo(milliseconds: number): void {
    this.send("seekTo", milliseconds);
  }

  setVolume(volume: number): void {
    this.send("setVolume", volume);
  }

  next(): void {
    this.send("next");
  }

  prev(): void {
    this.send("prev");
  }

  skip(soundIndex: number): void {
    this.send("skip", soundIndex);
  }

  getDuration(callback: (value: number) => void): void {
    this.request("getDuration", callback);
  }

  getPosition(callback: (value: number) => void): void {
    this.request("getPosition", callback);
  }

  getSounds(callback: (value: any[]) => void): void {
    this.request("getSounds", callback);
  }

  getCurrentSound(callback: (value: any) => void): void {
    this.request("getCurrentSound", callback);
  }

  getCurrentSoundIndex(callback: (value: number) => void): void {
    this.request("getCurrentSoundIndex", callback);
  }

  private request<T>(method: string, callback: (value: T) => void): void {
    const callbacks = this.responseCallbacks.get(method) || [];
    callbacks.push(callback as (value: any) => void);
    this.responseCallbacks.set(method, callbacks);
    this.send(method);
  }

  private send(method: string, value?: unknown): void {
    const target = this.iframe.contentWindow;
    if (!target) return;
    target.postMessage(JSON.stringify({ method, value }), SOUNDCLOUD_WIDGET_ORIGIN);
  }

  private onMessage(event: MessageEvent): void {
    if (event.source !== this.iframe.contentWindow) return;
    if (event.origin && event.origin !== SOUNDCLOUD_WIDGET_ORIGIN) return;
    let payload: { method?: string; value?: any };
    try {
      payload = JSON.parse(String(event.data || "{}"));
    } catch {
      return;
    }
    const method = String(payload.method || "");
    if (!method) return;
    if (method === SOUNDCLOUD_WIDGET_EVENTS.READY) {
      this.isReady = true;
      for (const eventName of this.eventCallbacks.keys()) {
        if (eventName !== SOUNDCLOUD_WIDGET_EVENTS.READY) this.send("addEventListener", eventName);
      }
    }
    if (method === SOUNDCLOUD_WIDGET_EVENTS.PLAY) this.playEventFired = true;
    if (method === SOUNDCLOUD_WIDGET_EVENTS.PLAY_PROGRESS && !this.playEventFired) {
      this.playEventFired = true;
      this.emit(SOUNDCLOUD_WIDGET_EVENTS.PLAY, payload.value);
    }
    this.emit(method, payload.value);
  }

  private emit(method: string, value: any): void {
    const args = value === undefined ? [] : [value];
    const responseCallbacks = this.responseCallbacks.get(method);
    if (responseCallbacks?.length) {
      this.responseCallbacks.delete(method);
      for (const callback of responseCallbacks) callback(value);
    }
    for (const callback of this.eventCallbacks.get(method) || []) {
      callback(...args);
    }
  }
}

export class SoundCloudPlayer {
  private store: PlayerStore;
  private hostEl: HTMLElement | null = null;
  private iframeEl: HTMLIFrameElement | null = null;
  private widget: SoundCloudWidget | null = null;
  private currentUrl: string | null = null;
  private progressTimer: number | null = null;
  private loadTimeout: number | null = null;
  private lastSoundPollSecond = -1;
  private lastKnownPositionMs = 0;
  private lastPositionEmitAt = 0;
  private lastPositionEmitMs = -1;
  private playableDurationOverrides = new Map<string, number>();
  private unplayableSoundReasons = new Map<string, string>();
  private lastPlayAttemptAt = 0;
  private loadToken = 0;
  private pendingWidgetLoadToken = 0;
  private playlistHydrationToken = 0;
  private lastHydrationKey = "";
  private playlistTrackMetadataCache = new Map<string, { tracks: any[]; cachedAt: number }>();
  private playlistTrackMetadataFailureAt = new Map<string, number>();

  constructor(store: PlayerStore) {
    this.store = store;
  }

  destroy(): void {
    if (this.progressTimer) window.clearInterval(this.progressTimer);
    if (this.loadTimeout) window.clearTimeout(this.loadTimeout);
    this.progressTimer = null;
    this.loadTimeout = null;
    this.hostEl?.remove();
    this.hostEl = null;
    this.iframeEl = null;
    this.widget?.destroy?.();
    this.widget = null;
    this.loadToken += 1;
    this.playlistHydrationToken += 1;
  }

  async preload(item: CatalogItem, resume?: PlaybackResumeTarget): Promise<void> {
    if (this.currentUrl === item.url) return;
    await this.load(item, false, resume);
  }

  async load(item: CatalogItem, autoplay: boolean, resume?: PlaybackResumeTarget): Promise<void> {
    const loadToken = ++this.loadToken;
    const resumeTarget = this.normalizeResumeTarget(resume);
    this.pendingWidgetLoadToken = loadToken;
    this.currentUrl = item.url;
    this.stopProgressTimer();
    this.store.setState({
      currentItem: item,
      isLoading: true,
      error: null,
      isReady: false,
      positionMs: resumeTarget?.positionMs ?? 0,
      durationMs: 0,
      soundList: [],
      currentSoundIndex: resumeTarget?.soundIndex ?? 0,
      currentSoundTitle: "",
      currentSoundArtist: "",
      currentSoundArtworkUrl: "",
      currentSoundIsPreview: false,
      currentSoundIsUnavailable: false,
      currentSoundUnavailableReason: "",
      playlistReady: false
    });
    try {
      assertEmbeddableSoundCloudUrl(item.url);
      if (!this.isCurrentLoad(loadToken, item)) return;
      this.ensureIframe(item.url);
      if (!this.iframeEl) throw new Error("SoundCloud widget is not available.");
      if (!this.widget) {
        this.widget = new SoundCloudWidgetBridge(this.iframeEl);
        this.bindWidgetEvents();
      }
      this.lastKnownPositionMs = resumeTarget?.positionMs ?? 0;
      this.playableDurationOverrides.clear();
      this.unplayableSoundReasons.clear();
      this.lastPlayAttemptAt = Date.now();
      const hydrationToken = ++this.playlistHydrationToken;
      this.lastHydrationKey = "";
      this.lastPositionEmitAt = 0;
      this.lastPositionEmitMs = resumeTarget?.positionMs ?? 0;
      this.startLoadWatchdog(item.url);
      const widgetAutoplay = autoplay && !resumeTarget;
      this.widget.load(item.url, {
        auto_play: widgetAutoplay,
        buying: false,
        sharing: false,
        download: false,
        show_artwork: false,
        show_comments: false,
        show_playcount: false,
        show_user: false,
        hide_related: true,
        visual: false,
        single_active: true,
        callback: () => {
          if (!this.isCurrentLoad(loadToken, item) || this.currentUrl !== item.url) return;
          this.pendingWidgetLoadToken = 0;
          this.clearLoadWatchdog();
          this.widget?.setVolume(this.store.getState().volume);
          this.store.setState({ isReady: true, isLoading: false, error: null });
          this.updateDuration(loadToken);
          if (resumeTarget) this.applyResumeTarget(resumeTarget, autoplay, loadToken);
          else this.updatePlaylistState(loadToken);
          this.schedulePlaylistMetadataHydration(item, hydrationToken);
          if (autoplay && !resumeTarget) this.play();
        }
      });
    } catch (error) {
      if (!this.isCurrentLoad(loadToken, item)) return;
      this.pendingWidgetLoadToken = 0;
      this.clearLoadWatchdog();
      this.store.setState({ isLoading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private isCurrentLoad(token: number, item?: CatalogItem): boolean {
    if (token !== this.loadToken) return false;
    if (!item) return true;
    const current = this.store.getState().currentItem;
    return current?.id === item.id && current.url === item.url;
  }

  private hasPendingWidgetLoad(): boolean {
    return this.pendingWidgetLoadToken > 0;
  }

  play(): void {
    this.lastPlayAttemptAt = Date.now();
    this.widget?.play();
  }

  pause(): void {
    this.widget?.pause();
  }

  toggle(): void {
    if (this.store.getState().isPlaying) this.pause();
    else this.play();
  }

  setVolume(volume: number): void {
    this.widget?.setVolume(volume);
    this.store.setState({ volume });
  }

  nextSound(): void {
    this.lastSoundPollSecond = -1;
    this.widget?.next?.();
    window.setTimeout(() => this.updatePlaylistState(), 180);
  }

  previousSound(): void {
    this.lastSoundPollSecond = -1;
    this.widget?.prev?.();
    window.setTimeout(() => this.updatePlaylistState(), 180);
  }

  skipToSound(index: number): void {
    this.lastSoundPollSecond = -1;
    const target = this.store.getState().soundList.find((sound) => sound.originalIndex === index);
    this.store.setState({
      currentSoundIndex: index,
      positionMs: 0,
      currentSoundIsPreview: Boolean(target?.isPreview),
      currentSoundIsUnavailable: target?.isPlayable === false,
      currentSoundUnavailableReason: target?.unplayableReason || ""
    });
    this.lastKnownPositionMs = 0;
    this.lastPlayAttemptAt = Date.now();
    this.widget?.skip?.(index);
    window.setTimeout(() => this.updatePlaylistState(), 180);
  }

  seekTo(ms: number): void {
    const durationMs = this.store.getState().durationMs;
    const target = durationMs > 0 ? Math.min(durationMs, Math.max(0, ms)) : Math.max(0, ms);
    this.emitPosition(target, true);
    this.widget?.seekTo(target);
  }

  private normalizeResumeTarget(resume?: PlaybackResumeTarget): Required<PlaybackResumeTarget> | null {
    const soundIndex = Math.max(0, Math.floor(Number(resume?.soundIndex || 0)));
    const positionMs = Math.max(0, Math.floor(Number(resume?.positionMs || 0)));
    if (soundIndex <= 0 && positionMs <= 0) return null;
    return { soundIndex, positionMs };
  }

  private applyResumeTarget(target: Required<PlaybackResumeTarget>, autoplay: boolean, loadToken = this.loadToken): void {
    if (!this.isCurrentLoad(loadToken)) return;
    const soundIndex = Math.max(0, target.soundIndex || 0);
    const positionMs = Math.max(0, target.positionMs || 0);
    const hasSkipTarget = soundIndex > 0 && Boolean(this.widget?.skip);

    this.lastSoundPollSecond = -1;
    this.lastKnownPositionMs = positionMs;
    this.store.setState({ currentSoundIndex: soundIndex, positionMs });

    if (hasSkipTarget) this.widget?.skip?.(soundIndex);

    const settleDelay = hasSkipTarget ? 300 : 90;
    window.setTimeout(() => {
      if (!this.isCurrentLoad(loadToken)) return;
      if (positionMs > 0) this.seekTo(positionMs);
      else this.store.setState({ positionMs: 0 });
      this.updatePlaylistState(loadToken);
      if (autoplay) {
        window.setTimeout(() => {
          if (this.isCurrentLoad(loadToken)) this.play();
        }, positionMs > 0 ? 80 : 0);
      }
    }, settleDelay);
  }

  private ensureIframe(url: string): void {
    if (!this.hostEl) {
      this.hostEl = document.body.createDiv({ cls: "music-pro-player-host" });
    }
    if (!this.iframeEl) {
      this.iframeEl = document.createElement("iframe");
      this.iframeEl.setAttribute("allow", "autoplay");
      this.iframeEl.setAttribute("scrolling", "no");
      this.iframeEl.setAttribute("frameborder", "no");
      this.iframeEl.className = "music-pro-soundcloud-frame";
      this.hostEl.appendChild(this.iframeEl);
    }
    if (!this.iframeEl.src) {
      this.iframeEl.src = this.makeEmbedUrl(url, false);
    }
  }

  private makeEmbedUrl(url: string, autoplay: boolean): string {
    const params = new URLSearchParams({
      url,
      auto_play: String(autoplay),
      buying: "false",
      sharing: "false",
      download: "false",
      show_artwork: "false",
      show_comments: "false",
      show_playcount: "false",
      show_user: "false",
      hide_related: "true",
      visual: "false",
      single_active: "true"
    });
    return `https://w.soundcloud.com/player/?${params.toString()}`;
  }

  private bindWidgetEvents(): void {
    const events = SOUNDCLOUD_WIDGET_EVENTS;
    if (!this.widget) return;
    this.widget.bind(events.READY, () => {
      if (this.hasPendingWidgetLoad()) return;
      this.clearLoadWatchdog();
      this.store.setState({ isReady: true, isLoading: false, error: null });
      this.updateDuration();
      this.updatePlaylistState();
      this.schedulePlaylistMetadataHydration();
    });
    this.widget.bind(events.PLAY, () => {
      if (this.hasPendingWidgetLoad()) return;
      this.clearLoadWatchdog();
      this.lastPlayAttemptAt = Date.now();
      this.store.setState({ isPlaying: true, isLoading: false, error: null });
      this.updatePlaylistState();
      this.schedulePlaylistMetadataHydration();
      this.startProgressTimer();
    });
    this.widget.bind(events.PAUSE, () => {
      if (this.hasPendingWidgetLoad()) return;
      this.store.setState({ isPlaying: false });
      this.stopProgressTimer();
      this.updatePosition();
    });
    this.widget.bind(events.FINISH, () => {
      if (this.hasPendingWidgetLoad()) return;
      const state = this.store.getState();
      const completedMs = Math.max(state.positionMs || 0, this.lastKnownPositionMs || 0);
      const advertisedMs = state.durationMs || 0;
      const activeSound = state.soundList.find((sound) => sound.originalIndex === state.currentSoundIndex) || state.soundList[state.currentSoundIndex];
      const previewLimited = this.isLikelyPreviewFinish(completedMs, advertisedMs);
      const unavailable = !previewLimited && this.isLikelyUnavailableFinish(completedMs, advertisedMs, Date.now() - this.lastPlayAttemptAt);
      const playableDurationMs = previewLimited ? this.roundPlayableDuration(completedMs) : advertisedMs;
      if (previewLimited) this.applyPreviewLimitedSound(playableDurationMs);
      if (unavailable && activeSound) this.applyUnplayableSound(activeSound.id, "Unavailable in SoundCloud embed");
      this.store.setState({
        isPlaying: false,
        positionMs: previewLimited ? playableDurationMs : 0,
        ...(previewLimited ? { durationMs: playableDurationMs, currentSoundIsPreview: true } : {}),
        ...(unavailable ? {
          currentSoundIsUnavailable: true,
          currentSoundUnavailableReason: "Unavailable in SoundCloud embed"
        } : {})
      });
      this.stopProgressTimer();
      document.dispatchEvent(new CustomEvent("music-pro:finish", {
        detail: {
          previewLimited,
          unavailable,
          soundId: activeSound?.id || "",
          soundIndex: activeSound?.originalIndex ?? state.currentSoundIndex,
          completedMs,
          advertisedMs,
          playableDurationMs
        }
      }));
    });
    if (events.ERROR) {
      this.widget.bind(events.ERROR, (event: unknown) => this.handleWidgetError(event));
    }
    if (events.PLAY_PROGRESS) {
      this.widget.bind(events.PLAY_PROGRESS, (event: { currentPosition?: number }) => {
        if (this.hasPendingWidgetLoad()) return;
        if (typeof event?.currentPosition === "number") {
          this.emitPosition(event.currentPosition);
          const second = Math.floor(event.currentPosition / 1000);
          if (second % 5 === 0 && second !== this.lastSoundPollSecond) {
            this.lastSoundPollSecond = second;
            this.updateCurrentSound();
          }
        }
      });
    }
  }

  private handleWidgetError(_event: unknown): void {
    if (this.hasPendingWidgetLoad()) return;
    const state = this.store.getState();
    const activeSound = state.soundList.find((sound) => sound.originalIndex === state.currentSoundIndex) || state.soundList[state.currentSoundIndex];
    if (activeSound) this.applyUnplayableSound(activeSound.id, "SoundCloud embed error");
    this.store.setState({
      isLoading: false,
      isPlaying: false,
      currentSoundIsUnavailable: true,
      currentSoundUnavailableReason: "SoundCloud embed error"
    });
    this.stopProgressTimer();
    document.dispatchEvent(new CustomEvent("music-pro:finish", {
      detail: {
        unavailable: true,
        widgetError: true,
        soundId: activeSound?.id || "",
        soundIndex: activeSound?.originalIndex ?? state.currentSoundIndex,
        completedMs: Math.max(state.positionMs || 0, this.lastKnownPositionMs || 0),
        advertisedMs: state.durationMs || 0,
        playableDurationMs: 0
      }
    }));
  }


  private startProgressTimer(): void {
    if (this.progressTimer) return;
    this.progressTimer = window.setInterval(() => this.updatePosition(), 1000);
  }

  private startLoadWatchdog(url: string): void {
    this.clearLoadWatchdog();
    this.loadTimeout = window.setTimeout(() => {
      this.loadTimeout = null;
      if (this.currentUrl !== url || !this.store.getState().isLoading) return;
      this.store.setState({
        isLoading: false,
        isReady: false,
        isPlaying: false,
        error: "SoundCloud did not load this link. Try a normal public track or /sets/ playlist URL."
      });
    }, 12_000);
  }

  private clearLoadWatchdog(): void {
    if (!this.loadTimeout) return;
    window.clearTimeout(this.loadTimeout);
    this.loadTimeout = null;
  }

  private stopProgressTimer(): void {
    if (!this.progressTimer) return;
    window.clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private updateDuration(loadToken?: number): void {
    this.widget?.getDuration((durationMs) => {
      if (loadToken !== undefined && !this.isCurrentLoad(loadToken)) return;
      const state = this.store.getState();
      const active = this.findSoundByOriginalIndex(state.soundList, state.currentSoundIndex) || state.soundList[state.currentSoundIndex];
      const preferredDuration = active?.durationMs || durationMs || 0;
      this.store.setState({
        durationMs: preferredDuration,
        currentSoundIsPreview: Boolean(active?.isPreview || state.currentSoundIsPreview)
      });
    });
  }

  private updatePosition(): void {
    this.widget?.getPosition((positionMs) => {
      this.emitPosition(positionMs || 0, true);
    });
  }

  private emitPosition(positionMs: number, force = false): void {
    const safePosition = Math.max(0, Number(positionMs) || 0);
    this.lastKnownPositionMs = safePosition;
    const now = Date.now();
    if (
      !force
      && this.lastPositionEmitMs >= 0
      && now - this.lastPositionEmitAt < POSITION_EMIT_MIN_INTERVAL_MS
      && Math.abs(safePosition - this.lastPositionEmitMs) < POSITION_EMIT_MIN_INTERVAL_MS
    ) {
      return;
    }
    this.lastPositionEmitAt = now;
    this.lastPositionEmitMs = safePosition;
    this.store.setState({ positionMs: safePosition });
  }

  private updatePlaylistState(loadToken?: number): void {
    if (loadToken !== undefined && !this.isCurrentLoad(loadToken)) return;
    const widget = this.widget;
    if (!widget?.getSounds) {
      this.updateCurrentSound(loadToken);
      return;
    }
    widget.getSounds((rawSounds) => {
      if (loadToken !== undefined && !this.isCurrentLoad(loadToken)) return;
      const state = this.store.getState();
      const soundList = this.filterAutoplayUnfitPlaylistSounds(this.mergeSoundLists(
        state.soundList,
        (rawSounds || []).map((raw, index) => this.normalizeSound(raw, index))
      ));
      const previousIndex = state.currentSoundIndex;
      if (!soundList.length) {
        this.store.setState({ soundList: [], playlistReady: true });
        return;
      }
      if (widget.getCurrentSoundIndex) {
        widget.getCurrentSoundIndex((index) => {
          if (loadToken !== undefined && !this.isCurrentLoad(loadToken)) return;
          const fallbackIndex = previousIndex >= 0 && previousIndex < soundList.length ? previousIndex : 0;
          const rawIndex = Number.isFinite(index) ? index : fallbackIndex;
          const active = this.findSoundByOriginalIndex(soundList, rawIndex)
            || this.findNextSoundAtOrAfter(soundList, rawIndex)
            || soundList[0];
          this.skipFilteredCurrentSound(rawIndex, active);
          this.store.setState({
            soundList,
            currentSoundIndex: active.originalIndex,
            currentSoundTitle: active.title,
            currentSoundArtist: active.artist,
            currentSoundArtworkUrl: active.artworkUrl || "",
            currentSoundIsPreview: Boolean(active.isPreview),
            currentSoundIsUnavailable: active.isPlayable === false,
            currentSoundUnavailableReason: active.unplayableReason || "",
            durationMs: active.durationMs || this.store.getState().durationMs,
            playlistReady: true
          });
          this.updateCurrentSound(loadToken);
        });
      } else {
        const active = soundList[0];
          this.store.setState({
            soundList,
            currentSoundIndex: active.originalIndex,
            currentSoundTitle: active.title,
            currentSoundArtist: active.artist,
            currentSoundArtworkUrl: active.artworkUrl || "",
            currentSoundIsPreview: Boolean(active.isPreview),
            currentSoundIsUnavailable: active.isPlayable === false,
            currentSoundUnavailableReason: active.unplayableReason || "",
            durationMs: active.durationMs || this.store.getState().durationMs,
            playlistReady: true
        });
      }
    });
  }

  private updateCurrentSound(loadToken?: number): void {
    if (loadToken !== undefined && !this.isCurrentLoad(loadToken)) return;
    const widget = this.widget;
    if (!widget?.getCurrentSound) return;
    widget.getCurrentSound((raw) => {
      if (loadToken !== undefined && !this.isCurrentLoad(loadToken)) return;
      if (!raw) return;
      const state = this.store.getState();
      const active = this.normalizeSound(raw, state.currentSoundIndex);
      const existing = state.soundList.find((sound) => sound.id === active.id || sound.originalIndex === active.originalIndex);
      const mergedActive = this.mergeSound(existing, active);
      const soundList = this.filterAutoplayUnfitPlaylistSounds(state.soundList.length
        ? state.soundList.map((sound) => (
          sound.id === mergedActive.id || sound.originalIndex === mergedActive.originalIndex
            ? this.mergeSound(sound, mergedActive)
            : sound
        ))
        : [mergedActive]);
      const soundListChanged = !this.areSoundListsEqual(state.soundList, soundList);
      const visibleActive = this.findSoundByOriginalIndex(soundList, mergedActive.originalIndex)
        || this.findNextSoundAtOrAfter(soundList, mergedActive.originalIndex)
        || soundList[0]
        || mergedActive;
      this.skipFilteredCurrentSound(mergedActive.originalIndex, visibleActive);
      this.store.setState({
        ...(soundListChanged ? { soundList } : {}),
        currentSoundIndex: visibleActive.originalIndex,
        currentSoundTitle: visibleActive.title,
        currentSoundArtist: visibleActive.artist,
        currentSoundArtworkUrl: visibleActive.artworkUrl || "",
        currentSoundIsPreview: Boolean(visibleActive.isPreview),
        currentSoundIsUnavailable: visibleActive.isPlayable === false,
        currentSoundUnavailableReason: visibleActive.unplayableReason || "",
        durationMs: visibleActive.durationMs || this.store.getState().durationMs
      });
    });
    if (widget.getCurrentSoundIndex) {
      widget.getCurrentSoundIndex((index) => {
        if (loadToken !== undefined && !this.isCurrentLoad(loadToken)) return;
        if (Number.isFinite(index)) {
          const rawIndex = Math.max(0, Math.floor(index));
          const soundList = this.store.getState().soundList;
          const active = this.findSoundByOriginalIndex(soundList, rawIndex)
            || this.findNextSoundAtOrAfter(soundList, rawIndex)
            || soundList[0];
          if (active) {
            this.skipFilteredCurrentSound(rawIndex, active);
            this.store.setState({ currentSoundIndex: active.originalIndex });
          } else {
            this.store.setState({ currentSoundIndex: rawIndex });
          }
        }
      });
    }
  }


  private normalizeDurationMs(raw: any): number {
    // SoundCloud can expose both `duration` and `full_duration`.
    // In embedded/player contexts, `duration` is the playable duration that users actually hear.
    // `full_duration` can point to the original/full track length and may be wrong for 30s previews.
    const playable = Number(raw?.duration || 0);
    const full = Number(raw?.full_duration || 0);
    if (Number.isFinite(playable) && playable > 0) return playable;
    if (Number.isFinite(full) && full > 0) return full;
    return 0;
  }

  private normalizeSound(raw: any, index: number): SoundCloudSound {
    const artist = raw?.user?.username || raw?.publisher_metadata?.artist || raw?.user?.permalink || "SoundCloud";
    const permalinkTitle = raw?.permalink ? String(raw.permalink).replace(/[-_]+/g, " ") : "";
    const title = raw?.title || raw?.caption || permalinkTitle || `Track ${index + 1}`;
    const id = String(raw?.id ?? raw?.permalink_url ?? index);
    const overrideDurationMs = this.playableDurationOverrides.get(id);
    const rawUnplayableReason = this.getRawUnplayableReason(raw);
    const unplayableReason = this.unplayableSoundReasons.get(id) || rawUnplayableReason || "";
    const isPreview = Boolean(overrideDurationMs || this.isRawPreviewLimited(raw));
    const artworkUrl = normalizeSoundCloudArtworkUrl(raw?.artwork_url);
    return {
      id,
      title: String(title),
      artist: String(artist),
      durationMs: overrideDurationMs || this.normalizeDurationMs(raw),
      originalIndex: index,
      ...(isPreview ? { isPreview: true } : {}),
      ...(unplayableReason ? { isPlayable: false, unplayableReason } : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
      ...(raw?.permalink_url ? { permalinkUrl: String(raw.permalink_url) } : {})
    };
  }

  private mergeSoundLists(previous: SoundCloudSound[], incoming: SoundCloudSound[]): SoundCloudSound[] {
    if (previous.length === 0) return incoming;
    const previousById = new Map(previous.map((sound) => [sound.id, sound]));
    const previousByIndex = new Map(previous.map((sound) => [sound.originalIndex, sound]));
    return incoming.map((sound) => this.mergeSound(previousById.get(sound.id) || previousByIndex.get(sound.originalIndex), sound));
  }

  private filterAutoplayUnfitPlaylistSounds(sounds: SoundCloudSound[]): SoundCloudSound[] {
    if (this.store.getState().currentItem?.type !== "playlist") return sounds;
    // Keep unknown-duration placeholder rows until SoundCloud hydration reveals a real
    // verdict. Once known, preview-only, blocked, unembeddable, or very short
    // playlist tracks are removed from the visible track list.
    return sounds.filter((sound) => !this.isAutoplayUnfitPlaylistSound(sound));
  }

  private isAutoplayUnfitPlaylistSound(sound: SoundCloudSound): boolean {
    if (sound.isPlayable === false || sound.isPreview) return true;
    return sound.durationMs > 0 && sound.durationMs <= EXCLUDED_PLAYLIST_TRACK_MAX_DURATION_MS;
  }

  private findSoundByOriginalIndex(sounds: SoundCloudSound[], originalIndex: number): SoundCloudSound | undefined {
    return sounds.find((sound) => sound.originalIndex === originalIndex);
  }

  private findNextSoundAtOrAfter(sounds: SoundCloudSound[], originalIndex: number): SoundCloudSound | undefined {
    return sounds.find((sound) => sound.originalIndex >= originalIndex) || sounds[0];
  }

  private skipFilteredCurrentSound(rawIndex: number, active: SoundCloudSound | undefined): void {
    if (!active || this.store.getState().currentItem?.type !== "playlist") return;
    if (active.originalIndex === rawIndex) return;
    this.widget?.skip?.(active.originalIndex);
  }

  private mergeSound(previous: SoundCloudSound | undefined, incoming: SoundCloudSound): SoundCloudSound {
    if (!previous) return incoming;
    const previousPlaceholder = this.isPlaceholderSound(previous);
    const incomingPlaceholder = this.isPlaceholderSound(incoming);
    const preferPreviousText = incomingPlaceholder && !previousPlaceholder;
    const isUnplayable = previous.isPlayable === false || incoming.isPlayable === false;
    return {
      ...incoming,
      title: preferPreviousText ? previous.title : (incoming.title || previous.title),
      artist: preferPreviousText || (incoming.artist === "SoundCloud" && previous.artist && previous.artist !== "SoundCloud")
        ? previous.artist
        : (incoming.artist || previous.artist),
      durationMs: incoming.durationMs || previous.durationMs || 0,
      artworkUrl: incoming.artworkUrl || previous.artworkUrl,
      permalinkUrl: incoming.permalinkUrl || previous.permalinkUrl,
      isPreview: Boolean(incoming.isPreview || previous.isPreview) || undefined,
      ...(isUnplayable ? { isPlayable: false, unplayableReason: incoming.unplayableReason || previous.unplayableReason } : {})
    };
  }

  private isPlaceholderSound(sound: SoundCloudSound): boolean {
    return /^Track\s+\d+$/i.test(sound.title.trim())
      && (!sound.artist || sound.artist === "SoundCloud")
      && !sound.durationMs
      && !sound.permalinkUrl
      && !sound.artworkUrl;
  }

  private schedulePlaylistMetadataHydration(item = this.store.getState().currentItem, token = this.playlistHydrationToken): void {
    if (!item || item.type !== "playlist" || !this.currentUrl) return;
    const key = `${token}:${this.currentUrl}`;
    if (this.lastHydrationKey === key) return;
    this.lastHydrationKey = key;
    this.hydratePlaylistMetadata(this.currentUrl, token).catch(() => {
      if (this.lastHydrationKey === key) this.lastHydrationKey = "";
    });
  }

  private async hydratePlaylistMetadata(url: string, token: number): Promise<void> {
    const rawTracks = await this.fetchSoundCloudPlaylistTracks(url);
    if (token !== this.playlistHydrationToken || this.currentUrl !== url || rawTracks.length === 0) return;
    const hydratedList = rawTracks.map((raw, index) => this.normalizeSound(raw, index));
    const state = this.store.getState();
    const soundList = this.filterAutoplayUnfitPlaylistSounds(this.mergeSoundLists(state.soundList, hydratedList));
    if (soundList.length === 0) {
      this.store.setState({ soundList: [], playlistReady: true });
      return;
    }
    const active = this.findSoundByOriginalIndex(soundList, state.currentSoundIndex)
      || this.findNextSoundAtOrAfter(soundList, state.currentSoundIndex)
      || soundList[0];
    this.skipFilteredCurrentSound(state.currentSoundIndex, active);
    this.store.setState({
      soundList,
      currentSoundIndex: active.originalIndex,
      currentSoundTitle: active.title,
      currentSoundArtist: active.artist,
      currentSoundArtworkUrl: active.artworkUrl || "",
      currentSoundIsPreview: Boolean(active.isPreview),
      currentSoundIsUnavailable: active.isPlayable === false,
      currentSoundUnavailableReason: active.unplayableReason || "",
      durationMs: active.durationMs || state.durationMs,
      playlistReady: true
    });
  }

  private async fetchSoundCloudPlaylistTracks(url: string): Promise<any[]> {
    const now = Date.now();
    const cached = this.playlistTrackMetadataCache.get(url);
    if (cached && now - cached.cachedAt < PLAYLIST_METADATA_CACHE_MS) return cached.tracks;

    const failedAt = this.playlistTrackMetadataFailureAt.get(url) || 0;
    if (failedAt && now - failedAt < PLAYLIST_METADATA_FAILURE_BACKOFF_MS) return [];

    let tracks: any[] = [];
    let clientId = "";
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      const hydration = this.extractSoundCloudHydration(response.text || "");
      const playlist = hydration.find((entry) => entry?.hydratable === "playlist")?.data;
      tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
      clientId = String(hydration.find((entry) => entry?.hydratable === "apiClient")?.data?.id || "");
    } catch {
      this.playlistTrackMetadataFailureAt.set(url, now);
      return [];
    }
    if (tracks.length === 0) {
      this.playlistTrackMetadataFailureAt.set(url, now);
      return [];
    }

    if (!clientId) {
      this.playlistTrackMetadataCache.set(url, { tracks, cachedAt: now });
      this.playlistTrackMetadataFailureAt.delete(url);
      return tracks;
    }

    const fullById = new Map<string, any>();
    const shallowIds: string[] = [];
    for (const track of tracks) {
      const id = String(track?.id || "");
      if (!id) continue;
      if (this.hasUsefulRawTrackMetadata(track)) fullById.set(id, track);
      else shallowIds.push(id);
    }

    for (const chunk of this.chunk(shallowIds, 50)) {
      if (chunk.length === 0) continue;
      try {
        const endpoint = `https://api-v2.soundcloud.com/tracks?ids=${encodeURIComponent(chunk.join(","))}&client_id=${encodeURIComponent(clientId)}`;
        const apiResponse = await requestUrl({
          url: endpoint,
          method: "GET",
          headers: { Accept: "application/json" }
        });
        const hydratedTracks: any[] = Array.isArray(apiResponse.json) ? apiResponse.json : [];
        for (const track of hydratedTracks) {
          const id = String(track?.id || "");
          if (id) fullById.set(id, track);
        }
      } catch {
        // The widget can still play the playlist even if public metadata hydration
        // is blocked/rate-limited. Keep the shallow rows instead of failing load.
      }
    }

    const hydratedTracks = tracks.map((track) => {
      const id = String(track?.id || "");
      return (id && fullById.get(id)) || track;
    });
    this.playlistTrackMetadataCache.set(url, { tracks: hydratedTracks, cachedAt: Date.now() });
    this.playlistTrackMetadataFailureAt.delete(url);
    return hydratedTracks;
  }

  private extractSoundCloudHydration(html: string): any[] {
    const match = html.match(/window\.__sc_hydration\s*=\s*([\s\S]*?);<\/script>/);
    if (!match?.[1]) return [];
    try {
      const data = JSON.parse(match[1]);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private hasUsefulRawTrackMetadata(raw: any): boolean {
    return Boolean(raw?.title || raw?.duration || raw?.full_duration || raw?.permalink_url || raw?.user?.username);
  }

  private areSoundListsEqual(a: SoundCloudSound[], b: SoundCloudSound[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      const left = a[index];
      const right = b[index];
      if (
        left.id !== right.id
        || left.title !== right.title
        || left.artist !== right.artist
        || left.durationMs !== right.durationMs
        || left.originalIndex !== right.originalIndex
        || left.isPreview !== right.isPreview
        || left.isPlayable !== right.isPlayable
        || left.unplayableReason !== right.unplayableReason
        || left.artworkUrl !== right.artworkUrl
        || left.permalinkUrl !== right.permalinkUrl
      ) {
        return false;
      }
    }
    return true;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private getRawUnplayableReason(raw: any): string {
    const policy = String(raw?.policy || "").toUpperCase();
    const state = String(raw?.state || "").toLowerCase();
    const sharing = String(raw?.sharing || "").toLowerCase();
    const embeddableBy = String(raw?.embeddable_by || "").toLowerCase();
    // Music Pro is released for anonymous/free embedded playback. Treat public
    // SoundCloud SNIP/BLOCK metadata as autoplay-unfit so users never see a list
    // full of 30-second previews or region/account-restricted tracks.
    if (policy === "SNIP") return "Preview-only in SoundCloud embed";
    if (policy === "BLOCK") return "Restricted by SoundCloud embed";
    if (state && state !== "finished") return "Unavailable";
    if (sharing === "private") return "Private";
    if (embeddableBy && embeddableBy !== "all") return "Not publicly embeddable";
    return "";
  }

  private isRawPreviewLimited(raw: any): boolean {
    const policy = String(raw?.policy || "").toUpperCase();
    if (policy === "SNIP") return true;
    const playable = Number(raw?.duration || 0);
    const full = Number(raw?.full_duration || 0);
    if (!Number.isFinite(playable) || !Number.isFinite(full)) return false;
    if (playable < 15_000 || playable > 70_000) return false;
    if (full < 60_000) return false;
    if (full - playable < 20_000) return false;
    return playable / full < 0.72;
  }

  private isLikelyPreviewFinish(completedMs: number, advertisedMs: number): boolean {
    if (!Number.isFinite(completedMs) || !Number.isFinite(advertisedMs)) return false;
    if (completedMs < 15_000 || completedMs > 70_000) return false;
    if (advertisedMs < 60_000) return false;
    if (advertisedMs - completedMs < 20_000) return false;
    return completedMs / advertisedMs < 0.72;
  }

  private isLikelyUnavailableFinish(completedMs: number, advertisedMs: number, elapsedSinceAttemptMs: number): boolean {
    if (!Number.isFinite(completedMs) || !Number.isFinite(advertisedMs)) return false;
    if (advertisedMs < 10_000) return false;
    if (completedMs > 2_000) return false;
    return elapsedSinceAttemptMs < 4_500;
  }

  private roundPlayableDuration(completedMs: number): number {
    return Math.max(1_000, Math.ceil(completedMs / 1_000) * 1_000);
  }

  private applyPreviewLimitedSound(durationMs: number): void {
    const state = this.store.getState();
    const active = this.findSoundByOriginalIndex(state.soundList, state.currentSoundIndex) || state.soundList[state.currentSoundIndex];
    if (!active) return;
    this.playableDurationOverrides.set(active.id, durationMs);
    const soundList = this.filterAutoplayUnfitPlaylistSounds(state.soundList.map((sound) => (
      sound.id === active.id ? { ...sound, durationMs, isPreview: true, isPlayable: false, unplayableReason: "Preview-only in SoundCloud embed" } : sound
    )));
    this.store.setState({
      soundList,
      durationMs,
      currentSoundIsPreview: true
    });
  }

  private applyUnplayableSound(soundId: string, reason: string): void {
    if (!soundId) return;
    this.unplayableSoundReasons.set(soundId, reason);
    const state = this.store.getState();
    const soundList = this.filterAutoplayUnfitPlaylistSounds(state.soundList.map((sound) => (
      sound.id === soundId ? { ...sound, isPlayable: false, unplayableReason: reason } : sound
    )));
    this.store.setState({
      soundList,
      currentSoundIsUnavailable: true,
      currentSoundUnavailableReason: reason
    });
  }
}
