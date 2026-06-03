type AudioAwareWebview = HTMLElement & {
  isCurrentlyAudible?: () => boolean;
  isAudioMuted?: () => boolean;
};

type ExternalAudioListener = (isActive: boolean) => void;

interface WatchedElement {
  element: Element;
  cleanup: () => void;
}

/**
 * Best-effort audio focus detector for Obsidian/Electron.
 *
 * Works for:
 * - Electron <webview> based browser panes via media-started-playing/media-paused
 *   and isCurrentlyAudible().
 * - Native <audio>/<video> elements rendered in Obsidian's main DOM.
 *
 * It intentionally ignores Music Pro's own hidden SoundCloud iframe/player host.
 */
export class ExternalAudioMonitor {
  private listener: ExternalAudioListener;
  private observer: MutationObserver | null = null;
  private pollTimer: number | null = null;
  private scanTimer: number | null = null;
  private watched = new Map<Element, WatchedElement>();
  private activeEventSources = new Set<Element>();
  private isActive = false;

  constructor(listener: ExternalAudioListener) {
    this.listener = listener;
  }

  start(): void {
    this.scan();
    this.observer = new MutationObserver(() => this.scheduleScan());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.pollTimer = window.setInterval(() => this.recompute(), 800);
    this.recompute();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanTimer) window.clearTimeout(this.scanTimer);
    this.scanTimer = null;
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const watched of this.watched.values()) watched.cleanup();
    this.watched.clear();
    this.activeEventSources.clear();
    this.setActive(false);
  }

  hasExternalAudio(): boolean {
    return this.isActive;
  }

  private scan(): void {
    this.scanTimer = null;
    const candidates = [
      ...Array.from(document.querySelectorAll("webview")),
      ...Array.from(document.querySelectorAll("audio, video"))
    ].filter((element) => !this.isIgnored(element));

    const current = new Set(candidates);
    for (const element of candidates) {
      if (this.watched.has(element)) continue;
      if (element.tagName.toLowerCase() === "webview") this.watchWebview(element as AudioAwareWebview);
      else this.watchMediaElement(element as HTMLMediaElement);
    }

    for (const [element, watched] of this.watched.entries()) {
      if (document.contains(element) && current.has(element)) continue;
      watched.cleanup();
      this.watched.delete(element);
      this.activeEventSources.delete(element);
    }

    this.recompute();
  }

  private scheduleScan(): void {
    if (this.scanTimer !== null) return;
    this.scanTimer = window.setTimeout(() => this.scan(), 120);
  }

  private watchWebview(webview: AudioAwareWebview): void {
    const markActive = () => {
      this.activeEventSources.add(webview);
      this.recompute();
    };
    const markInactive = () => {
      this.activeEventSources.delete(webview);
      window.setTimeout(() => this.recompute(), 50);
    };

    webview.addEventListener("media-started-playing", markActive);
    webview.addEventListener("media-paused", markInactive);
    webview.addEventListener("destroyed", markInactive);

    this.watched.set(webview, {
      element: webview,
      cleanup: () => {
        webview.removeEventListener("media-started-playing", markActive);
        webview.removeEventListener("media-paused", markInactive);
        webview.removeEventListener("destroyed", markInactive);
      }
    });
  }

  private watchMediaElement(media: HTMLMediaElement): void {
    const recompute = () => this.recompute();
    const events = ["play", "playing", "pause", "ended", "volumechange", "emptied", "stalled"];
    for (const event of events) media.addEventListener(event, recompute);

    this.watched.set(media, {
      element: media,
      cleanup: () => {
        for (const event of events) media.removeEventListener(event, recompute);
      }
    });
  }

  private recompute(): void {
    const watchedElements = [...this.watched.keys()].filter((element) => document.contains(element) && !this.isIgnored(element));
    const hasWebviewAudio = watchedElements
      .filter((element) => element.tagName.toLowerCase() === "webview")
      .some((element) => this.isWebviewAudible(element as AudioAwareWebview));

    const hasMediaAudio = watchedElements
      .filter((element) => {
        const tag = element.tagName.toLowerCase();
        return tag === "audio" || tag === "video";
      })
      .some((element) => this.isMediaAudible(element as HTMLMediaElement));

    const hasEventAudio = Array.from(this.activeEventSources).some((element) => document.contains(element) && !this.isIgnored(element));

    this.setActive(hasWebviewAudio || hasMediaAudio || hasEventAudio);
  }

  private isWebviewAudible(webview: AudioAwareWebview): boolean {
    try {
      if (typeof webview.isAudioMuted === "function" && webview.isAudioMuted()) return false;
      if (typeof webview.isCurrentlyAudible === "function") return webview.isCurrentlyAudible();
    } catch {
      return this.activeEventSources.has(webview);
    }
    return this.activeEventSources.has(webview);
  }

  private isMediaAudible(media: HTMLMediaElement): boolean {
    return !media.paused
      && !media.ended
      && media.readyState > 0
      && !media.muted
      && media.volume > 0;
  }

  private isIgnored(element: Element): boolean {
    return Boolean(element.closest(".music-pro-player-host, .music-pro-mini-dock, .music-pro-view-container"));
  }

  private setActive(value: boolean): void {
    if (this.isActive === value) return;
    this.isActive = value;
    this.listener(value);
  }
}
