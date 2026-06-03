import type { CatalogItem } from "../catalog/types";
import type { PlaybackListener, PlaybackResumeTarget, PlaybackState, PlayerMode } from "./types";

export class PlayerStore {
  private listeners = new Set<PlaybackListener>();
  private state: PlaybackState;

  constructor(initial: Partial<PlaybackState> = {}) {
    this.state = {
      currentItem: null,
      isReady: false,
      isPlaying: false,
      isLoading: false,
      volume: 40,
      mode: "mini",
      error: null,
      positionMs: 0,
      durationMs: 0,
      soundList: [],
      soundListVersion: 0,
      currentSoundIndex: 0,
      currentSoundTitle: "",
      currentSoundArtist: "",
      currentSoundArtworkUrl: "",
      currentSoundIsPreview: false,
      currentSoundIsUnavailable: false,
      currentSoundUnavailableReason: "",
      playlistReady: false,
      ...initial
    };
  }

  getState(): PlaybackState {
    return this.state;
  }

  setState(update: Partial<PlaybackState>): void {
    const keys = Object.keys(update) as (keyof PlaybackState)[];
    const hasChangedValue = keys.some((key) => update[key] !== this.state[key]);
    if (!hasChangedValue) return;
    const next = { ...this.state, ...update };
    if (Object.prototype.hasOwnProperty.call(update, "soundList") && update.soundList !== this.state.soundList) {
      next.soundListVersion = (this.state.soundListVersion || 0) + 1;
    }
    this.state = next;
    this.emit();
  }

  setCurrentItem(item: CatalogItem | null, resume?: PlaybackResumeTarget): void {
    const soundIndex = item ? Math.max(0, Math.floor(Number(resume?.soundIndex || 0))) : 0;
    const positionMs = item ? Math.max(0, Math.floor(Number(resume?.positionMs || 0))) : 0;
    this.setState({
      currentItem: item,
      positionMs,
      durationMs: 0,
      error: null,
      soundList: [],
      currentSoundIndex: soundIndex,
      currentSoundTitle: "",
      currentSoundArtist: "",
      currentSoundArtworkUrl: "",
      currentSoundIsPreview: false,
      currentSoundIsUnavailable: false,
      currentSoundUnavailableReason: "",
      playlistReady: false
    });
  }

  setMode(mode: PlayerMode): void {
    this.setState({ mode });
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
