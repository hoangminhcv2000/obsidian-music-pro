#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { findDuplicatePlaylistGroups, inferTypeFromUrl, makeDisplayTitle, normalizeCatalog, normalizeSoundCloudUrl, readCatalog, validateCatalog } from "./catalog-utils.mjs";
import { compareCatalogItemsForCategory, getPlaylistSortProfile } from "./playlist-category-rules.mjs";

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

check("catalog validates", async () => {
  const catalog = await readCatalog();
  const errors = validateCatalog(catalog);
  assert(errors.length === 0, errors.join("; "));
});

check("catalog has at least 500 playlist items", async () => {
  const catalog = await readCatalog();
  const playlistItems = catalog.items.filter((item) => item.type === "playlist");
  const nonPlaylistItems = catalog.items.filter((item) => item.type !== "playlist");
  assert(playlistItems.length >= 500, `expected >=500 playlist items, got ${playlistItems.length}`);
  assert(nonPlaylistItems.every((item) => item.categories.includes("Editor's Choice")), "non-playlist catalog items should be explicit manual Editor's Choice picks only");
});

check("catalog playlist taxonomy categories are present", async () => {
  const catalog = await readCatalog();
  const categories = new Set(catalog.items.flatMap((item) => item.categories));
  for (const required of ["Ambience", "Jazz & Blues", "Movies/Games", "Handpan & Kalimba", "House", "Acoustic", "Fantasy Folk", "Bossa", "Asia", "Middle East"]) {
    assert(categories.has(required), `missing category ${required}`);
  }
  for (const removed of ["Rock/Metal", "Other"]) {
    assert(!categories.has(removed), `removed category should not appear: ${removed}`);
  }
  const legacyBossaCategories = [...categories].filter((category) => /bossa\s+nova|bossanova/i.test(category));
  assert(legacyBossaCategories.length === 0, `legacy Bossa category should not appear: ${legacyBossaCategories[0] || ""}`);
  const legacyBossaDisplays = catalog.items.filter((item) => /bossa\s+nova|bossanova/i.test(item.displayTitle || ""));
  assert(legacyBossaDisplays.length === 0, `displayTitle should store Bossa, not legacy Bossa wording: ${legacyBossaDisplays[0]?.id || ""}`);
});

check("playlist category descriptions stay concise and user-facing", async () => {
  const taxonomy = await readFile(new URL("../src/catalog/playlistCategories.ts", import.meta.url), "utf8");
  const descriptions = taxonomy.split("\n").map((line) => line.match(/description:\s*"([^"]+)"/)?.[1]).filter(Boolean);
  assert(descriptions.length >= 12, "expected playlist category descriptions");
  for (const description of descriptions) {
    assert(description.length <= 76, `category description too long: ${description}`);
    assert(/[a-z]/.test(description), `category description should read like user copy: ${description}`);
  }
  const descriptionText = descriptions.join(" ").toLowerCase();
  for (const banned of ["manual picks only", "franchise-only", "game/movie titles", "taxonomy", "fallback", "osts", "vault", "system", "ai map", "auto-fill"]) {
    assert(!descriptionText.includes(banned), `category descriptions should avoid technical/internal wording: ${banned}`);
  }
});

check("folder intro descriptions read like user benefits", async () => {
  const taxonomy = await readFile(new URL("../src/catalog/playlistCategories.ts", import.meta.url), "utf8");
  assert(taxonomy.includes('description: "Curated playlists selected by the editors."'), "Editor's Choice intro should explain the user-facing value");
  assert(taxonomy.includes('description: "Ambient sounds for focus, calm, sleep, and deep work."'), "Ambience intro should mention when it helps the user");
  assert(taxonomy.includes('description: "Playlists and tracks you listened to recently."'), "Recent intro should be direct and non-technical");
  assert(taxonomy.includes('description: "Top picks gathered from every music category."'), "Community intro should describe the mixed-category benefit");
  for (const stale of ["Manual Picks Only", "Frequency, Nature", "Pure Piano-First", "Music You Played Recently in This Vault", "Top Playlists from Each Music Category", "If Empty, Music Pro Suggests Music"]) {
    assert(!taxonomy.includes(stale), `folder intro should not keep system-facing copy: ${stale}`);
  }
});

check("normalizes standard SoundCloud URLs", () => {
  const url = normalizeSoundCloudUrl("https://www.soundcloud.com/forss/flickermood?utm_source=test#comments");
  assert(url === "https://soundcloud.com/forss/flickermood", url);
});

check("accepts SoundCloud short links", () => {
  const url = normalizeSoundCloudUrl("https://on.soundcloud.com/example");
  assert(url === "https://on.soundcloud.com/example", url);
});

check("handles SoundCloud share URL variants", async () => {
  const discover = normalizeSoundCloudUrl("https://soundcloud.com/discover/sets/personalized-tracks::minh-hoang-147503940:2288509619?si=4c262b735569465b9d9240ec1946fcf5&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing");
  const track = normalizeSoundCloudUrl("https://soundcloud.com/hu-n-trung/nh-c-chill-tiktok-2025-nh-ng-b?si=aad5a260660f46d89b6b193d09709f4a&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing");
  const playlist = normalizeSoundCloudUrl("https://soundcloud.com/sc-playlists-id/sets/indie-chill?si=743ca868c62b4ea8a6f336ff2ede0878&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing");
  assert(discover === "https://soundcloud.com/discover/sets/personalized-tracks::minh-hoang-147503940:2288509619", discover);
  assert(track === "https://soundcloud.com/hu-n-trung/nh-c-chill-tiktok-2025-nh-ng-b", track);
  assert(playlist === "https://soundcloud.com/sc-playlists-id/sets/indie-chill", playlist);
  assert(inferTypeFromUrl(discover) === "playlist", "discover personalized sets should behave like playlists");
  assert(inferTypeFromUrl(playlist) === "playlist", "standard /sets/ links should be playlists");
  assert(inferTypeFromUrl(track) === "track", "standard user/track links should be tracks");

  const catalogService = await readFile(new URL("../src/catalog/CatalogService.ts", import.meta.url), "utf8");
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const normalize = await readFile(new URL("../src/utils/normalize.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  assert(catalogService.includes("resolveSoundCloudShareUrl") && catalogService.includes("fetchPageMetadata"), "add-link should resolve short links and fall back to page metadata");
  assert(normalize.includes("assertEmbeddableSoundCloudUrl") && normalize.includes("personalized Discover"), "personalized Discover links should be rejected with clear copy");
  assert(catalogService.includes("assertEmbeddableSoundCloudUrl(url)") && player.includes("assertEmbeddableSoundCloudUrl(item.url)"), "unembeddable SoundCloud links should be blocked before add/play");
  assert(player.includes("startLoadWatchdog") && player.includes("SoundCloud did not load this link"), "player should surface stuck SoundCloud loads");
  assert(catalogService.includes("findDuplicateItem") && catalogService.includes("added: false"), "duplicates should return the existing item instead of throwing an invisible error");
  assert(main.includes("AddUserSoundCloudResult"), "plugin add-link API should expose whether an item was actually added");
  assert(sidebar.includes("const result = await this.plugin.addUserSoundCloudUrl") && sidebar.includes("await this.plugin.playItem(item)") && !sidebar.includes("already in library"), "duplicate add should quietly play the existing item without a noisy success notice");
});

check("rejects non-SoundCloud URLs", () => {
  let failed = false;
  try { normalizeSoundCloudUrl("https://example.com/music"); } catch { failed = true; }
  assert(failed, "expected non-SoundCloud URL to fail");
});

check("detects playlist URLs", () => {
  assert(inferTypeFromUrl("https://soundcloud.com/lofi_girl/sets/lofi-girl-beats-to-relax-study") === "playlist", "playlist not detected");
});



check("prefers playable duration over full_duration", () => {
  const raw = { duration: 30000, full_duration: 180000 };
  const playable = Number(raw.duration || 0);
  const full = Number(raw.full_duration || 0);
  const chosen = Number.isFinite(playable) && playable > 0 ? playable : full;
  assert(chosen === 30000, `expected playable 30000ms, got ${chosen}`);
});

check("normalizes fallback item when oEmbed is unavailable", async () => {
  const { normalizeCatalog } = await import("./catalog-utils.mjs");
  const catalog = normalizeCatalog({ version: 1, updatedAt: "2026-05-31", items: [{ id: "x", provider: "soundcloud", type: "playlist", title: "X", artist: "Y", url: "https://soundcloud.com/user/sets/example", categories: ["User"], tags: [], source: "user", addedAt: "2026-05-31", verifiedAt: "2026-05-31", status: "active" }] });
  assert(catalog.items[0].type === "playlist", "fallback playlist item should remain playlist");
});

check("dedupes catalog URLs", () => {
  const input = {
    version: 1,
    updatedAt: "2026-05-31",
    items: [
      { id: "a", provider: "soundcloud", type: "track", title: "A", artist: "A", url: "https://soundcloud.com/forss/flickermood", categories: ["Test"], tags: [], source: "curated", addedAt: "2026-05-31", verifiedAt: "2026-05-31", status: "active" },
      { id: "b", provider: "soundcloud", type: "track", title: "B", artist: "B", url: "https://www.soundcloud.com/forss/flickermood?utm=x", categories: ["Test"], tags: [], source: "curated", addedAt: "2026-05-31", verifiedAt: "2026-05-31", status: "active" }
    ]
  };
  const normalized = normalizeCatalog(input);
  assert(normalized.items.length === 1, `expected 1, got ${normalized.items.length}`);
});

check("catalog creates concise Music Pro display names", async () => {
  const catalog = await readCatalog();
  assert(catalog.items.every((item) => typeof item.displayTitle === "string" && item.displayTitle.trim()), "every catalog item should have a Music Pro displayTitle");
  assert(catalog.items.every((item) => item.displayTitle.split(/\s+/).filter(Boolean).length <= 4), "displayTitle should prefer 4 words or fewer");
  assert(makeDisplayTitle('- \"Night Calm\" - Playlist (The Best Ambient)') === "Night Calm", "quoted playlist names should be cleaned");
  assert(makeDisplayTitle("20 Hours of Deep Sleep Music - Relaxing Music for Sleeping") === "Deep Sleep", "noisy long playlist names should become short readable names");
  assert(makeDisplayTitle("888 Hz Unfolding Opportunity") === "888 Hz Unfolding Opportunity", "frequency playlist names should stay relevant and concise");
  assert(makeDisplayTitle("John Coltrane Essentials", "Unknown Curator", ["Jazz & Blues"]) === "John Coltrane Essentials", "compact names should keep the playlist title first when it exists");
  assert(makeDisplayTitle("Playlist", "Miles Davis", ["Jazz & Blues"]) === "Miles Davis", "compact names should fall back to the author when the playlist title is generic");
  assert(makeDisplayTitle("Playlist 1", "Willie Nelson 9", ["Acoustic"], ["guitar", "country"]) === "Willie Nelson", "compact names should strip noisy numeric suffixes from detected author names");
  assert(makeDisplayTitle("Playlist", "SoundCloud", ["Piano"]) === "Piano", "compact names should fall back to instrument when title and author are generic");
  assert(makeDisplayTitle("1", "SoundCloud", ["Acoustic"], ["guitar"]) === "Acoustic Guitar", "numeric-only names should fall back to detected instrument");
  assert(makeDisplayTitle("Playlist", "", ["Ambience"], ["rain"]) === "Ambience", "compact names should fall back to mood/relevance last");
  const normalize = await readFile(new URL("../src/utils/normalize.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  assert(normalize.includes("getDisplaySubtitle") && normalize.includes("makeCompactArtistTitle") && normalize.includes("makeCompactContextFallback"), "runtime compact naming should expose title/author/instrument/mood fallback helpers");
  assert(sidebar.includes("getDisplaySubtitle(item) || item.artist") && quickPicker.includes("getDisplaySubtitle(item) || item.artist") && mini.includes("getDisplaySubtitle(item) || item.artist"), "compact UI should place title first and author/context second without duplicate generic subtitles");
});

check("category playlists sort by mainstream authority and listens", async () => {
  const taxonomy = await readFile(new URL("../src/catalog/playlistCategories.ts", import.meta.url), "utf8");
  const catalogUtils = await readFile(new URL("./catalog-utils.mjs", import.meta.url), "utf8");
  const schema = await readFile(new URL("../catalog/catalog.schema.json", import.meta.url), "utf8");
  const base = {
    id: "synthetic",
    provider: "soundcloud",
    type: "playlist",
    title: "Late Night Set",
    displayTitle: "Late Night",
    artist: "Unknown Curator",
    url: "https://soundcloud.com/example/sets/late-night",
    categories: ["Jazz & Blues"],
    tags: [],
    source: "curated",
    addedAt: "2026-06-01",
    verifiedAt: "2026-06-01",
    status: "active"
  };
  const unknownSmall = { ...base, id: "small", url: "https://soundcloud.com/example/sets/small", playback_count: 24 };
  const unknownLarge = { ...base, id: "large", url: "https://soundcloud.com/example/sets/large", playback_count: 1_200_000 };
  const knownNoCounts = { ...base, id: "known", url: "https://soundcloud.com/miles/sets/known", artist: "Miles Davis" };
  const knownLowCounts = { ...knownNoCounts, id: "known-low", url: "https://soundcloud.com/miles/sets/known-low", playback_count: 200 };
  const playlistNameKnown = { ...base, id: "playlist-name", title: "John Coltrane Essentials", displayTitle: "John Coltrane", artist: "Unknown Curator", url: "https://soundcloud.com/example/sets/john-coltrane" };
  const soundCloudUserKnown = { ...base, id: "soundcloud-user", title: "Late Night Set", displayTitle: "Late Night", artist: "Miles Davis", url: "https://soundcloud.com/miles-davis/sets/late-night" };
  const lowInfoNoFallback = { ...base, id: "low-info", title: "Playlist 1", displayTitle: "1", artist: "SoundCloud", url: "https://soundcloud.com/user123/sets/playlist-1", categories: ["User"], tags: [] };
  const lowInfoWithFallback = { ...base, id: "low-info-fallback", title: "Playlist 1", displayTitle: "Willie Nelson", artist: "Willie Nelson 9", url: "https://soundcloud.com/user520484336/sets/playlist-1-1", categories: ["Acoustic"], tags: ["guitar", "country"] };
  assert(compareCatalogItemsForCategory(unknownLarge, unknownSmall, "Jazz & Blues") < 0, "when no authority name is known, higher listens should sort first");
  assert(compareCatalogItemsForCategory(knownNoCounts, unknownSmall, "Jazz & Blues") < 0, "when listens are missing/low, mainstream names should sort first");
  assert(compareCatalogItemsForCategory(unknownLarge, knownLowCounts, "Jazz & Blues") < 0, "very high listens should still lift unknown curators above low-listen known-name rows");
  assert(compareCatalogItemsForCategory(playlistNameKnown, soundCloudUserKnown, "Jazz & Blues") < 0, "mainstream names in the playlist title should outrank SoundCloud usernames");
  const knownProfile = getPlaylistSortProfile(knownNoCounts, "Jazz & Blues");
  const popularProfile = getPlaylistSortProfile(unknownLarge, "Jazz & Blues");
  const playlistNameProfile = getPlaylistSortProfile(playlistNameKnown, "Jazz & Blues");
  const userNameProfile = getPlaylistSortProfile(soundCloudUserKnown, "Jazz & Blues");
  assert(knownProfile.mainstreamScore > knownProfile.popularityScore, "known-name rows should expose a mainstream score");
  assert(popularProfile.popularityScore > popularProfile.mainstreamScore, "popular unknown rows should expose a listens score");
  assert(playlistNameProfile.mainstreamScore > userNameProfile.mainstreamScore, "playlist-name authority should be weighted above SoundCloud user authority");
  assert(getPlaylistSortProfile(lowInfoNoFallback, "User").qualityScore < getPlaylistSortProfile(lowInfoWithFallback, "Acoustic").qualityScore, "low-information playlist names without author/instrument/mood fallback should be deprioritized");
  const normalized = normalizeCatalog({ version: 1, updatedAt: "2026-06-01", items: [unknownLarge] });
  assert(normalized.items[0].playback_count === 1_200_000, "catalog normalization should preserve SoundCloud listen metrics");
  assert(taxonomy.includes("CATEGORY_MAINSTREAM_SIGNALS") && taxonomy.includes("POPULARITY_SIGNAL_GROUPS") && taxonomy.includes("getPlaylistSortProfile"), "runtime taxonomy should sort by name authority plus popularity groups");
  assert(catalogUtils.includes("normalizePopularityFields") && schema.includes('"playback_count"'), "catalog tooling/schema should retain popularity fields for sorting");
});

check("two-layer playlist intelligence is wired for SoundCloud and local behavior", async () => {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const enrich = await readFile(new URL("./enrich-soundcloud-popularity.mjs", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const types = await readFile(new URL("../src/catalog/types.ts", import.meta.url), "utf8");
  const catalogService = await readFile(new URL("../src/catalog/CatalogService.ts", import.meta.url), "utf8");
  const catalogUtils = await readFile(new URL("./catalog-utils.mjs", import.meta.url), "utf8");
  const schema = await readFile(new URL("../catalog/catalog.schema.json", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const taxonomy = await readFile(new URL("../src/catalog/playlistCategories.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("../src/catalog/PlaylistIndex.ts", import.meta.url), "utf8");
  assert(packageJson.includes("catalog:enrich-popularity"), "package scripts should expose SoundCloud popularity enrichment");
  assert(enrich.includes("window.__sc_hydration") && enrich.includes("api-v2.soundcloud.com/tracks?ids=") && enrich.includes("--dry-run") && enrich.includes("--stale-days"), "SoundCloud layer should safely hydrate playlist metrics with dry-run/staleness controls");
  assert(types.includes("soundcloudTrackCount") && types.includes("popularityConfidence") && types.includes("popularityUpdatedAt"), "catalog types should preserve enrichment metadata");
  assert(schema.includes('"soundcloudTrackCount"') && schema.includes('"popularityConfidence"') && schema.includes('"popularityUpdatedAt"'), "catalog schema should validate enrichment metadata");
  assert(catalogService.includes("popularityConfidence") && catalogUtils.includes("popularityConfidence"), "runtime and tooling normalization should keep enrichment fields");
  assert(settings.includes("MusicProBehaviorStats") && settings.includes("behaviorStats") && settings.includes("behaviorRankingScores") && settings.includes("behaviorRankingUpdatedAt"), "settings should persist local Music Pro behavior signals plus a frozen ranking snapshot");
  assert(main.includes("observePlaybackBehavior") && main.includes("recordPlaybackFinish") && main.includes("getPersonalBehaviorScore"), "app should learn from plays, finishes, skips, previews, and unavailable tracks");
  assert(main.includes("BEHAVIOR_RANKING_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000") && main.includes("refreshBehaviorRankingIfStale") && main.includes("calculateBehaviorScore"), "local behavior should refresh ranking snapshots only on a 7-day cadence");
  assert(main.includes("behaviorRankingScores?.[this.getBehaviorKey(item)]") && main.includes("private getPersonalBehaviorScore(item: CatalogItem, _randomMode = false)"), "runtime ranking should read the frozen behavior snapshot instead of live behavior stats");
  const scheduleBehaviorSaveBody = main.slice(main.indexOf("private scheduleBehaviorSave"), main.indexOf("private clearBehaviorSaveTimer"));
  assert(!scheduleBehaviorSaveBody.includes("enabledItemsCache = null") && !scheduleBehaviorSaveBody.includes("renderAll()"), "live behavior tracking should save data without immediately reordering visible playlists");
  assert(main.includes("hasUsefulUpdate") && main.includes("scoreById"), "behavior saves and ranking sorts should avoid unnecessary writes/repeated score work");
  assert(main.includes("weightedRandomCatalogItem") && main.includes("randomMode: true"), "random playlist should remain weighted by catalog quality plus the frozen local behavior snapshot");
  assert(sidebar.includes("rankCatalogItemsForCategory") && quickPicker.includes("rankCatalogItemsForCategory"), "sidebar and quick picker should use the same ranking helper for normal categories");
  assert(taxonomy.includes("COMMUNITY_PLAYLIST_CATEGORY_ID") && taxonomy.includes('label: "Community"') && taxonomy.includes("Top picks gathered from every music category."), "taxonomy should expose a concise Community playlist category");
  assert(!taxonomy.includes("COMMUNITY_LISTEN_CATEGORY_ID") && !taxonomy.includes('label: "Community Listen"') && !taxonomy.includes('"community-listen"'), "taxonomy should not expose the old confusing Community Listen category");
  assert(settings.includes("COMMUNITY_PLAYLIST_CATEGORY_ID") && settings.includes('.flatMap((id) => id === "middle-east" ? [id, COMMUNITY_PLAYLIST_CATEGORY_ID] : [id])'), "default category order should place Community immediately under Middle East");
  assert(main.includes("previousCommunityDefaultOrder") && main.includes("COMMUNITY_PLAYLIST_CATEGORY_ID,") && main.includes("builtInOrder.join(\"|\") === previousCommunityDefaultOrder.join(\"|\")"), "settings normalization should migrate the old default Community position below Middle East");
  assert(!index.includes("COMMUNITY_PLAYLIST_CATEGORY_ID") && !index.includes('item.status === "active" && item.type === "playlist"'), "playlist index should not inject all active playlists into a Community bucket");
  assert(main.includes("getCommunityPlaylistItemsFromBuckets") && main.includes("COMMUNITY_TOP_PER_CATEGORY = 3") && main.includes("PLAYLIST_CATEGORIES"), "main app should build Community from top 3 items per real category");
  assert(sidebar.includes("COMMUNITY_PLAYLIST_CATEGORY_ID") && quickPicker.includes("COMMUNITY_PLAYLIST_CATEGORY_ID") && sidebar.includes("getCommunityPlaylistItemsFromBuckets(index.byCategory)") && quickPicker.includes("getCommunityPlaylistItemsFromBuckets(index.byCategory)"), "sidebar and quick picker should render Community counts/items from top category buckets");
});

check("range sliders are visible and seekable", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const legacyHiddenSeek = css.indexOf("opacity: 0");
  const visibleSeekOverride = css.lastIndexOf("opacity: 1");
  assert(legacyHiddenSeek >= 0, "expected legacy hidden seek rule to remain overridden");
  assert(visibleSeekOverride > legacyHiddenSeek, "seek slider visible override must come after hidden legacy rule");
  assert(css.includes("overflow: visible"), "range hit area should not be clipped");
  assert(sidebar.includes('seek.addEventListener("click", commitSeek)'), "sidebar timeline should commit click seek");
  assert(sidebar.includes('seek.addEventListener("pointerup", commitSeek)'), "sidebar timeline should commit drag release");
  assert(mini.includes('seek.addEventListener("click", commitSeek)'), "mini timeline should commit click seek");
  assert(mini.includes('seek.addEventListener("pointerup", commitSeek)'), "mini timeline should commit drag release");
});

check("compact mini dock proximity auto-hide is smooth", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("Proximity compact dock");
  assert(marker > css.lastIndexOf("UI audit v11"), "proximity compact dock override should come after older mini dock rules");
  const compactCss = css.slice(marker);
  assert(compactCss.includes("--music-pro-mini-peek: 38px"), "compact dock should leave a small visible handle when tucked");
  assert(compactCss.includes("translate3d(calc(100% - var(--music-pro-mini-peek)), 0, 0)"), "auto-hide should tuck the compact dock into the right edge");
  assert(compactCss.includes(".is-proximity-open") && compactCss.includes("cubic-bezier(0.22, 1, 0.36, 1)"), "proximity reveal should use a smooth animated state");
  assert(compactCss.includes("UI audit v17") && compactCss.includes('"volume volume volume"'), "compact dock should keep action buttons grouped with transport, not in a detached grid cell");
  assert(mini.includes('document.addEventListener("pointermove", this.handlePointerMove') && mini.includes("is-proximity-open"), "mini dock should open when the pointer passes nearby, not only on direct hover");
  assert(mini.includes('const actions = controls.createSpan({ cls: "music-pro-mini-actions" })'), "mini action buttons should live inside the same compact control cluster");
  assert(mini.includes('state.mode === "mini" && this.plugin.settings.autoHideMini'), "compact dock should tuck when the mouse is away, not only while audio is playing");
  assert(settingsTab.includes("When compact, tuck it away until your mouse is near."), "auto-hide settings copy should describe proximity behavior plainly");
});

check("compact auto-hide closes 30ms after pointer leaves", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v80");
  assert(marker > css.lastIndexOf("UI audit v79"), "fast compact tuck should be the latest compact timing override");
  const timingCss = css.slice(marker);
  assert(mini.includes("private readonly proximityCollapseDelayMs = 30"), "compact dock should schedule close exactly 30ms after leaving the panel");
  assert(mini.includes('if (this.root.matches(":hover") || this.root.matches(":focus-within"))') && mini.includes("if (this.proximityOpen)") && mini.includes("this.queueProximityClose();") && mini.includes("return;"), "pointer movement near an already-open dock should not keep resetting the close timer unless the dock is actually hovered/focused");
  assert(timingCss.includes("not(.is-proximity-open):not(:hover):not(:focus-within)") && timingCss.includes("transform 160ms") && timingCss.includes("opacity 120ms"), "tucking animation should be faster when compact auto-hide closes");
  assert(timingCss.includes("is-proximity-open") && timingCss.includes("transform 220ms"), "reveal should stay smooth while close is faster");
});

check("sidebar headline has comfortable inset and blue ambience", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v15");
  assert(marker > css.lastIndexOf("UI audit v14"), "v15 title inset override should come after add-flow styles");
  const sidebarCss = css.slice(marker);
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  assert(sidebarCss.includes("padding: 64px 40px 34px 58px"), "sidebar headline should be pulled well away from top-left edges");
  assert(css.includes("radial-gradient(ellipse 78% 48% at 50% -18%"), "sidebar should have a top-down blue glow");
  assert(css.includes("#071a3a"), "sidebar blue ambience should feel deeper than the default background");
  assert(sidebar.includes("normalizeScrollTop") && sidebar.includes("Math.abs(value) < 1") && !sidebar.includes("value < 96 ? 0"), "near-top scroll restoration should preserve real offsets instead of snapping back to the player/header");
  assert(css.includes("UI audit v21") && css.includes("padding-top: 22px") && css.includes("padding-left: 16px") && css.includes("margin-bottom: 6px"), "title block should be visually balanced between the top edge and player card");
});

check("feedback and support link is visible but quiet", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.indexOf("quiet but visible Feedback & Support chip");
  assert(sidebar.includes("music-pro-support-link") && sidebar.includes("https://ko-fi.com/minhhoang2000"), "sidebar header should include Minh's Ko-fi support link");
  assert(sidebar.includes('"aria-label": "Feedback & Support"') && sidebar.includes('text: "Support"'), "support link should keep visible copy compact while preserving full accessible intent");
  assert(sidebar.includes('setIcon(support.createSpan({ cls: "music-pro-support-icon" }), "coffee")'), "support link should use a gentle coffee icon");
  assert(marker > css.lastIndexOf("UI audit v21") && marker < css.indexOf("compact MiniPlayer requested layout"), "support chip should be a late header override");
  const supportCss = css.slice(css.indexOf(".music-pro-support-link"), css.indexOf(".music-pro-header-subtitle"));
  assert(supportCss.includes("var(--interactive-accent) 8%") && supportCss.includes("font-size: 12px"), "support chip should be noticeable without looking promotional");
  const finalHeaderCss = css.slice(css.indexOf("tighten header grouping and keep Support readable"));
  assert(finalHeaderCss.includes("transform: translateY(3px)") && finalHeaderCss.includes(".music-pro-title-wrap .music-pro-eyebrow"), "vault name should sit a few pixels lower and read as one header group with Music Pro");
  assert(finalHeaderCss.includes("min-width: max-content") && finalHeaderCss.includes(".music-pro-support-text") && finalHeaderCss.includes("display: inline"), "support chip should keep both icon and text visible");
});

check("status bar Music Pro toggle buttons are removed", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert(!main.includes("addStatusBarItem()") && !main.includes("private renderStatusBar"), "Music Pro should not create an Obsidian status-bar control strip");
  assert(!main.includes("Toggle Music Pro view") && !main.includes("music-pro-status-play") && !main.includes("music-pro-status-button"), "compact/full and play/stop buttons should be absent from the lower Obsidian chrome");
  assert(!main.includes("lastStatusBarKey") && !main.includes("statusKey"), "store updates should not track a removed status-bar render key");
  assert(!css.includes(".music-pro-status") && !css.includes("music-pro-status-button") && !css.includes("music-pro-status-play"), "removed status-bar buttons should not leave active CSS selectors behind");
});

check("edge buttons align with the player rails", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("pull edge buttons onto the same visual rail");
  assert(marker > css.lastIndexOf("UI audit v17"), "edge-button polish should come after previous compact/player overrides");
  const edgeCss = css.slice(marker);
  assert(main.includes('const ribbonIcon = this.addRibbonIcon("music-2", "Music Pro", () => this.toggleMode());') && main.includes('ribbonIcon.addClass("music-pro-ribbon-action")'), "Music Pro ribbon icon should have a scoped class for edge inset");
  assert(edgeCss.includes(".side-dock-ribbon-action.music-pro-ribbon-action") && edgeCss.includes("translateX(4px)"), "ribbon button should be nudged inward from the hard left edge");
  assert(edgeCss.includes("padding-right: 18px") && edgeCss.includes("column-gap: 16px"), "now-playing controls should breathe away from the card edge");
  assert(edgeCss.includes(".music-pro-now-card-option-b .music-pro-now-bottomline") && edgeCss.includes("padding-right: 4px"), "player buttons and sliders should share a subtle right rail");
  assert(edgeCss.includes("padding-left: 24px") && edgeCss.includes("padding-right: 24px"), "compact sidebar width should keep content away from view borders");
});

check("clipped music names reveal a fast custom tooltip", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("instant full-name tooltip");
  assert(marker > css.lastIndexOf("UI audit v19"), "full-name tooltip polish should come after resize-safe player overrides");
  const tooltipCss = css.slice(marker);
  assert(main.includes("registerFullNameTooltip") && main.includes("[data-music-pro-full-name]") && main.includes("shouldShowFullNameTooltip"), "plugin should delegate a custom tooltip to full-name title targets");
  assert(main.includes("scrollWidth > target.clientWidth") && main.includes("window.requestAnimationFrame"), "tooltip should appear only for clipped/shortened names and position quickly");
  const miniTrackPicker = mini.slice(mini.indexOf("private renderTrackPicker"));
  assert(sidebar.includes("data-music-pro-full-name") && mini.includes("data-music-pro-full-name"), "sidebar and mini player titles should expose full names");
  assert(!quickPicker.includes("data-music-pro-full-name") && !miniTrackPicker.includes("data-music-pro-full-name"), "quick pick surfaces should not show temporary full-name tooltips");
  assert(!miniTrackPicker.includes('"aria-label-position": "top"'), "inline quick pick rows should not trigger Obsidian hover hints");
  assert(!sidebar.includes("attachFullNameTooltip") && !mini.includes("data-music-pro-full-name-force") && !quickPicker.includes("data-music-pro-full-name-force"), "full-name tooltip should not trigger from artwork thumbnails or quick-pick icons");
  assert(!sidebar.includes('"aria-label": `Play ${displayTitle}`') && !sidebar.includes('"aria-label": state.isPlaying ? "Pause current playlist"'), "playlist cards should not show play/name tooltips when hovering thumbnails or blank card areas");
  assert(tooltipCss.includes(".music-pro-full-name-tooltip") && tooltipCss.includes("backdrop-filter: blur(18px)") && tooltipCss.includes("opacity 90ms ease"), "tooltip should use a polished fast Apple-like surface");
  assert(tooltipCss.includes("pointer-events: none") && tooltipCss.includes("z-index: 100000"), "tooltip should be lightweight and float above clipped cards without intercepting clicks");
});

check("accent color can be customized without theme-sync clutter", async () => {
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert(settings.includes("accentColor") && settings.includes("adaptAccentToTheme"), "settings should keep a legacy theme-sync field only for migration while using Music Pro color by default");
  assert(settings.includes("rainbowAccentEnabled") && settings.includes("rainbowAccentEnabled: false"), "settings should persist the optional Rainbow appearance toggle and keep it off by default");
  assert(settings.includes('DEFAULT_ACCENT_COLOR = "#2f7cf6"'), "default accent should be the Music Pro blue");
  assert(main.includes("applyAccentToElement") && main.includes("--interactive-accent") && main.includes("this.settings.adaptAccentToTheme = false") && main.includes("return this.settings.accentColor"), "plugin should always use the Music Pro accent and migrate old theme-sync settings off");
  assert(main.includes("RAINBOW_ACCENT_COLORS") && main.includes("RAINBOW_ACCENT_STEP_MS") && main.includes("getRainbowAccentColor") && main.includes("window.requestAnimationFrame") && main.includes("setRainbowAccentEnabled"), "Rainbow should gently cycle the scoped accent without replacing the stored accent color");
  assert(!settingsTab.includes("Use Theme Accent") && !settingsTab.includes("Use theme accent") && !settingsTab.includes("setDisabled(this.plugin.settings.adaptAccentToTheme") && !settingsTab.includes("setAdaptAccentToTheme") && settingsTab.includes("addColorPicker") && settingsTab.includes("ACCENT_COLOR_PRESETS") && settingsTab.includes("music-pro-accent-swatch"), "settings should remove the Use Theme Accent toggle while keeping the picker and curated presets");
  assert(settingsTab.includes('setName("Rainbow")') && settingsTab.includes("Slowly move Music Pro through soft colors.") && settingsTab.includes("setRainbowAccentEnabled(value)") && settingsTab.includes("addBooleanButton(rainbowSetting"), "Appearance settings should expose Rainbow as a compact On/Off toggle");
  assert(settingsTab.includes('button.setIcon("rotate-ccw")') && settingsTab.includes("Reset Music Pro Blue"), "blue reset should remain, but as a compact symbol button");
  assert(main.includes("--music-pro-background-accent") && main.includes("--music-pro-background-deep"), "custom accent should publish synchronized background variables");
  assert(main.includes("getOnAccentColor") && main.includes("getRelativeLuminance") && main.includes("--music-pro-on-accent") && main.includes("--text-on-accent"), "custom accents should compute readable text/icon color for light accent buttons");
  assert(css.includes("UI audit v27") && css.includes("--music-pro-background-accent") && css.includes("var(--music-pro-background-glow)") && css.includes(".music-pro-accent-palette"), "stylesheet should sync the Music Pro background and style the preset palette");
  assert(css.includes("UI audit v28") && css.includes("--music-pro-on-accent") && css.includes(".music-pro-play-button") && css.includes(".music-pro-inline-submit"), "accent buttons and setting CTAs should use the computed on-accent contrast color");
  assert(sidebar.includes("applyAccentToElement(contentEl)") && mini.includes("applyAccentToElement(this.root)"), "sidebar and mini dock should receive the scoped accent");
});

check("add flow is personal-category only and aligned", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v14");
  assert(marker > css.lastIndexOf("UI audit v13"), "v14 add-flow alignment should come after inline add styles");
  const addCss = css.slice(marker);
  assert(sidebar.includes("getPersonalAddCategoryDefinitions"), "add category choices should be limited to personal categories");
  assert(sidebar.includes('text: "Personal Playlists"') || sidebar.includes('text: "Personal categories"'), "add UI should label personal categories clearly");
  assert(!sidebar.includes("music-pro-inline-selected"), "selected categories should only be shown by active chips, not duplicated below");
  assert(sidebar.includes('cls: "music-pro-inline-add-title", text: "Add music"') || sidebar.includes('cls: "music-pro-inline-add-title", text: "Add Music"'), "inline Add music title should not render a plus symbol next to it");
  assert(!sidebar.includes("AddSoundCloudModal") && !sidebar.includes("AddToFolderModal"), "legacy modal add/folder flows should not be referenced by the release UI");
  assert(addCss.includes("grid-template-areas:") && addCss.includes('"input button"'), "link/folder form should have aligned input/button grid");
  assert(sidebar.includes("openPersonalCategoryMenu") && sidebar.includes("contextmenu") && sidebar.includes("renamePersonalCategory") && sidebar.includes("deletePersonalCategory"), "personal categories should support right-click rename/delete");
  assert(sidebar.includes('addUserSoundCloudUrl(this.addUrl, ["User"])'), "user-added playlists should stay in local User library while personal folders are assigned separately");
});

check("playlist loading and unavailable tracks are stable", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const types = await readFile(new URL("../src/player/types.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("stable track loading, vertical folder rail");
  assert(marker > css.lastIndexOf("UI audit v17"), "stable playlist loading override should come after older responsive rules");
  const v18 = css.slice(marker);
  assert(sidebar.includes("renderPlaylistTrackSkeleton") && sidebar.includes("music-pro-playlist-skeleton-list"), "loading playlists should render same-height skeleton rows instead of collapsing");
  assert(v18.includes(".music-pro-playlist-tracks.is-loading") && v18.includes("min-height: 338px"), "loading playlist section should reserve stable height");
  assert(types.includes("isPlayable?: boolean") && types.includes("currentSoundIsUnavailable"), "playback state should track unavailable SoundCloud sounds");
  assert(player.includes("isLikelyUnavailableFinish") && player.includes("applyUnplayableSound") && player.includes("unplayableSoundReasons"), "player should mark instant-finish tracks unavailable");
  assert(main.includes("getAdjacentPlayableSound") && main.includes("preview-only or unavailable"), "plugin should skip unavailable/preview tracks but stop instead of looping forever");
  assert(sidebar.includes("is-unavailable") && sidebar.includes("Unavailable"), "track list should visibly mark known unavailable tracks");
});

check("SoundCloud preview/blocked policies are removed from autoplay lists", async () => {
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  assert(player.includes('policy === "SNIP"') && player.includes('policy === "BLOCK"') && player.includes("anonymous/free embedded playback"), "player should treat SoundCloud preview/restricted policy metadata as autoplay-unfit for release UX");
  assert(player.includes("filterAutoplayUnfitPlaylistSounds") && player.includes("sound.isPlayable === false || sound.isPreview"), "playlist rows should remove preview-only and restricted tracks instead of showing dead rows");
  assert(player.includes('applyUnplayableSound(activeSound.id, "Unavailable in SoundCloud embed")'), "tracks should still be marked unavailable when the widget proves an immediate no-progress finish");
  assert(player.includes("isLikelyUnavailableFinish(completedMs, advertisedMs, Date.now() - this.lastPlayAttemptAt)"), "unavailable detection should remain based on runtime widget behavior too");
});

check("playlist rail stays vertical and UI copy is title-cased", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("stable track loading, vertical folder rail");
  const v18 = css.slice(marker);
  assert(sidebar.includes('text: "Playlists"') && sidebar.includes('text: "Personal Playlists"'), "sidebar should use Playlist naming");
  assert(settingsTab.includes("Playlists") && settingsTab.includes("Visible Playlists") && settingsTab.includes("New Personal Playlist"), "settings should use simple Playlist naming");
  assert(sidebar.includes('text: "Add Music"') && sidebar.includes('text: "Add To Playlist"') && quickPicker.includes('text: "Quick Pick"'), "headlines should use title case");
  assert(v18.includes("@container (max-width: 520px)") && v18.includes("flex-direction: column") && v18.includes("grid-template-columns: minmax(118px"), "folder rail should remain vertical at moderately narrow widths");
  assert(v18.includes("scrollbar-width: none") && v18.includes("::-webkit-scrollbar"), "any horizontal folder/chip overflow should hide scrollbars");
});

check("unused playlist categories can be disabled for real performance savings", async () => {
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("../src/catalog/PlaylistIndex.ts", import.meta.url), "utf8");
  const taxonomy = await readFile(new URL("../src/catalog/playlistCategories.ts", import.meta.url), "utf8");
  assert(settings.includes("disabledPlaylistCategoryIds"), "settings should persist disabled category IDs across updates");
  assert(main.includes("setPlaylistCategoryEnabled") && main.includes("setAllPlaylistCategoriesEnabled"), "plugin should expose per-category and bulk category toggles");
  assert(main.includes("categoryId === RECENT_PLAYLIST_CATEGORY_ID && !enabled") && main.includes("this.settings.recentlyPlayedItemIds = []"), "Recent category should be disable-able and clear local history when turned off");
  assert(settingsTab.includes("Visible Playlists") && settingsTab.includes("Off playlists do not load, search, show, or fetch artwork"), "settings UI should explain real performance impact in simple language");
  assert(settingsTab.includes("music-pro-bulk-playlist-switch") && settingsTab.includes("anyPlaylistCategoryEnabled") && settingsTab.includes("bulkPlaylistSetting") && settingsTab.includes("setAllPlaylistCategoriesEnabled(value)"), "bulk playlist control should use the same On/Off toggle button pattern as other settings");
  assert(sidebar.includes("getEnabledBasePlaylistCategoryDefinitions") && sidebar.includes("getEnabledPersonalCategoryDefinitions"), "sidebar index should only use enabled category definitions");
  assert(quickPicker.includes("getEnabledBasePlaylistCategoryDefinitions") && quickPicker.includes("getEnabledPersonalCategoryDefinitions"), "quick picker index should only use enabled category definitions");
  assert(index.includes("indexedItems") && index.includes("if (ids.length === 0) continue"), "playlist index should skip items that have no enabled categories");
  assert(taxonomy.includes("allowedCategoryIds") && taxonomy.includes("getPlaylistCategoryIdsUncached"), "classifier should only evaluate enabled category IDs when indexing");
});

check("library uses single playlist taxonomy", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const taxonomy = await readFile(new URL("../src/catalog/playlistCategories.ts", import.meta.url), "utf8");
  assert(settings.includes("recentlyPlayedItemIds"), "settings should persist recently played items");
  assert(settings.includes('lastSelectedCategory: "editors-choice"'), "Editor’s Choice should be the default category");
  assert(settings.includes("RECENT_PLAYLIST_CATEGORY_ID,\n  DEFAULT_PLAYLIST_CATEGORY_ID"), "Recent should appear above Editor’s Choice in the default rail order");
  assert(main.includes("rememberRecentlyPlayed(item.id)"), "playItem should save recent album history");
  assert(sidebar.includes("renderPlaylistCategoryRail"), "sidebar should render left playlist category rail");
  assert(!sidebar.includes('text: "Library"'), "redundant Library header should be removed");
  assert(sidebar.includes('text: "Playlists"') || sidebar.includes('text: "Folders"'), "Playlists rail title should remain plural");
  assert(sidebar.includes("visibleItemLimit"), "large catalogs should render incrementally");
  assert(!sidebar.includes('"genre", "instrument"'), "genre/instrument tabs should be removed");
  assert(quickPicker.includes("getPlaylistCategoryDefinitions"), "quick picker should use shared ordered playlist taxonomy");
  assert(!quickPicker.includes("catalog.getCategories"), "quick picker should not use old raw catalog categories");
  assert(taxonomy.includes("Ambience") && taxonomy.includes("Jazz & Blues") && taxonomy.includes("Handpan & Kalimba") && taxonomy.includes("House") && taxonomy.includes("Acoustic") && taxonomy.includes("Bossa") && taxonomy.includes("Middle East"), "playlist taxonomy should include requested categories");
  assert(!taxonomy.includes("Rock/Metal") && !taxonomy.includes("label: \"Other\""), "removed categories should not be in playlist taxonomy");
  assert(taxonomy.includes("getPlaylistCategoryIds"), "taxonomy should expose reusable classifier");
  assert(css.includes(".music-pro-playlist-browser"), "playlist browser layout should be styled");
  assert(css.includes(".music-pro-recent-now"), "recent tab should style current album card");
});


check("playlist search spans all categories with current category first", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert(sidebar.includes("getSearchResultGroups"), "sidebar should build grouped search results");
  assert(sidebar.includes("this.category,") && sidebar.includes("getPlaylistCategoryDefinitions()"), "search should prioritize the current category then user category order");
  assert(sidebar.includes("getCategoryItems(categoryId") && sidebar.includes("seenItems"), "search should scan all categories without duplicate playlist rows");
  assert(sidebar.includes("data-music-pro-results"), "search should rerender only the results region so the input keeps focus");
  assert(!sidebar.includes("Searching all categories") && !sidebar.includes("Search results"), "search should not render the blue helper intro card");
  assert(sidebar.includes("music-pro-search-current-badge") && sidebar.includes("music-pro-search-group-count"), "search results should be visibly grouped by category");
  assert(css.includes("UI audit v9") && css.includes(".music-pro-search-group-head"), "grouped search results should be styled");
});

check("playlist clicks preserve sidebar scroll position", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  assert(sidebar.includes("captureScrollSnapshot") && sidebar.includes("restoreScrollSnapshot"), "sidebar should preserve scroll across rerenders");
  assert(sidebar.includes("pendingScrollSnapshot") && sidebar.includes("scrollRestoreToken"), "scroll restoration should survive rapid playback rerenders");
  assert(sidebar.includes("requestAnimationFrame") && sidebar.includes("viewContentTop"), "scroll restore should run after layout and cover Obsidian view-content");
  assert(sidebar.includes("rememberPlaylistItemScrollAnchor") && sidebar.includes("data-music-pro-item-id") && sidebar.includes("restoreScrollAnchor"), "playlist click should lock the clicked row as a viewport anchor so Tracks insertion does not jump the UI");
  assert(sidebar.includes("anchorViewportTop") && sidebar.includes("getPrimaryScrollContainer") && sidebar.includes("scrollEl.scrollTop += delta"), "scroll restore should compensate for layout height changes above the clicked playlist");
  assert(sidebar.includes("playlistCategoryScrollLeft") && sidebar.includes("playlistCategoryRail.scrollLeft = snapshot.playlistCategoryScrollLeft") && sidebar.includes("playlistCategoryScrollTop"), "horizontal playlist folder rail should keep its scroll position when a near-end folder is selected");
  assert(sidebar.includes("trackListScrollTop") && sidebar.includes("restoreTrackListScroll") && sidebar.includes("snapshot.trackListItemId !== currentItemId"), "internal Tracks list scroll should survive track metadata hydration for the same playlist");
  assert(sidebar.includes("scrollInteractionVersion") && sidebar.includes("markScrollInteraction") && sidebar.includes("interactionVersion !== this.scrollInteractionVersion"), "delayed scroll restoration should cancel when the user manually scrolls during loading");
});

check("external Obsidian browser audio auto-pauses Music Pro", async () => {
  const monitor = await readFile(new URL("../src/integrations/ExternalAudioMonitor.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  assert(settings.includes("pauseForExternalAudio"), "settings should include external audio pause toggle");
  assert(monitor.includes("media-started-playing"), "monitor should listen to Electron webview media-started-playing");
  assert(monitor.includes("media-paused"), "monitor should listen to Electron webview media-paused");
  assert(monitor.includes("audio, video"), "monitor should detect native media elements");
  assert(main.includes("scheduleExternalAudioResume"), "main should schedule resume after external audio stops");
  assert(main.includes("}, 1000)"), "resume delay should be 200ms");
  assert(main.includes("fadeVolumeTo(0, 700"), "external audio pause should fade out softly");
  assert(main.includes("fadeVolumeTo(targetVolume, 1000)"), "resume should fade in softly");
  assert(settingsTab.includes("Pause For Browser Audio") && settingsTab.includes("Pause Music Pro while Obsidian browser audio plays."), "settings UI should expose the feature");
});

check("current track loop seeks to 0:00 without reloading", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  assert(settings.includes("loopTrackEnabled"), "settings should persist the current-track loop toggle");
  assert(main.includes("toggleLoopTrackMode"), "plugin should expose a loop toggle method");
  assert(main.includes("this.settings.loopTrackEnabled = Boolean(this.settings.loopTrackEnabled)"), "settings loader should normalize loop toggle");
  assert(main.includes("this.player.seekTo(0);") && main.includes("this.player.play();"), "finish handler should restart by seeking to 0:00, not loading another item");
  assert(sidebar.includes("music-pro-loop-toggle") && mini.includes("music-pro-loop-toggle"), "sidebar and mini dock should render loop controls");
  assert(sidebar.includes('"repeat"') && mini.includes('"repeat"'), "loop toggle should use repeat icon without numeric 1");
  assert(!sidebar.includes('"repeat-1"') && !mini.includes('"repeat-1"'), "loop toggle should not use repeat-1 icon");
  assert(!settingsTab.includes('.setName("Loop Current Track")'), "settings should omit the loop toggle because loop is controlled directly in the player UI");
  assert(css.includes(".music-pro-control-button.music-pro-loop-toggle.is-active"), "loop toggle should have active styling");
});

check("range handles are centered and easier to adjust", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("keep timeline and volume on one horizontal row");
  assert(marker > css.lastIndexOf("UI audit v20"), "stylesheet should include final range handle alignment pass after older rules");
  const rangeCss = css.slice(marker);
  assert(!sidebar.includes("music-pro-header-actions music-pro-control-group"), "compact/collapse button should no longer live outside the player header");
  assert(sidebar.includes('cls: "music-pro-control-button music-pro-collapse-button"') && sidebar.indexOf("music-pro-collapse-button") > sidebar.indexOf("music-pro-controls"), "compact/collapse button should live inside the now-playing controls");
  const v15RangeCss = css.slice(css.lastIndexOf("UI audit v15"));
  assert(v15RangeCss.includes(".music-pro-now-card-option-b .music-pro-collapse-button"), "compact/collapse button should be styled as a player control");
  assert(v15RangeCss.includes("--music-pro-range-thumb-size: 22px") && v15RangeCss.includes("--music-pro-range-volume-thumb-size: 22px"), "timeline and volume handles should use the same larger thumb size");
  assert(v15RangeCss.includes("margin-top: 0;"), "now-playing range thumbs should not be offset above their track axis");
  assert(v15RangeCss.includes("height: var(--music-pro-range-hit-height)") && v15RangeCss.includes("line-height: var(--music-pro-range-hit-height)"), "now-playing sliders should use a centered hit box");
  assert(rangeCss.includes("grid-template-columns: minmax(148px, 1fr) minmax(128px, 0.42fr)") && rangeCss.includes("@container (max-width: 390px)"), "timeline and volume should share one row until the sidebar is very narrow");
  assert(rangeCss.includes("height: 32px") && rangeCss.includes("align-items: center"), "timeline and volume tracks should sit on the same visual axis");
});

check("sidebar volume percent stays inside the player card", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("keep the sidebar volume percentage inside the player card");
  assert(marker > css.lastIndexOf("UI audit v23"), "volume percent inset should be the final sidebar player pass");
  const volumeCss = css.slice(marker);
  assert(volumeCss.includes("padding-right: 10px") && volumeCss.includes("padding-right: 12px"), "bottomline should reserve right inset for the volume percent");
  assert(volumeCss.includes("minmax(56px, max-content)") && volumeCss.includes("min-width: 56px"), "volume percent column should be wide enough for 100%");
  assert(volumeCss.includes("overflow: visible") && volumeCss.includes("white-space: nowrap"), "volume percent should not be clipped or wrapped");
});

check("recently played header stays concise", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  assert(sidebar.includes('text: "Recently Played"'), "recent section should use title-case Recently Played");
  assert(!sidebar.includes("Fast jump back to playlists and long sets you opened."), "recent section should not show descriptive helper copy");
  assert(!sidebar.includes("Playlists you play will appear here automatically."), "recent section should keep the header to only Recently Played");
  assert(sidebar.includes("this.category === RECENT_PLAYLIST_CATEGORY_ID && !this.query.trim()"), "recent category should skip the generic category intro card unless actively searching");
});

check("Recent can be disabled without saving playback history", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  assert(!main.includes("if (categoryId === RECENT_PLAYLIST_CATEGORY_ID) return true"), "Recent should no longer be hard-forced on");
  assert(!main.includes("validIds.delete(RECENT_PLAYLIST_CATEGORY_ID)"), "Recent should be a valid disabled category ID");
  assert(main.includes("if (!this.isPlaylistCategoryEnabled(RECENT_PLAYLIST_CATEGORY_ID)) return;") && main.includes("if (!this.isPlaylistCategoryEnabled(RECENT_PLAYLIST_CATEGORY_ID)) return []"), "recent history should not save or show while Recent is off");
  assert(settingsTab.includes("Turn off to stop saving Recent history") && !settingsTab.includes("Always on. Recent uses local playback history only."), "settings copy should make Recent an ordinary disable-able local history toggle");
});

check("settings booleans use compact toggle buttons instead of switches", async () => {
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("compact settings boolean buttons instead of switch controls");
  assert(marker > css.lastIndexOf("UI audit v26"), "settings toggle button CSS should be the latest settings control pass");
  const toggleCss = css.slice(marker);
  assert(settingsTab.includes("addBooleanButton") && settingsTab.includes("music-pro-toggle-button"), "settings should render boolean controls through reusable compact buttons");
  assert(settingsTab.includes("music-pro-bulk-playlist-switch") && settingsTab.includes("bulkPlaylistSetting") && settingsTab.includes("addBooleanButton"), "Bulk Playlist Switches should also use reusable On/Off toggle buttons");
  assert(!settingsTab.includes(".addToggle("), "settings should not use switch-style addToggle controls");
  assert(toggleCss.includes(".music-pro-toggle-button.is-active") && settingsTab.includes('setAttr("aria-pressed"'), "toggle buttons should have clear active styling and pressed state");
});

check("random playlist toggle and unified playlist UI exist", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  assert(settings.includes("randomPlaylistEnabled: false"), "random playlist toggle should be off by default");
  assert(main.includes("this.settings.randomPlaylistEnabled = this.settings.randomPlaylistEnabled === true"), "settings loader should keep random off unless it was explicitly enabled");
  assert(main.includes("toggleRandomPlaylistMode"), "plugin should expose random playlist toggle method");
  assert(main.includes("getRandomPlaylistItem"), "plugin should choose a random playlist item");
  assert(sidebar.includes("music-pro-random-toggle"), "playlist UI should render random toggle");
  assert(sidebar.includes('"shuffle"'), "random toggle should use shuffle icon");
  assert(css.includes(".music-pro-random-toggle.is-active"), "random toggle should have active state");
  assert(css.includes(".music-pro-playlist-number {\n  display: none;"), "playlist track numbers should be hidden for clean UI");
  assert(css.includes("UI audit v5"), "stylesheet should include final UI audit pass");
});

check("random toggle is quiet, deferred, and uses one top tooltip", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const toggleBody = main.slice(main.indexOf("async toggleRandomPlaylistMode"), main.indexOf("async toggleLoopTrackMode"));
  assert(toggleBody.includes("this.settings.randomPlaylistEnabled = !this.settings.randomPlaylistEnabled"), "random toggle should only flip the setting");
  assert(toggleBody.includes("this.renderAll()"), "random toggle should refresh UI after saving");
  assert(!toggleBody.includes("new Notice") && !toggleBody.includes("this.playItem") && !toggleBody.includes("getRandomPlaylistItem"), "random toggle should not show notices or immediately switch playlists");
  assert(!sidebar.includes("title:") && !mini.includes("title:"), "Music Pro button hints should avoid native title tooltips so only one note appears");
  assert(sidebar.includes('"aria-label-position": "top"') && mini.includes('"aria-label-position": "top"'), "button hints should prefer top placement so the cursor does not cover them");
});

check("role-based UX hardening keeps startup and artwork clean", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  assert(main.includes('const firstRun = !this.settings.firstRunComplete'), "startup should detect onboarding separately");
  assert(main.includes('const startupMode: PlayerMode = firstRun ? "sidebar" : this.settings.viewMode'), "startup should honor Default view after first run");
  assert(!main.includes("Always show the full sidebar"), "startup must not force sidebar every time");
  assert(main.includes("getSavedSessionItem") && main.includes("getStartupPlaybackItem"), "startup should restore the previous session item first");
  assert(main.includes("this.playItem(item, { resume: true })"), "startup autoplay should resume the previous session timecode");
  assert(!main.includes(`this.settings.randomPlaylistEnabled
          ? this.getRandomPlaylistItem()`), "startup autoplay should not pick a new random playlist before restoring the old session");
  assert(settingsTab.includes("Pause Music Pro while Obsidian browser audio plays."), "external audio copy should match the 1s resume delay");
  assert(sidebar.includes("getPersonalAddCategoryDefinitions"), "inline add presets should come from playlist taxonomy and personal categories");
  assert(sidebar.includes("private shouldShowArtwork") && sidebar.includes("fb_placeholder"), "sidebar should hide repeated SoundCloud placeholder artwork");
  assert(mini.includes("private shouldShowArtwork") && mini.includes("fb_placeholder"), "mini dock should hide repeated SoundCloud placeholder artwork");
});

check("previous playback session restores item, playlist track, and timecode", async () => {
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/player/PlayerStore.ts", import.meta.url), "utf8");
  const types = await readFile(new URL("../src/player/types.ts", import.meta.url), "utf8");
  assert(settings.includes("currentSoundIndex") && settings.includes("currentPositionMs"), "settings should persist playlist track index and timecode");
  assert(types.includes("PlaybackResumeTarget"), "player types should expose a resume target");
  assert(main.includes("rememberPlaybackSession") && main.includes("playbackSessionSaveTimer"), "plugin should persist playback session from store updates without saving every tick");
  assert(main.includes("this.settings.currentSoundIndex = Math.max") && main.includes("this.settings.currentPositionMs = Math.max"), "settings loader should normalize saved resume fields");
  assert(store.includes("setCurrentItem(item: CatalogItem | null, resume?: PlaybackResumeTarget)"), "store should keep the saved track/time visible before the widget is ready");
  assert(player.includes("async load(item: CatalogItem, autoplay: boolean, resume?: PlaybackResumeTarget)") && player.includes("applyResumeTarget"), "SoundCloud player should seek/skip to the saved resume target");
  assert(player.includes("auto_play: widgetAutoplay") && player.includes("this.seekTo(positionMs)"), "resume should manually seek before autoplaying instead of starting from 0:00");
});

check("preview-limited SoundCloud tracks clamp playable duration", async () => {
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const types = await readFile(new URL("../src/player/types.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert(types.includes("currentSoundIsPreview"), "playback state should expose current preview status");
  assert(types.includes("isPreview?: boolean"), "sound list rows should support preview status");
  assert(player.includes("isLikelyPreviewFinish"), "player should detect early 30s preview finishes");
  assert(player.includes("applyPreviewLimitedSound"), "player should remove preview-only playlist tracks after an early preview finish");
  assert(player.includes("completedMs / advertisedMs < 0.72"), "preview detection should compare playable vs advertised duration");
  assert(main.includes("RESTRICTED_TRACK_BURST_LIMIT") && main.includes("skipDegradedPlaylist") && main.includes("previewCount * 16"), "preview-only tracks should be penalized and burst-skipped smoothly");
  assert(sidebar.includes("state.currentSoundIsPreview ? \" · Preview\""), "sidebar should label preview-limited current sound");
  assert(player.includes("Preview-only in SoundCloud embed"), "preview rows should be removed from playlists with a clear internal reason");
});

check("playlist classification skill is reusable by catalog tooling", async () => {
  const skill = await readFile(new URL("../catalog/PLAYLIST_CLASSIFICATION_SKILL.md", import.meta.url), "utf8");
  const utils = await readFile(new URL("./catalog-utils.mjs", import.meta.url), "utf8");
  const { inferPlaylistCategories } = await import("./playlist-category-rules.mjs");
  assert(skill.includes("Music Pro Playlist Classification Skill"), "classification skill doc should exist");
  assert(utils.includes("inferPlaylistCategories"), "catalog utils should use automatic playlist classification");
  assert(!inferPlaylistCategories({ title: "ambient music playlist" }).includes("Ambience"), "generic ambient music should not classify as strict Ambience");
  assert(inferPlaylistCategories({ title: "Rain forest 432 Hz meditation atmosphere" }).includes("Ambience"), "rain/frequency should classify as Ambience");
  assert(inferPlaylistCategories({ title: "Aretha Franklin classic soul playlist" }).includes("Jazz & Blues"), "soul legends should classify as Jazz & Blues");
  assert(inferPlaylistCategories({ title: "handpan kalimba meditation" }).includes("Handpan & Kalimba"), "handpan/kalimba should classify into its category");
  assert(inferPlaylistCategories({ title: "funky disco house groove" }).includes("House"), "funky/disco house should classify as House");
  assert(inferPlaylistCategories({ title: "Tommy Emmanuel acoustic guitar fingerstyle" }).includes("Acoustic"), "acoustic guitar should classify as Acoustic");
  assert(inferPlaylistCategories({ title: "Bossanova Samba Tango" }).includes("Bossa"), "legacy compressed Bossa spelling should classify as Bossa");
  assert(inferPlaylistCategories({ title: "traditional guzheng koto shakuhachi" }).includes("Asia"), "traditional Asian instruments should classify as Asia");
  assert(inferPlaylistCategories({ title: "Studio Ghibli peaceful piano OST" }).includes("Movies/Games"), "Ghibli OST should classify as Movies/Games");
  assert(inferPlaylistCategories({ title: "Studio Ghibli peaceful piano OST" }).includes("Piano"), "piano OST should classify as Piano too");
  assert(inferPlaylistCategories({ title: "Skyrim OST" }).includes("Movies/Games"), "franchise OST should classify as Movies/Games");
  assert(inferPlaylistCategories({ title: "Hans Zimmer famous movie themes" }).includes("Movies/Games"), "movie composers/themes should classify as Movies/Games");
  assert(inferPlaylistCategories({ title: "The Last of Us official soundtrack" }).includes("Movies/Games"), "broader game franchises should classify as Movies/Games");
  assert(inferPlaylistCategories({ title: "JRPG battle themes VGM playlist" }).includes("Movies/Games"), "generic game music cues should classify as Movies/Games");
  assert(inferPlaylistCategories({ title: "Anime opening themes and endings" }).includes("Movies/Games"), "anime OP/ED cues should classify as Movies/Games");
  assert(!inferPlaylistCategories({ title: "Skyrim OST" }).includes("Fantasy Folk"), "franchise-only OST should not force Fantasy Folk");
  assert(inferPlaylistCategories({ title: "Medieval tavern lute bard music" }).includes("Fantasy Folk"), "medieval tavern should classify as Fantasy Folk");
  assert(inferPlaylistCategories({ title: "Sahara oud sufi maqam" }).includes("Middle East"), "oud/sufi/maqam should classify as Middle East");
  assert(!inferPlaylistCategories({ title: "desert island chill playlist" }).includes("Middle East"), "desert alone should not force Middle East");
  assert(inferPlaylistCategories({ title: "random unrelated playlist" }).length === 0, "unmatched playlists should not fall back to Other");
  assert(!skill.includes("**Rock/Metal**") && !skill.includes("**Other**"), "classification skill should remove Rock/Metal and Other category headings");
  assert(!/Bossa\s+Nova/i.test(skill) && skill.includes("Use exactly `Bossa`"), "classification skill should not present expanded Bossa wording as stored catalog data");
});

check("large playlist catalogs are optimized for smooth UI", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("../src/catalog/PlaylistIndex.ts", import.meta.url), "utf8");
  const taxonomy = await readFile(new URL("../src/catalog/playlistCategories.ts", import.meta.url), "utf8");
  const catalogService = await readFile(new URL("../src/catalog/CatalogService.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert(index.includes("buildPlaylistIndex"), "shared playlist index should precompute category buckets");
  assert(sidebar.includes("buildPlaylistIndex") && quickPicker.includes("buildPlaylistIndex"), "sidebar and quick picker should share playlist index");
  assert(sidebar.includes("visibleItemLimit = 36"), "sidebar should render small initial batches");
  assert(sidebar.includes("document.createDocumentFragment()"), "sidebar list rows should batch DOM insertion");
  assert(sidebar.includes("IntersectionObserver"), "sidebar artwork should lazy load with IntersectionObserver");
  assert(taxonomy.includes("categoryIdsCache") && taxonomy.includes("categoryKeywordCache"), "taxonomy matching should be memoized");
  assert(catalogService.includes("activeItemsCache"), "CatalogService should reuse active item arrays");
  assert(main.includes("onLayoutReady") && main.includes("scheduleIdleTask"), "startup catalog work should be deferred/idle scheduled");
  assert(css.includes("content-visibility: auto"), "offscreen rows should opt into content visibility optimization");
});

check("slider and compact button audit fixes are present", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  assert(main.includes("setUserVolume") && main.includes("userVolumeSaveTimer"), "user volume changes should be debounced and centralized");
  assert(sidebar.includes("rangeValueFromPointer") && mini.includes("rangeValueFromPointer"), "seek/volume should support point-click pointer jumps");
  assert(sidebar.includes("renderVolumeIcon") && mini.includes("renderVolumeIcon"), "volume icon should update live with slider value");
  assert(!mini.includes("${state.volume}|${plugin.settings.autoHideMini}"), "mini dock should not rerender on every volume tick while dragging");
  assert(css.includes("UI audit v6"), "stylesheet should include slider/button audit pass");
  assert(css.includes(`left: auto;\n  bottom: auto;`), "mini handle positioning should override old centered dock coordinates");
  assert(mini.indexOf('const panel = this.root.createDiv({ cls: "music-pro-mini-panel" })') < mini.indexOf('music-pro-mini-handle'), "compact handle should be rendered inside the mini player panel");
  assert(css.includes("UI audit v8") && css.includes("grid-area: handle") && css.includes("margin-left: 0;"), "compact handle should live on the player surface, not outside it");
  assert(css.includes("--music-pro-range-volume-thumb-size: 20px"), "volume thumb should have a stable touch target");
  assert(css.includes(".music-pro-item-actions .music-pro-icon-button") && css.includes("width: 36px;"), "external/open buttons should be touch-sized");
  const compactLayoutMarker = css.lastIndexOf("UI audit v25");
  assert(compactLayoutMarker > css.lastIndexOf("UI audit v22"), "requested compact layout should override older mini player rules");
  const compactLayoutCss = css.slice(compactLayoutMarker);
  assert(mini.includes('const sliders = panel.createDiv({ cls: "music-pro-mini-sliders" })') && mini.includes('const meta = panel.createDiv({ cls: "music-pro-mini-meta" })'), "mini player should group metadata and sliders separately");
  assert(mini.indexOf('music-pro-mini-meta') < mini.indexOf('music-pro-mini-sliders') && mini.indexOf('music-pro-mini-progress') < mini.indexOf('music-pro-mini-volume'), "mini player DOM should place thumbnail/title above timeline, then volume");
  assert(mini.includes("music-pro-mini-time-left") && mini.includes("music-pro-mini-time-right") && mini.includes("music-pro-mini-volume-value"), "compact mini player should show timeline numbers and volume percent");
  assert(compactLayoutCss.includes('"handle meta transport"') && compactLayoutCss.includes('"handle sliders sliders"'), "compact grid should put thumbnail/title left, controls right, and sliders underneath");
  assert(compactLayoutCss.includes("grid-template-rows: 32px 32px") && compactLayoutCss.includes("grid-template-columns: 48px minmax(0, 1fr) 52px") && !compactLayoutCss.includes("grid-template-columns: 24px minmax(0, 1fr) 52px"), "timeline and volume should be two labeled rows with aligned range tracks");
  assert(compactLayoutCss.includes("grid-template-rows: 27px 27px") && compactLayoutCss.includes("grid-template-columns: 42px minmax(0, 1fr) 46px") && !compactLayoutCss.includes("grid-template-columns: 22px minmax(0, 1fr) 46px"), "smaller compact dock should keep timeline and volume starts aligned");
});

check("personal categories and Apple-style playlist rows are supported", async () => {
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert(settings.includes("personalCategories") && settings.includes("playlistCategoryOrder") && settings.includes("personalPlaylistAssignments"), "settings should persist personal categories, assignments, and category order");
  assert(main.includes("createPersonalCategory") && main.includes("renamePersonalCategory") && main.includes("deletePersonalCategory"), "plugin should manage personal category CRUD");
  assert(main.includes("addItemToPersonalCategory") && main.includes("removeItemFromPersonalCategory") && main.includes("getCatalogItemsWithPersonalAssignments"), "plugin should persist and remove playlist-to-personal-folder assignments");
  assert(main.includes("reorderPlaylistCategory") && main.includes("resetPlaylistCategoryOrder"), "plugin should persist draggable category order and reset");
  assert(sidebar.includes("openAddMode") && sidebar.includes("renderInlineAddPanel") && sidebar.includes("renderInlineFolderPickerPanel") && sidebar.includes("openInlineFolderPicker") && !sidebar.includes("new AddToFolderModal") && sidebar.includes("reorderPlaylistCategory"), "sidebar should expose inline add mode, inline folder picker, folder buttons, and drag category ordering");
  assert(sidebar.includes("submitInlineAdd") && sidebar.includes("getBestCategoryIdForItem") && sidebar.includes("this.query = getDisplayTitle(item)"), "inline add should navigate to the newly added item");
  assert(main.includes("openInlineAddMode") && sidebar.includes("openAddMode") && !settingsTab.includes("Add Your SoundCloud Link"), "add music should live in the main UI/command, not duplicate in Settings");
  assert(sidebar.includes("removeFolderId") && sidebar.includes("folder-minus") && sidebar.includes("removeItemFromPersonalCategory"), "folder button should remove single/current personal folder assignment in one click");
  assert(sidebar.includes("role: \"button\"") && !sidebar.includes("music-pro-item-badge\", text: this.typeLabel(item)"), "playlist rows should click-to-play without duplicate Playlist badge");
  assert(sidebar.includes("getDisplayTitle(item)") && sidebar.includes('music-pro-item-subtitle", text: getDisplaySubtitle(item) || item.artist'), "playlist cards should show compact display title then artist/context");
  assert(!sidebar.includes("labels.join(\" / \")") && !sidebar.includes("item.categories.join(\" / \")"), "playlist cards should not show category names in subtitles");
  assert(sidebar.includes("this.category = DEFAULT_PLAYLIST_CATEGORY_ID"), "sidebar should open on Editor’s Choice even when Recent is first");
  assert(main.includes("slice(0, 30)") && main.includes("ids.length >= 30"), "recent playlist history should cap at 30 items");
  assert((settingsTab.includes("Reset order") || settingsTab.includes("Reset Order")) && !settingsTab.includes("renderPlaylistFolderOrder") && settingsTab.includes("New Personal Playlist"), "settings should expose category reset and personal category creation without duplicating folder sorting");
  assert(sidebar.includes("Create") && sidebar.includes("addSelectedCategories") && sidebar.includes("getPersonalAddCategoryDefinitions"), "inline add panel should create/select personal categories");
  assert(sidebar.includes("Create & Add") && sidebar.includes("folderPickerNewName") && sidebar.includes("settings.personalCategories"), "inline folder picker should choose/create personal folders only");
  assert(sidebar.includes("toggleInlineFolderAssignment") && sidebar.includes("removeItemFromPersonalCategory"), "inline folder picker should toggle added folders off without a modal");
  assert(css.includes("music-pro-rail-icon-button") && css.includes("music-pro-inline-add-panel") && css.includes("music-pro-inline-folder-picker"), "stylesheet should include refreshed Apple-style inline add/category/folder controls");
});

check("personal folder user links remove safely with two row actions", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  assert(sidebar.includes('item.source === "user" && !this.plugin.isPersonalCategory(this.category)'), "personal folder rows should hide the extra trash button for user-added links");
  assert(sidebar.includes('await this.plugin.removeItemFromPersonalCategory(item, removeFolderId)') && sidebar.includes('item.source === "user" && this.plugin.getItemPersonalCategoryIds(item).length === 0'), "folder-minus should remove a user link from only the current personal folder first");
  assert(sidebar.includes('await this.plugin.removeUserItem(item.id)') && !sidebar.includes("removed from playlist and deleted personal link"), "user link should be deleted only after it no longer belongs to any personal folder and without a success notice");
});

check("playlist folder add/remove stays inline and quiet", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v68");
  assert(marker > css.lastIndexOf("UI audit v67"), "inline folder picker quieting should come after drag handle polish");
  const v68 = css.slice(marker);
  assert(sidebar.includes("renderInlineFolderPickerPanel") && sidebar.includes("music-pro-inline-folder-picker") && sidebar.includes("Create & Add") && sidebar.includes("Done"), "catalog playlist folder adds should use an inline choose/create panel");
  assert(!sidebar.includes("new AddToFolderModal") && !sidebar.includes("Music Pro: removed") && !sidebar.includes("Music Pro: added") && !sidebar.includes("already in library") && !sidebar.includes("removed personal link."), "sidebar add/remove actions should not show noisy success notices");
  assert(!sidebar.includes("AddSoundCloudModal") && !sidebar.includes("AddToFolderModal"), "legacy add/folder modal flows should stay removed");
  assert(v68.includes(".music-pro-inline-folder-picker") && v68.includes(".music-pro-inline-folder-picker-subtitle") && v68.includes("text-overflow: ellipsis"), "inline folder picker should have compact styling for the selected playlist title");
});

check("now playing timeline and volume never overlap while resizing", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v19");
  assert(marker > css.lastIndexOf("UI audit v18"), "resize-safe now-playing controls should override earlier v18 slider layout");
  const rangeCss = css.slice(marker);
  assert(rangeCss.includes("grid-template-columns: minmax(0, 1fr);"), "bottomline should stack by default during sidebar resize");
  assert(rangeCss.includes("@container (min-width: 720px)"), "side-by-side sliders should only return when the card is wide enough");
  assert(rangeCss.includes("grid-template-columns: minmax(260px, 1fr) minmax(184px, 226px);"), "wide layout should reserve enough room for timeline and volume columns");
  assert(rangeCss.includes("grid-template-columns: 24px minmax(0, 1fr) minmax(42px, max-content);"), "volume row should use a shrink-safe internal grid");
  assert(rangeCss.includes("max-width: 286px;"), "stacked volume row should not stretch into the timeline visually");
});

check("SoundCloud playlists hydrate full track metadata", async () => {
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/player/PlayerStore.ts", import.meta.url), "utf8");
  const types = await readFile(new URL("../src/player/types.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  assert(player.includes('import { requestUrl } from "obsidian"'), "player should use Obsidian requestUrl to fetch public SoundCloud metadata without browser CORS issues");
  assert(player.includes("fetchSoundCloudPlaylistTracks") && player.includes("extractSoundCloudHydration"), "player should parse SoundCloud page hydration for playlist tracks");
  assert(player.includes("api-v2.soundcloud.com/tracks?ids=") && player.includes("apiClient"), "player should expand shallow playlist track IDs through the public SoundCloud track endpoint");
  assert(player.includes("mergeSoundLists") && player.includes("isPlaceholderSound"), "hydrated metadata should replace Track N placeholders without losing widget state");
  assert(player.includes("schedulePlaylistMetadataHydration") && player.includes("lastHydrationKey"), "playlist hydration should be scheduled once per loaded playlist");
  assert(player.includes("EXCLUDED_PLAYLIST_TRACK_MAX_DURATION_MS = 30_000") && player.includes("filterAutoplayUnfitPlaylistSounds") && player.includes("sound.durationMs > 0 && sound.durationMs <= EXCLUDED_PLAYLIST_TRACK_MAX_DURATION_MS"), "loaded playlists should remove tracks that are 30 seconds or shorter after duration metadata is known");
  assert(player.includes("skipFilteredCurrentSound") && player.includes("findNextSoundAtOrAfter"), "if SoundCloud lands on a filtered short track, playback should jump to the next visible track");
  assert(sidebar.includes("No Tracks Longer Than 30 Seconds."), "Tracks panel should explain when all playlist tracks were filtered for being too short");
  assert(types.includes("soundListVersion") && store.includes("soundListVersion") && sidebar.includes("state.soundListVersion"), "sidebar should rerender when track metadata changes even if playlist length stays the same");
});

check("personal folder playlists can be drag-sorted", async () => {
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert(settings.includes("personalFolderItemOrders"), "settings should persist per-folder playlist order");
  assert(main.includes("reorderPersonalFolderItem") && main.includes("getOrderedPersonalFolderItems") && main.includes("getItemOrderKey"), "plugin should expose stable per-folder playlist ordering");
  assert(main.includes("appendItemToPersonalFolderOrder") && main.includes("removeItemFromPersonalFolderOrder"), "folder item order should update when playlists are added or removed from a folder");
  assert(sidebar.includes("canReorderPersonalFolderItems") && sidebar.includes("renderPersonalFolderItemDragHandle"), "personal folder rows should render a drag handle only inside personal folders");
  assert(sidebar.includes("text/music-pro-personal-folder-item-key") && sidebar.includes("is-folder-drop-before") && sidebar.includes("is-folder-drop-after"), "drag/drop should support moving playlist rows before or after the target row");
  assert(sidebar.includes("getOrderedPersonalFolderItems(categoryId, items)") || main.includes("return this.getOrderedPersonalFolderItems(categoryId, items)"), "folder rendering should apply saved custom playlist order");
  assert(css.includes("UI audit v23") && css.includes(".music-pro-folder-item-drag-handle") && css.includes("grid-template-columns: 22px 50px minmax(0, 1fr) auto"), "stylesheet should support personal folder drag handles and drop indicators");
});

check("playlist rail actions stay clear of search", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v24");
  assert(marker > css.lastIndexOf("UI audit v23"), "playlist/search collision fix should override previous rail rules");
  const v24 = css.slice(marker);
  assert(sidebar.includes('text: "Playlists"') && sidebar.includes('"Add SoundCloud link or Personal Playlist"'), "rail should use plural Playlists naming in visible/header copy");
  assert(v24.includes("grid-template-columns: minmax(236px, 0.40fr) minmax(0, 1fr)") && v24.includes("column-gap: 22px"), "desktop rail should reserve room and spacing before the search field");
  assert(v24.includes(".music-pro-playlist-content") && v24.includes(".music-pro-library-panel .music-pro-search-wrap") && v24.includes("min-width: 0"), "search column should shrink safely without being overlapped");
  assert(v24.includes("@container (max-width: 640px)") && v24.includes("grid-template-columns: minmax(176px, 0.45fr) minmax(0, 1fr)") && v24.includes("row-gap: 8px"), "narrow widths should stack rail buttons under the title instead of spilling into search");
  assert(v24.includes("@container (max-width: 430px)") && v24.includes("grid-template-columns: minmax(0, 1fr)") && v24.includes("flex-direction: column"), "very narrow sidebar should stack search below the vertical playlist rail");
});

check("only personal folders show playlist counts in the rail", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v26");
  assert(marker > css.lastIndexOf("UI audit v25"), "personal-folder count override should be the latest playlist rail pass");
  const v26 = css.slice(marker);
  assert(sidebar.includes('if (isPersonal) button.createSpan({ cls: "music-pro-playlist-category-count"'), "rail count badge should render only for personal folders");
  assert(sidebar.includes("? `${definition.label} · ${option.count} playlists · Right-click to rename/delete`") && sidebar.includes(": definition.label"), "built-in playlist categories should not expose counts in their label/tooltip");
  assert(!sidebar.includes(": `${definition.label} · ${option.count} playlists`"), "built-in playlist categories should not include playlist counts");
  assert(v26.includes(".music-pro-playlist-category {\n  grid-template-columns: 24px minmax(0, 1fr);") && v26.includes(".music-pro-playlist-category.is-personal {\n  grid-template-columns: 24px minmax(0, 1fr) auto;"), "rail layout should reserve a count column only for Personal Folders");
});

check("personal folders do not show helper descriptions", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  assert(main.includes('description: ""') && !main.includes("Personal Playlist saved in this vault") && !main.includes("Personal category saved in this vault"), "personal folder definitions should not carry helper copy");
  assert(sidebar.includes("this.plugin.isPersonalCategory(this.category)") && sidebar.includes("!definition.description.trim()"), "sidebar intro should skip Personal Folders and empty descriptions");
});

check("Tracks and Playlists headings share one visual weight", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v29");
  assert(marker > css.lastIndexOf("UI audit v28"), "heading alignment should override older section/rail title rules");
  const v29 = css.slice(marker);
  assert(v29.includes(".music-pro-playlist-header .music-pro-section-title,\n.music-pro-playlist-rail-title"), "Tracks and Playlists labels should be styled by one shared selector");
  assert(v29.includes("font-size: 15px") && v29.includes("font-weight: 820") && v29.includes("color: var(--text-normal)") && v29.includes("opacity: 1"), "Tracks and Playlists labels should match size, weight, and opacity");
});

check("settings are open, streamlined, and preset colors are visible", async () => {
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v31");
  assert(marker > css.lastIndexOf("UI audit v30"), "settings redesign should override older settings/preset styles without stealing the compact mini v30 marker");
  const v31 = css.slice(marker);
  assert(settingsTab.includes("createSettingsSection") && settingsTab.includes("music-pro-settings-section") && !settingsTab.includes('createEl("details"') && !settingsTab.includes('createEl("summary"'), "settings should use always-open sections instead of collapsed details accordions");
  assert(!settingsTab.includes("Add Your SoundCloud Link") && !settingsTab.includes("Default Volume") && !settingsTab.includes("Default View") && !settingsTab.includes("Remote Catalog URL") && !settingsTab.includes("Use Remote Catalog"), "settings should omit controls already handled in the main UI or advanced developer-only fields");
  assert(settingsTab.includes("music-pro-accent-swatch-color") && !settingsTab.includes("music-pro-accent-swatch-label"), "accent presets should render color-only chips without visible color names");
  assert(settingsTab.includes("A plug-and-play music app for deep work.") && settingsTab.includes("Color and background.") && settingsTab.includes("Choose what shows and loads.") && !settingsTab.includes("Catalog Maintenance") && !settingsTab.includes("Refresh or clear cached catalog data."), "settings should keep catalog maintenance out of the normal user UI");
  assert(!settingsTab.includes("Keep only behavior that is not already easier to adjust from the player UI.") && !settingsTab.includes("Control what Music Pro indexes, renders, searches, and preserves in this vault.") && !settingsTab.includes("Lightweight maintenance only; add music, loop, volume, and view mode are controlled directly in the Music Pro UI."), "settings should not reintroduce verbose helper copy");
  assert(v31.includes(".music-pro-accent-swatch-color") && v31.includes("background-color: var(--music-pro-swatch)") && v31.includes(".music-pro-accent-swatch-label"), "preset color swatches should show the actual selected color rather than dark generic buttons");
  assert(v31.includes(".music-pro-category-toggle-grid") && v31.includes("repeat(auto-fit, minmax(190px, 1fr))"), "playlist performance toggles should be visible in an open responsive grid");
  const heroMarker = css.lastIndexOf("UI audit v85");
  assert(heroMarker > css.lastIndexOf("UI audit v84"), "settings hero alignment should come after default-like settings gutter fixes");
  const heroCss = css.slice(heroMarker);
  assert(heroCss.includes(".music-pro-settings.music-pro-fixed-appearance .music-pro-settings-hero h2,\n.music-pro-settings.music-pro-fixed-appearance .music-pro-settings-hero p") && heroCss.includes("padding-inline: 0 !important") && heroCss.includes("text-indent: 0 !important"), "settings hero title and slogan should share one left edge across themes");
});

check("Show More rows stay count-free", async () => {
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  assert(sidebar.includes('text: "Show More"'), "Show More button should use simple copy");
  assert(!sidebar.includes("music-pro-show-more-count"), "Show More row should not render a separate count label");
  assert(!sidebar.includes("shown`") && !sidebar.includes("Show ${Math.min"), "Show More copy should not include visible/remaining totals");
});

check("compact MiniPlayer is smaller and tucks as a whole panel", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v30");
  assert(marker > css.lastIndexOf("UI audit v29"), "compact MiniPlayer audit should be the latest mini dock pass");
  const v30 = css.slice(marker);
  assert(v30.includes("--music-pro-mini-width: min(504px, calc(100vw - 24px))"), "open compact panel should be materially smaller than the old wide dock");
  assert(v30.includes("--music-pro-mini-peek: 30px") && v30.includes("translate3d(calc(100% - var(--music-pro-mini-peek)), -7px, 0) scale(0.965)"), "auto-hide should tuck the whole panel into the corner with a small visible edge");
  assert(v30.includes("grid-template-rows: 27px 27px") && v30.includes("grid-template-columns: 42px minmax(0, 1fr) 46px") && !v30.includes("grid-template-columns: 22px minmax(0, 1fr) 46px"), "timeline and volume should remain visible as two aligned slider rows with matching left rails");
  assert(v30.includes(".music-pro-mini-dock.is-visible.is-autohide:not(.is-proximity-open):not(:hover):not(:focus-within) .music-pro-mini-volume") && v30.includes("display: grid;"), "auto-hide should not collapse the volume row inside the panel");
  assert(v30.includes("max-width: 224px") && v30.includes("text-overflow: ellipsis"), "track names should intentionally truncate inside the smaller compact card");
  assert(mini.includes("nearCorner") && mini.includes("proximityCornerWidth = 48") && mini.includes("proximityXPadding = 56"), "proximity detection should open from a tighter Obsidian-corner sweep zone");
});

check("compact MiniPlayer has larger controls and inline current-playlist quick pick", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v32");
  assert(marker > css.lastIndexOf("UI audit v31"), "latest compact-player polish should come after settings layout");
  const v32 = css.slice(marker);
  assert(mini.includes("trackPickerOpen") && mini.includes("renderTrackPicker") && mini.includes("this.plugin.getOrderedSounds()"), "mini dock should render an inline picker for tracks in the current playlist");
  assert(mini.includes("this.plugin.skipToPlaylistTrack(sound.originalIndex)") && !mini.includes("picker.addEventListener(\"click\", () => this.plugin.openQuickPicker())"), "compact quick pick should select a current playlist track instead of opening the old global popup");
  assert(mini.includes("state.soundListVersion") && mini.includes("playlistReady"), "mini dock should rerender when playlist track hydration changes quick-pick availability");
  assert(v32.includes("--music-pro-mini-peek: 34px") && v32.includes(":not(.is-track-picker-open)") && v32.includes("translate3d(calc(100% - var(--music-pro-mini-peek)), -7px, 0) scale(0.965)"), "compact dock should tuck firmly into the edge when the pointer is away");
  assert(v32.includes(".music-pro-mini-transport .music-pro-mini-play") && v32.includes("width: 52px") && v32.includes(".music-pro-mini-track-picker"), "mini controls should be larger and the track picker should drop down under the volume slider");
  assert(v32.includes("@keyframes music-pro-mini-track-picker-in") && v32.includes("180ms cubic-bezier(0.22, 1, 0.36, 1)"), "inline track picker should open with a smooth fast animation");
});

check("Tracks panel keeps a stable height during playlist selection", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v33");
  assert(marker > css.lastIndexOf("UI audit v32"), "Tracks layout stabilization should be the latest playlist/compact pass");
  const v33 = css.slice(marker);
  assert(v33.includes("--music-pro-tracks-panel-height: clamp(322px, 34vh, 390px)"), "Tracks panel should reserve one stable desktop height");
  assert(v33.includes(".music-pro-playlist-tracks,\n.music-pro-playlist-tracks.is-loading") && v33.includes("height: var(--music-pro-tracks-panel-height)") && v33.includes("max-height: var(--music-pro-tracks-panel-height)"), "loading and loaded Tracks panels should share the same height");
  assert(v33.includes("display: flex") && v33.includes("flex-direction: column") && v33.includes("contain: layout paint"), "Tracks panel should isolate layout changes inside its own surface");
  assert(v33.includes(".music-pro-playlist-tracks .music-pro-playlist-list,\n.music-pro-playlist-tracks .music-pro-playlist-skeleton-list") && v33.includes("overflow-y: auto") && v33.includes("scrollbar-gutter: stable"), "real and skeleton track lists should scroll internally without resizing the page");
  assert(v33.includes("@container (max-width: 520px)") && v33.includes("clamp(304px, 38vh, 356px)"), "narrow sidebars should keep a smaller but still stable Tracks height");
});

check("playlist folder drag cursor stays calm until hold", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v34");
  assert(marker > css.lastIndexOf("UI audit v33"), "drag cursor calm-down should be the latest playlist polish");
  const v34 = css.slice(marker);
  assert(v34.includes(".music-pro-playlist-category,\n.music-pro-playlist-category:hover") && v34.includes("cursor: pointer;"), "folder/category rows should keep the normal clickable pointer on hover");
  assert(v34.includes(".music-pro-folder-item-drag-handle,\n.music-pro-folder-item-drag-handle:hover") && v34.includes("cursor: pointer;"), "personal folder drag handles should not show the grab cursor just on hover");
  assert(v34.includes(".music-pro-playlist-category:active") && v34.includes(".music-pro-folder-item-drag-handle:active") && v34.includes("cursor: grabbing;"), "grab cursor should only appear while actively holding/dragging");
});

check("narrow playlist rail is horizontal and Music Pro scrollbars are hidden", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v35");
  assert(marker > css.lastIndexOf("UI audit v34"), "narrow horizontal rail and hidden-scrollbar pass should be the latest sidebar polish");
  const v35 = css.slice(marker);
  assert(v35.includes(".music-pro-view-container .view-content") && v35.includes(".music-pro-sidebar") && v35.includes("overscroll-behavior: contain"), "main Music Pro app scroller should keep scroll functionality while hiding the visible scrollbar");
  assert(v35.includes("scrollbar-width: none") && v35.includes("-ms-overflow-style: none") && v35.includes("::-webkit-scrollbar") && v35.includes("display: none;"), "Music Pro scroll containers should hide Firefox, legacy Edge, and WebKit scrollbars");
  assert(v35.includes("@container (max-width: 430px)") && v35.includes("grid-template-columns: minmax(0, 1fr)") && v35.includes("flex-direction: row") && v35.includes("overflow-x: auto") && v35.includes("overflow-y: hidden"), "very narrow sidebar should keep Playlists as a horizontal rail instead of a tall vertical stack");
  assert(v35.includes("scrollbar-gutter: auto") && v35.includes("padding-right: 0"), "hidden internal playlist scrollbars should not leave a large gutter");
});

check("folder dragging arms only after a short hold", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v36");
  assert(marker > css.lastIndexOf("UI audit v35"), "hold-to-drag cursor pass should come after narrow rail polish");
  const v36 = css.slice(marker);
  assert(sidebar.includes("dragHoldDelayMs = 230") && sidebar.includes("attachHoldToDrag") && sidebar.includes("window.setTimeout(() =>") && sidebar.includes("source.draggable = true"), "folder/category drag should arm only after a deliberate hold");
  assert(sidebar.includes("Math.hypot") && sidebar.includes("cancelMovePx = 7") && sidebar.includes("if (!dragArmed)") && sidebar.includes("event.preventDefault()"), "small accidental moves before the hold should cancel native drag");
  assert(sidebar.includes("this.attachHoldToDrag(button") && !sidebar.includes("this.attachHoldToDrag(handle"), "playlist folder rail should use hold-to-drag, but personal playlist item handles should drag immediately");
  assert(v36.includes(".music-pro-playlist-category:active") && v36.includes(".music-pro-folder-item-drag-handle:active") && v36.includes("cursor: pointer;"), "pressing should not instantly show the grabbing cursor");
  assert(v36.includes(".music-pro-playlist-category.is-drag-armed") && v36.includes(".music-pro-folder-item-drag-handle.is-drag-armed") && v36.includes("cursor: grabbing;"), "grabbing cursor should appear only after the hold arms dragging");
});

check("sidebar header is optically centered above the player", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v37");
  assert(marker > css.lastIndexOf("UI audit v36"), "header centering should be the latest sidebar spacing pass");
  const v37 = css.slice(marker);
  assert(v37.includes("padding-top: 14px") && v37.includes("transform: translateY(-4px)") && v37.includes("margin-bottom: 10px"), "header block should move up slightly while preserving breathing room above the player");
  assert(v37.includes(".music-pro-title-row") && v37.includes("align-items: center"), "title row and Support should align vertically");
  assert(v37.includes(".music-pro-title-row .music-pro-support-link") && v37.includes("align-self: center") && v37.includes("transform: translateY(2px)"), "Support button should be optically aligned with Music Pro title");
  assert(v37.includes("@media (max-width: 560px)") && v37.includes("transform: translateY(-3px)"), "small sidebars should use a slightly softer upward nudge");
});

check("compact MiniPlayer is reduced by roughly one quarter", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v38");
  assert(marker > css.lastIndexOf("UI audit v37"), "compact shrink pass should come after header centering");
  const v38 = css.slice(marker);
  assert(v38.includes("--music-pro-mini-width: min(405px, calc(100vw - 18px))") && v38.includes("--music-pro-mini-peek: 26px"), "open compact dock should be about 25% narrower than the previous 540px layout");
  assert(v38.includes("min-height: 96px") && v38.includes("border-radius: 20px") && v38.includes("grid-template-columns: 14px minmax(0, 1fr) max-content"), "compact panel frame should be visibly smaller without changing its layout model");
  assert(v38.includes("width: 28px") && v38.includes("width: 38px") && v38.includes("font-size: 12.2px"), "transport controls, play button, and title type should be scaled down together");
  assert(v38.includes("grid-template-rows: 22px 22px") && v38.includes("grid-template-columns: 34px minmax(0, 1fr) 40px"), "timeline and volume rows should stay always visible but slimmer");
  assert(v38.includes(".music-pro-mini-dock.is-track-picker-open") && v38.includes("min-height: 268px") && v38.includes("max-height: 145px"), "inline track picker should shrink with the compact dock");
  assert(v38.includes("@media (max-width: 560px)") && v38.includes("--music-pro-mini-width: min(360px, calc(100vw - 14px))") && v38.includes("min-height: 132px"), "small screens should get a narrower responsive compact dock");
});

check("full and compact players avoid unnecessary white chrome", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v39");
  assert(marker > css.lastIndexOf("UI audit v38"), "quiet player chrome pass should come after the compact shrink pass");
  const v39 = css.slice(marker);
  assert(v39.includes("--music-pro-player-hairline") && v39.includes("--music-pro-player-control-border"), "player borders should use quiet material hairlines instead of bright white outlines");
  assert(v39.includes("--music-pro-range-thumb: color-mix(in srgb, var(--text-normal) 82%, var(--background-secondary) 18%)"), "range thumbs should be softened instead of pure white");
  assert(v39.includes(".music-pro-now-card,\n.music-pro-now-card-option-b") && v39.includes(".music-pro-mini-panel"), "both full and compact player surfaces should receive the quieter chrome");
  assert(v39.includes(".music-pro-controls,\n.music-pro-mini-transport") && v39.includes("box-shadow: none;"), "full and compact transport/control clusters should drop the white inset rim");
  assert(v39.includes(".music-pro-now-card-option-b .music-pro-seek-slider::-webkit-slider-thumb") && v39.includes(".music-pro-mini-sliders .music-pro-volume::-moz-range-thumb"), "timeline and volume thumbs should be covered in both WebKit and Firefox for full and compact players");
});

check("settings use color-only presets and keep playlist order simple", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v40");
  assert(marker > css.lastIndexOf("UI audit v39"), "settings cleanup should come after the quiet chrome pass");
  const v40 = css.slice(marker);
  assert(settingsTab.includes("Reset Order") && settingsTab.includes("resetPlaylistCategoryOrder") && !settingsTab.includes("renderPlaylistFolderOrder") && !settingsTab.includes("Folder Order"), "settings should keep only the default order reset and leave manual sorting to the main UI");
  assert(settingsTab.includes("music-pro-accent-swatch-color") && !settingsTab.includes("music-pro-accent-swatch-label"), "preset buttons should render only color circles, with names kept in aria labels");
  assert(!settingsTab.includes("Catalog Maintenance") && !settingsTab.includes("Clear Remote Cache") && !settingsTab.includes("Refresh or clear cached catalog data."), "catalog maintenance should not appear in normal settings");
  assert(v40.includes(".music-pro-accent-swatch {") && v40.includes("width: 46px") && v40.includes(".music-pro-accent-swatch-label") && v40.includes("display: none;"), "preset chip styling should stay compact and color-only");
  assert(!v40.includes(".music-pro-folder-order-settings") && !v40.includes(".music-pro-folder-order-row.setting-item"), "settings stylesheet should not keep unused Folder Order controls");
});

check("Quick Pick stays header-free with hidden scrollbars", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v41");
  assert(marker > css.lastIndexOf("UI audit v40"), "Quick Pick quiet pass should come after the latest settings/player polish");
  const v41 = css.slice(marker);
  const trackPicker = mini.slice(mini.indexOf("private renderTrackPicker"));
  assert(!trackPicker.includes("music-pro-mini-track-picker-head") && !trackPicker.includes("Current Playlist") && !trackPicker.includes("sounds.length} tracks"), "inline quick pick should not render a Current Playlist/count header");
  assert(trackPicker.includes('attr: { "aria-label": "Playlist tracks" }'), "inline quick pick should keep a concise accessible label without visible header copy");
  assert(v41.includes(".music-pro-mini-track-picker-head") && v41.includes("display: none"), "any legacy inline quick-pick header should be visually suppressed");
  assert(v41.includes(".music-pro-mini-track-picker-list") && v41.includes(".music-pro-quick-list") && v41.includes("scrollbar-width: none") && v41.includes("-ms-overflow-style: none") && v41.includes("::-webkit-scrollbar") && v41.includes("display: none"), "quick pick scroll containers should keep scrolling while hiding visible scrollbars");
});

check("compact dock glides smoothly and uses size-mode icons", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v42");
  assert(marker > css.lastIndexOf("UI audit v41"), "smooth compact animation pass should come after Quick Pick polish");
  const v42 = css.slice(marker);
  assert(v42.includes("transform 460ms cubic-bezier(0.16, 1, 0.3, 1)") && v42.includes("opacity 220ms ease") && v42.includes("filter 260ms ease"), "mini dock reveal/collapse should use a slower Apple-like easing curve");
  assert(v42.includes("backface-visibility: hidden") && v42.includes("will-change: transform, opacity, filter"), "mini dock animation should be promoted and avoid visual jitter");
  assert(v42.includes(".music-pro-mini-dock.is-visible.is-autohide:not(.is-proximity-open)") && v42.includes("scale(0.955)"), "tucked compact state should keep the refined smaller corner transform");
  assert(v42.includes("@media (prefers-reduced-motion: reduce)") && v42.includes("transform 120ms ease"), "reduced-motion users should get a shorter transition");
  assert(mini.includes('setIcon(expand, "maximize-2")') && sidebar.includes('setIcon(miniBtn, "minimize-2")'), "compact/full buttons should use maximize/minimize size-mode symbols");
  assert(!main.includes('state.mode === "mini" ? "maximize-2" : "minimize-2"') && !main.includes("Toggle Music Pro view"), "removed status toggle should not leave a lower-chrome compact/full button behind");
  assert(!mini.includes('setIcon(expand, "arrow-up-to-line")') && !sidebar.includes('setIcon(miniBtn, "panel-right-close")'), "old directional/sidebar icons should be removed from primary mode buttons");
});

check("compact dock has larger glyphs, tighter reveal zone, and borderless sliders", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v43");
  assert(marker > css.lastIndexOf("UI audit v42"), "compact glyph/proximity/slider cleanup should come after smooth compact animation");
  const v43 = css.slice(marker);
  assert(mini.includes("proximityCollapseDelayMs = 30") && mini.includes("this.proximityCollapseDelayMs"), "compact dock should tuck back after a 30ms idle delay when the pointer does not enter it");
  assert(mini.includes("proximityXPadding = 56") && mini.includes("proximityYPadding = 52") && mini.includes("proximityCornerWidth = 48") && mini.includes("proximityTrailingPadding = 12"), "compact reveal detection should use a smaller hover/proximity zone");
  assert(mini.includes("if (this.proximityOpen)") && mini.includes("this.queueProximityClose();") && mini.includes("if (nearDock || nearCorner)"), "near-zone reveal should schedule collapse, and an already-open dock should close unless the pointer actually enters it");
  assert(v43.includes(".music-pro-mini-transport .music-pro-icon-button svg") && v43.includes("width: 16px") && v43.includes("stroke-width: 2.55px"), "secondary compact symbols should be visibly larger without enlarging the buttons");
  assert(v43.includes(".music-pro-mini-transport .music-pro-mini-play svg") && v43.includes("width: 20px") && v43.includes("stroke-width: 2.6px"), "compact play/pause symbol should be clearer");
  assert(v43.includes(".music-pro-now-card-option-b .music-pro-seek-slider::-webkit-slider-runnable-track") && v43.includes(".music-pro-mini-sliders .music-pro-volume::-moz-range-progress") && v43.includes("border: 0;") && v43.includes("box-shadow: none;"), "timeline and volume rails should not show white borders in full or compact players");
  assert(v43.includes("--music-pro-range-track: color-mix(in srgb, var(--background-modifier-border) 50%, transparent)"), "compact slider rail should use a quiet border color instead of white chrome");
});

check("player timeline and volume sliders have no white rim", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v44");
  assert(marker > css.lastIndexOf("UI audit v43"), "player slider rim removal should come after compact borderless slider polish");
  const v44 = css.slice(marker);
  assert(v44.includes("--music-pro-range-thumb: color-mix(in srgb, var(--text-muted) 74%, var(--background-secondary) 26%)"), "range thumb should be muted gray material, not a white knob/rim");
  assert(v44.includes(".music-pro-now-card-option-b .music-pro-seek-slider,") && v44.includes(".music-pro-now-card-option-b .music-pro-volume,") && v44.includes("border: 0 !important") && v44.includes("outline: 0 !important") && v44.includes("box-shadow: none !important"), "full-player timeline and volume inputs should not render white outlines or halos");
  assert(v44.includes(".music-pro-now-card-option-b .music-pro-seek-slider::-webkit-slider-thumb") && v44.includes(".music-pro-now-card-option-b .music-pro-volume::-webkit-slider-thumb") && v44.includes("background: var(--music-pro-range-thumb)") && v44.includes("box-shadow: var(--music-pro-range-thumb-shadow) !important"), "WebKit full-player slider thumbs should be muted and borderless");
  assert(v44.includes(".music-pro-now-card-option-b .music-pro-seek-slider::-moz-range-thumb") && v44.includes(".music-pro-now-card-option-b .music-pro-volume::-moz-range-thumb"), "Firefox full-player slider thumbs should also be borderless");
  assert(v44.includes(".music-pro-mini-sliders .music-pro-volume::-webkit-slider-thumb") && v44.includes(".music-pro-mini-sliders .music-pro-volume::-moz-range-thumb"), "compact dock sliders should keep the same no-white-rim treatment");
});

check("full player delays meter stacking until truly tiny", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v50");
  assert(marker > css.lastIndexOf("UI audit v49"), "meter stacking threshold should override the latest compact glyph pass");
  const v48 = css.slice(marker);
  assert(v48.includes("grid-template-columns: minmax(0, 1fr) minmax(112px, 0.42fr)") && v48.includes("column-gap: 9px"), "screenshot-width player should keep timeline and volume side-by-side instead of stacking too early");
  assert(v48.includes(".music-pro-now-card-option-b .music-pro-progress-compact") && v48.includes("grid-template-columns: 38px minmax(50px, 1fr) 38px"), "horizontal timeline row should stay compact enough for narrow sidebars");
  assert(v48.includes(".music-pro-now-card-option-b .music-pro-now-volume") && v48.includes("grid-template-columns: 22px minmax(44px, 1fr) 44px"), "horizontal volume row should use compact icon/slider/percent columns");
  assert(v48.includes("--music-pro-meter-opacity") && v48.includes("opacity: var(--music-pro-meter-opacity, 0.84)") && v48.includes(".music-pro-now-card-option-b .music-pro-now-volume-icon"), "time labels, volume percent, and volume symbol should keep matching muted opacity");
  assert(v48.includes("@container (max-width: 330px)") && v48.includes("grid-template-columns: minmax(0, 1fr)") && v48.includes("grid-template-columns: 38px minmax(0, 1fr) 42px"), "timeline and volume should stack only when the player is truly extra-narrow");
});

check("compact player slider rails match thickness and glyphs are readable", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v47");
  assert(marker > css.lastIndexOf("UI audit v46"), "compact slider/glyph readability pass should come after final narrow full-player meter alignment");
  const v46 = css.slice(marker);
  assert(v46.includes("--music-pro-mini-range-track-height: 5px"), "compact timeline and volume rails should share one explicit thickness variable");
  assert(v46.includes(".music-pro-mini-sliders .music-pro-seek-slider::-webkit-slider-runnable-track,\n.music-pro-mini-sliders .music-pro-volume::-webkit-slider-runnable-track") && v46.includes("height: var(--music-pro-mini-range-track-height) !important"), "WebKit compact timeline and volume rails should use the same height");
  assert(v46.includes(".music-pro-mini-sliders .music-pro-seek-slider::-moz-range-track,\n.music-pro-mini-sliders .music-pro-volume::-moz-range-track") && v46.includes(".music-pro-mini-sliders .music-pro-seek-slider::-moz-range-progress,\n.music-pro-mini-sliders .music-pro-volume::-moz-range-progress"), "Firefox compact timeline and volume rails/progress should use the same height");
  assert(v46.includes(".music-pro-mini-transport .music-pro-icon-button svg") && v46.includes("width: 19px") && v46.includes("stroke-width: 2.8px"), "compact secondary symbols should be large enough to identify");
  assert(v46.includes(".music-pro-mini-transport .music-pro-mini-play svg") && v46.includes("width: 24px") && v46.includes("stroke-width: 2.85px"), "compact play/pause symbol should be materially larger than before");
  assert(v46.includes(".music-pro-mini-sliders .music-pro-mini-volume-icon svg") && v46.includes("width: 20px") && v46.includes("stroke-width: 2.7px"), "compact volume symbol should be clearly readable");
  assert(v46.includes("color: color-mix(in srgb, var(--text-normal) 88%, var(--interactive-accent) 12%)") && v46.includes("opacity: 1"), "compact glyphs should be visible, not faint");
});

check("compact button glyphs are oversized for glanceability", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v51");
  assert(marker > css.lastIndexOf("UI audit v50"), "oversized compact glyph pass should come after full-player meter tuning");
  const v48 = css.slice(marker);
  assert(v48.includes(".music-pro-mini-transport .music-pro-icon-button svg,\n.music-pro-mini-actions .music-pro-icon-button svg") && v48.includes("width: 22px") && v48.includes("height: 22px") && v48.includes("stroke-width: 3px"), "compact secondary button symbols should be large enough to identify at a glance");
  assert(v48.includes(".music-pro-mini-transport .music-pro-mini-play svg") && v48.includes("width: 28px") && v48.includes("height: 28px") && v48.includes("stroke-width: 3.05px"), "compact play/pause glyph should be substantially larger than the surrounding symbols");
  assert(v48.includes(".music-pro-mini-sliders .music-pro-mini-volume-icon svg") && v48.includes("width: 23px") && v48.includes("height: 23px") && v48.includes("stroke-width: 2.9px"), "compact volume glyph should stay readable beside the slider");
});

check("Tracks loading and loaded states share one measured frame", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v52");
  assert(marker > css.lastIndexOf("UI audit v51"), "Tracks stable-frame pass should come after the latest compact player polish");
  const v52 = css.slice(marker);
  assert(sidebar.includes("music-pro-playlist-loading-label"), "loading copy should have a dedicated class so it can be removed from visual layout without losing context");
  assert(v52.includes(`.music-pro-playlist-tracks,
.music-pro-playlist-tracks.is-loading`) && v52.includes("--music-pro-tracks-panel-height: clamp(356px, 38vh, 390px)") && v52.includes("block-size: var(--music-pro-tracks-panel-height)") && v52.includes("max-block-size: var(--music-pro-tracks-panel-height)"), "loading and hydrated Tracks cards should use the exact same measured frame");
  assert(v52.includes(".music-pro-playlist-tracks.is-loading .music-pro-playlist-loading-label") && v52.includes("clip-path: inset(50%)") && v52.includes("position: absolute"), "loading text should not consume extra vertical space before the skeleton list");
  assert(v52.includes(`.music-pro-playlist-tracks .music-pro-playlist-list,
.music-pro-playlist-tracks .music-pro-playlist-skeleton-list`) && v52.includes("flex: 1 1 0") && v52.includes("margin-top: 0"), "real and skeleton track lists should occupy the same slot inside the fixed card");
  assert(v52.includes(".music-pro-playlist-tracks .music-pro-playlist-skeleton-track") && v52.includes("min-height: 56px"), "skeleton rows should match hydrated track row height");
});

check("timeline and volume knobs share one centered axis", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v53");
  assert(marker > css.lastIndexOf("UI audit v52"), "slider axis pass should come after the latest Tracks frame polish");
  const v53 = css.slice(marker);
  assert(v53.includes("--music-pro-player-range-track-height: 6px") && v53.includes("--music-pro-player-range-thumb-size: 22px"), "full-player timeline and volume should share one track/thumb size pair");
  assert(v53.includes(".music-pro-now-card-option-b .music-pro-seek-slider,\n.music-pro-now-card-option-b .music-pro-volume") && v53.includes("height: var(--music-pro-player-range-hit-height) !important"), "full-player range inputs should share the same hit height");
  assert(v53.includes(".music-pro-mini-sliders .music-pro-seek-slider,\n.music-pro-mini-sliders .music-pro-volume") && v53.includes("--music-pro-player-range-thumb-size: 20px"), "compact timeline and volume should share the same compact thumb size");
  assert(v53.includes(".music-pro-now-card-option-b .music-pro-seek-slider::-webkit-slider-thumb,\n.music-pro-now-card-option-b .music-pro-volume::-webkit-slider-thumb") && v53.includes("margin-top: calc((var(--music-pro-player-range-track-height) - var(--music-pro-player-range-thumb-size)) / 2) !important"), "WebKit slider thumbs should be vertically centered on the colored rail");
  assert(v53.includes("border-radius: 50% !important") && v53.includes("aspect-ratio: 1 / 1"), "range thumbs should stay perfectly circular");
  assert(v53.includes(".music-pro-now-card-option-b .music-pro-seek-slider::-moz-range-thumb,\n.music-pro-now-card-option-b .music-pro-volume::-moz-range-thumb") && v53.includes("box-sizing: border-box !important"), "Firefox range thumbs should use the same circular box model");
});

check("compact button glyph sizing targets Obsidian svg-icon variables", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const obsidianChangelog = await readFile(new URL("../node_modules/obsidian/CHANGELOG.md", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v54");
  assert(marker > css.lastIndexOf("UI audit v53"), "Obsidian/Lucide icon sizing pass should come after slider axis polish");
  assert(obsidianChangelog.includes("setIcon") && obsidianChangelog.includes("--icon-size"), "local Obsidian package should document setIcon sizing through --icon-size");
  const v54 = css.slice(marker);
  assert(v54.includes("--music-pro-mini-secondary-icon-size: 26px") && v54.includes("--music-pro-mini-play-icon-size: 32px") && v54.includes("--music-pro-mini-volume-icon-size: 25px"), "compact icon sizes should be materially larger than the old tiny symbols");
  assert(v54.includes(".music-pro-mini-transport .music-pro-icon-button") && v54.includes("--icon-size: var(--music-pro-mini-secondary-icon-size) !important"), "secondary compact buttons should override Obsidian's --icon-size variable");
  assert(v54.includes(".music-pro-mini-transport .music-pro-mini-play") && v54.includes("--icon-size: var(--music-pro-mini-play-icon-size) !important"), "compact play button should override Obsidian's --icon-size variable");
  assert(v54.includes(".music-pro-mini-sliders .music-pro-mini-volume-icon") && v54.includes("--icon-size: var(--music-pro-mini-volume-icon-size) !important"), "compact volume symbol should override Obsidian's --icon-size variable");
  assert(v54.includes(".svg-icon") && v54.includes("width: var(--music-pro-mini-secondary-icon-size) !important") && v54.includes("height: var(--music-pro-mini-play-icon-size) !important") && v54.includes("stroke-width: 3.35px !important"), "the real .svg-icon boxes should be force-sized, not only generic svg selectors");
  assert(v54.includes("overflow: visible") && v54.includes("justify-content: center"), "oversized compact glyphs should stay centered and avoid clipping inside pill buttons");
});

check("playlist hydration scroll restore covers every jump source", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v55");
  assert(marker > css.lastIndexOf("UI audit v54"), "hydration scroll hardening should come after Obsidian/Lucide icon sizing");
  const v55 = css.slice(marker);
  assert(sidebar.includes("normalizeScrollTop") && sidebar.includes("Math.abs(value) < 1") && !sidebar.includes("normalizeHeaderScrollTop") && !sidebar.includes("value < 96 ? 0"), "real near-top scroll offsets should no longer be normalized to zero");
  assert(sidebar.includes("trackListScrollTop") && sidebar.includes("trackListScrollLeft") && sidebar.includes("getTrackListScroller") && sidebar.includes("restoreTrackListScroll"), "Tracks panel should snapshot and restore its own internal scroller");
  assert(sidebar.includes("trackListItemId: currentItemId") && sidebar.includes("snapshot.trackListItemId !== currentItemId"), "Tracks internal scroll should only be restored for the same playlist, never carried to a new playlist");
  assert(sidebar.includes("scrollInteractionVersion") && sidebar.includes('addEventListener("wheel", this.markScrollInteraction') && sidebar.includes('addEventListener("touchmove", this.markScrollInteraction') && sidebar.includes("markKeyboardScrollInteraction"), "manual scroll input should invalidate stale pending snapshots");
  assert(sidebar.includes("shouldKeepPendingScrollSnapshot") && sidebar.includes("isScrollSnapshotUsable(snapshot)") && sidebar.includes("applyIfCurrent") && sidebar.includes("snapshot.interactionVersion !== this.scrollInteractionVersion"), "rapid load-stage rerenders should reuse snapshots only until the user scrolls");
  assert(sidebar.includes('attr: { role: "button", tabindex: "0", "data-music-pro-item-id": item.id }') && sidebar.includes("renderItem(list: HTMLElement, item: CatalogItem") && sidebar.includes("renderRecentAlbumItem") && sidebar.includes("rememberPlaylistItemScrollAnchor(row, item.id)"), "catalog, recent, and personal playlist entry points should set scroll anchors before playback changes");
  assert(v55.includes("overflow-anchor: none") && v55.includes(".music-pro-view-container .view-content") && v55.includes(".music-pro-playlist-tracks .music-pro-playlist-list") && v55.includes(".music-pro-recent-list"), "native browser scroll anchoring should be disabled on reactive Music Pro surfaces so manual restore is deterministic");
});

check("Recently displays playlist membership context", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v56");
  assert(marker > css.lastIndexOf("UI audit v55"), "Recently playlist context should come after scroll anchoring hardening");
  const v56 = css.slice(marker);
  assert(sidebar.includes("renderRecentPlaylistContext(card, item, 3)") && sidebar.includes("renderRecentPlaylistContext(row, item, 2)"), "current and historical Recent rows should both render playlist context");
  assert(sidebar.includes("private getRecentPlaylistLabels") && sidebar.includes("this.plugin.getItemPersonalCategoryIds(item)") && sidebar.includes("definition.shortLabel || definition.label"), "Recent context should include personal playlists first and use compact labels when available");
  assert(sidebar.includes("categoryId === RECENT_PLAYLIST_CATEGORY_ID") && !sidebar.includes("categoryId === COMMUNITY_LISTEN_CATEGORY_ID") && sidebar.includes("normalizePlaylistText(clean)"), "Recent context should avoid noisy Recent labels and dedupe playlist names");
  assert(sidebar.includes('cls: "music-pro-recent-playlist-context"') && sidebar.includes('setIcon(lead, "list-music")') && sidebar.includes("In playlists:"), "Recent context should expose a minimal visible row with an accessible playlists label");
  assert(v56.includes(".music-pro-recent-playlist-context") && v56.includes("flex-wrap: nowrap") && v56.includes("overflow: hidden"), "Recent playlist context should stay a single minimal line");
  assert(v56.includes(".music-pro-recent-playlist-chip") && v56.includes("border-radius: 999px") && v56.includes("text-overflow: ellipsis"), "Recent playlist labels should render as subtle truncating chips");
  assert(sidebar.includes('text: `+${hiddenCount}`') && v56.includes(".music-pro-recent-playlist-chip.is-more"), "Recent context should collapse extra memberships into a +N chip");
});

check("Recently current card categories avoid clipping", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v61");
  assert(marker > css.lastIndexOf("UI audit v60"), "Recent current-card chip unclipping should come after late scroll-lock rules");
  const v61 = css.slice(marker);
  assert(sidebar.includes("renderRecentPlaylistContext(card, item, 3)") && !sidebar.includes("renderRecentPlaylistContext(body, item, 3)"), "Playing Now category chips should be a card-level grid row instead of being squeezed inside the text column");
  assert(v61.includes(".music-pro-recent-now > .music-pro-recent-playlist-context") && v61.includes("grid-column: 2 / -1") && v61.includes("flex-wrap: wrap") && v61.includes("overflow: visible"), "Playing Now category chips should span the text/action columns and wrap without clipping");
  assert(v61.includes("@container (max-width: 390px)") && v61.includes("grid-column: 1 / -1"), "very narrow Recent current cards should give category chips the full card width");
});

check("Recently keeps album artwork separate from live track artwork", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v76");
  const getRecentArtwork = main.slice(main.indexOf("getRecentArtworkUrl"), main.indexOf("async clearRecentlyPlayed"));
  const rememberRecentArtwork = main.slice(main.indexOf("private rememberRecentArtworkSnapshot"), main.indexOf("private handleExternalAudioChange"));
  const currentRecentCard = sidebar.slice(sidebar.indexOf("private renderCurrentAlbumCard"), sidebar.indexOf("private renderRecentAlbumItem"));
  assert(marker > css.lastIndexOf("UI audit v75"), "Recent album-art consistency guard should follow the playlist-selection race fix");
  assert(settings.includes("recentlyPlayedArtworkByItemId: Record<string, string>"), "settings should keep the migration-safe per-item Recent artwork cache");
  assert(main.includes("normalizeRecentArtworkByItemId") && main.includes("trimRecentArtworkSnapshots") && main.includes("rememberRecentArtworkSnapshot"), "plugin should still normalize and trim old Recent artwork cache data safely");
  assert(getRecentArtwork.includes("return item ? normalizeSoundCloudArtworkUrl(item.artworkUrl) : undefined;"), "Recent artwork should be sourced from the playlist/album catalog thumbnail only");
  assert(rememberRecentArtwork.includes("const artworkUrl = this.getRecentArtworkUrl(item) || \"\";") && !rememberRecentArtwork.includes("currentSoundArtworkUrl"), "Recent cache updates must not capture the currently playing track thumbnail");
  assert(main.includes("this.settings.recentlyPlayedArtworkByItemId = {}") && main.includes("clearRecentlyPlayed"), "Recent artwork snapshots should be cleared with Recent history");
  assert(sidebar.includes("state.currentSoundArtworkUrl}|${state.currentSoundIsPreview") || sidebar.includes("state.currentSoundArtworkUrl}|${state.currentSoundIsUnavailable"), "sidebar should rerender when SoundCloud reports artwork after the title/index are already stable");
  assert(currentRecentCard.includes("this.plugin.getRecentArtworkUrl(item)") && !currentRecentCard.includes("state.currentSoundArtworkUrl || this.plugin.getRecentArtworkUrl(item)"), "Recently current card should not swap album art for the active track image");
  assert(sidebar.includes("this.renderArtwork(art, this.plugin.getRecentArtworkUrl(item), displayTitle"), "Recently rows should render album-level thumbnails consistently");
});

check("compact icons match full-size player line style", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v57");
  assert(marker > css.lastIndexOf("UI audit v56"), "compact icon style correction should come after Recent playlist context");
  const v57 = css.slice(marker);
  assert(v57.includes("--music-pro-mini-secondary-icon-size: 17px") && v57.includes("--music-pro-mini-play-icon-size: 22px") && v57.includes("--music-pro-mini-volume-icon-size: 19px"), "compact icons should be readable but no longer oversized like the rejected screenshot");
  assert(v57.includes("--music-pro-mini-icon-stroke: 2.25px") && v57.includes("--music-pro-mini-play-icon-stroke: 2.35px"), "compact icons should use the same calm Lucide stroke family as the full-size player");
  assert(v57.includes("--icon-size: var(--music-pro-mini-secondary-icon-size) !important") && v57.includes("--icon-size: var(--music-pro-mini-play-icon-size) !important"), "Obsidian setIcon variable sizing should still be controlled after shrinking the glyph art");
  assert(v57.includes("color-mix(in srgb, var(--text-muted) 86%, var(--text-normal) 14%)"), "secondary compact icons should use the quiet full-player control color, not shouty bright glyphs");
  assert(v57.includes(".music-pro-mini-transport .music-pro-icon-button svg *") && v57.includes("stroke-width: var(--music-pro-mini-icon-stroke) !important"), "nested Lucide paths should be forced back to full-player stroke weight");
});

check("slider handles sit slightly lower on full and compact rails", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v58");
  assert(marker > css.lastIndexOf("UI audit v57"), "slider handle visual-offset pass should come after compact icon style correction");
  const v58 = css.slice(marker);
  assert(v58.includes("--music-pro-player-range-thumb-y-offset: 4px"), "slider handles should move down by a stronger 4px visual offset");
  assert(v58.includes(".music-pro-now-card-option-b .music-pro-seek-slider::-webkit-slider-thumb,\n.music-pro-now-card-option-b .music-pro-volume::-webkit-slider-thumb") && v58.includes(".music-pro-mini-sliders .music-pro-seek-slider::-webkit-slider-thumb,\n.music-pro-mini-sliders .music-pro-volume::-webkit-slider-thumb"), "both full and compact WebKit slider thumbs should receive the same offset");
  assert(v58.includes("margin-top: calc(((var(--music-pro-player-range-track-height) - var(--music-pro-player-range-thumb-size)) / 2) + var(--music-pro-player-range-thumb-y-offset)) !important"), "WebKit offset should preserve the existing track/thumb centering formula and then nudge down");
  assert(v58.includes(".music-pro-now-card-option-b .music-pro-seek-slider::-moz-range-thumb,\n.music-pro-now-card-option-b .music-pro-volume::-moz-range-thumb") && v58.includes(".music-pro-mini-sliders .music-pro-seek-slider::-moz-range-thumb,\n.music-pro-mini-sliders .music-pro-volume::-moz-range-thumb"), "Firefox slider thumbs should keep the same full/compact treatment");
  assert(v58.includes("transform: translateY(var(--music-pro-player-range-thumb-y-offset))"), "Firefox offset should use the shared y-offset variable");
});

check("ultra-small playlist rows keep actions inline", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v59");
  assert(marker > css.lastIndexOf("UI audit v58"), "ultra-small playlist row override should come after slider/thumb fixes");
  const v59 = css.slice(marker);
  assert(v59.includes("@container (max-width: 390px)") && v59.includes("grid-template-columns: 44px minmax(0, 1fr) max-content"), "narrow playlist rows should keep artwork, text, and buttons in one grid row");
  assert(v59.includes(".music-pro-library-panel .music-pro-item-actions") && v59.includes("grid-column: 3") && v59.includes("grid-row: 1"), "folder/open buttons should no longer fall to a second row at ultra-small widths");
  assert(v59.includes("@container (max-width: 330px)") && v59.includes("width: 26px"), "very tiny widths should slightly compress utility buttons instead of wrapping");
});

check("new playlist loading keeps the clicked row locked until hydration settles", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v60");
  assert(marker > css.lastIndexOf("UI audit v59"), "slow playlist-load scroll lock should come after ultra-small playlist row fixes");
  const v60 = css.slice(marker);
  assert(sidebar.includes("playlistLoadScrollLockMs = 8000") && sidebar.includes("expiresAt: anchorItemId ? Date.now() + this.playlistLoadScrollLockMs") && sidebar.includes("lockItemId: anchorItemId"), "playlist clicks should create a long-lived scroll lock for slow SoundCloud READY/getSounds/hydration stages");
  assert(sidebar.includes("isScrollSnapshotUsable") && sidebar.includes("shouldKeepPendingScrollSnapshot") && sidebar.includes("Date.now() > snapshot.expiresAt") && sidebar.includes("currentItemId === snapshot.lockItemId"), "pending snapshots should remain usable only for the clicked playlist and only until expiry");
  assert(sidebar.includes("if (!this.shouldKeepPendingScrollSnapshot(snapshot)) this.pendingScrollSnapshot = null"), "restore timeout should not clear a playlist-load lock while SoundCloud is still emitting late renders");
  assert(sidebar.includes("suppressMouseFocus") && sidebar.includes('event.pointerType === "touch"') && sidebar.includes("event.preventDefault()") && sidebar.includes(".music-pro-folder-item-drag-handle"), "mouse activation should not steal focus/scroll, while touch and drag handles remain unaffected");
  assert(sidebar.includes("markKeyboardScrollInteraction") && sidebar.includes('[role="button"]') && sidebar.includes("this.pendingScrollSnapshot = null"), "manual scrolling should still cancel locks, but keyboard activation on playlist rows should not cancel its own snapshot");
  assert(v60.includes("scroll-behavior: auto !important") && v60.includes(".music-pro-view-container *"), "Music Pro should avoid smooth-scroll animation during programmatic restoration");
});

check("compact icons use the exact full-player Lucide recipe", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v62");
  assert(marker > css.lastIndexOf("UI audit v61"), "exact compact/full icon matching should override all prior approximate compact passes");
  const v62 = css.slice(marker);
  assert(v62.includes("--music-pro-player-control-icon-size: 14px") && v62.includes("--music-pro-player-play-icon-size: 18px") && v62.includes("--music-pro-player-volume-icon-size: 16px") && v62.includes("--music-pro-player-icon-stroke: 2.25px"), "full and compact controls should share one explicit icon-size/stroke recipe");
  assert(v62.includes(`.music-pro-now-card-option-b .music-pro-control-button,
.music-pro-mini-transport .music-pro-icon-button`) && v62.includes("--icon-size: var(--music-pro-player-control-icon-size) !important"), "full-size and compact secondary buttons should use the same Obsidian --icon-size variable");
  assert(v62.includes(`.music-pro-now-card-option-b .music-pro-play-button,
.music-pro-mini-transport .music-pro-mini-play`) && v62.includes("--icon-size: var(--music-pro-player-play-icon-size) !important"), "full-size and compact play buttons should use the same Obsidian --icon-size variable");
  assert(v62.includes(".music-pro-now-card-option-b .music-pro-control-button .svg-icon") && v62.includes(".music-pro-mini-actions .music-pro-icon-button .svg-icon") && v62.includes("width: var(--music-pro-player-control-icon-size) !important"), "the rendered .svg-icon boxes should be equal for full and compact secondary controls");
  assert(v62.includes(".music-pro-now-card-option-b .music-pro-play-button .svg-icon") && v62.includes(".music-pro-mini-transport .music-pro-mini-play .svg-icon") && v62.includes("height: var(--music-pro-player-play-icon-size) !important"), "the rendered .svg-icon boxes should be equal for full and compact play controls");
  assert(v62.includes(".music-pro-now-card-option-b .music-pro-now-volume-icon .svg-icon") && v62.includes(".music-pro-mini-sliders .music-pro-mini-volume-icon .svg-icon") && v62.includes("stroke-width: var(--music-pro-player-icon-stroke) !important"), "full and compact volume glyphs should share the same size and stroke");
  assert(v62.includes(".music-pro-now-card-option-b .music-pro-control-button svg *") && v62.includes(".music-pro-mini-transport .music-pro-mini-play svg *"), "nested Lucide path strokes should be normalized in both full and compact players");
});

check("Recent category chips use an unclipped grid lane", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v63");
  assert(marker > css.lastIndexOf("UI audit v62"), "Recent category lane fix should override prior current-card-only chip fixes");
  const v63 = css.slice(marker);
  assert(sidebar.includes("renderRecentPlaylistContext(row, item, 2)") && !sidebar.includes("renderRecentPlaylistContext(body, item, 2)"), "historical Recent rows should render category chips at row level, not inside the narrow text body");
  assert(v63.includes(`.music-pro-recent-now,
.music-pro-recent-item`) && v63.includes("grid-template-rows: auto auto") && v63.includes("overflow: visible"), "Recent cards should have a second metadata row and visible overflow for chips");
  assert(v63.includes(".music-pro-recent-item > .music-pro-recent-playlist-context") && v63.includes("grid-column: 2 / -1") && v63.includes("flex-wrap: wrap") && v63.includes("row-gap: 5px"), "Recent row chips should span text/actions and wrap instead of clipping");
  assert(v63.includes("min-height: 22px") && v63.includes("padding: 2px 7px 3px") && v63.includes("line-height: 1.15") && v63.includes("box-sizing: border-box"), "Recent category chips should have enough vertical room for font rendering");
  assert(v63.includes("@container (max-width: 390px)") && v63.includes("grid-column: 1 / -1"), "narrow Recent cards should let category chips use the full row width");
});

check("settings copy is simpler and personal playlist rename auto-saves", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v64");
  assert(marker > css.lastIndexOf("UI audit v63"), "settings language cleanup should come after Recent chip grid polish");
  const v64 = css.slice(marker);
  assert(!settingsTab.includes("Use Theme Accent") && !settingsTab.includes("Use theme accent") && !settingsTab.includes("setAdaptAccentToTheme") && !settingsTab.includes("setDisabled(this.plugin.settings.adaptAccentToTheme"), "Settings should not show or depend on Use Theme Accent anymore");
  assert(main.includes("this.settings.adaptAccentToTheme = false") && main.includes("return this.settings.accentColor") && !main.includes("async setAdaptAccentToTheme"), "legacy theme accent should be forced off without keeping the old toggle method");
  assert(settingsTab.includes('setName("Auto-Hide Mini Player")') && settingsTab.includes("When compact, tuck it away until your mouse is near.") && !settingsTab.includes("Compact Mini Player"), "compact mini-player setting should clearly describe auto-hide behavior");
  assert(settingsTab.includes('"Player",') && settingsTab.includes('setName("Play On Open")') && settingsTab.includes('setName("Pause For Browser Audio")'), "playback settings should use short direct labels");
  assert(settingsTab.includes("Visible Playlists") && settingsTab.includes('setName("All Playlists")') && settingsTab.includes("Off playlists do not load, search, show, or fetch artwork") && !settingsTab.includes("Bulk Playlist Switches") && !settingsTab.includes("not indexed, searched, rendered, or queued"), "playlist performance copy should be simple and avoid technical wording");
  assert(settingsTab.includes("addAutoSavePersonalPlaylistRename") && settingsTab.includes("Type a new name. It saves automatically.") && settingsTab.includes("window.setTimeout(async () =>") && settingsTab.includes('text.inputEl.addEventListener("blur"') && !settingsTab.includes('button.setTooltip("Rename")'), "Personal playlist rename in Settings should auto-save without a save/check button");
  assert(main.includes('throw new Error("Playlist name cannot be empty.")') && main.includes('throw new Error("This playlist already exists.")') && main.includes('throw new Error("Personal playlist not found.")'), "rename/create errors should say playlist, not category");
  assert(v64.includes(".music-pro-personal-playlist-name-input") && v64.includes(".music-pro-personal-playlist-list .setting-item-control"), "auto-save rename input should keep compact Settings spacing");
});

check("special playlist rows use uniform backgrounds", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v65");
  assert(marker > css.lastIndexOf("UI audit v64"), "special playlist background normalization should come after Settings cleanup");
  const v65 = css.slice(marker);
  assert(sidebar.includes('"data-music-pro-category-id": option.value') && sidebar.includes('"data-music-pro-category-kind": isPersonal ? "personal" : "system"') && sidebar.includes('button.toggleClass("is-system", !isPersonal)'), "playlist rail rows should expose category id/kind so special rows can be audited and normalized");
  assert(settingsTab.includes('music-pro-category-toggle-row') && settingsTab.includes('categorySetting.settingEl.setAttr("data-music-pro-category-id", category.id)') && settingsTab.includes('"data-music-pro-category-kind"'), "Settings playlist toggle rows should also expose category id/kind");
  assert(v65.includes(`.music-pro-playlist-category[data-music-pro-category-id="editors-choice"],
.music-pro-playlist-category[data-music-pro-category-id="recent"]`) && v65.includes("background: var(--music-pro-playlist-category-idle-bg) !important"), "Editor’s Choice and Recent rail rows should use the same idle background as other playlists");
  assert(v65.includes('.music-pro-playlist-category[data-music-pro-category-id="editors-choice"]:hover') && v65.includes("background: var(--music-pro-playlist-category-hover-bg) !important"), "Editor’s Choice and Recent rail rows should use the same hover background as other playlists");
  assert(v65.includes('.music-pro-playlist-category[data-music-pro-category-id="editors-choice"].is-active') && v65.includes('.music-pro-playlist-category[data-music-pro-category-id="recent"].is-active') && v65.includes("background: var(--music-pro-playlist-category-active-bg) !important"), "Editor’s Choice and Recent rail rows should use the same active background as other playlists");
  assert(v65.includes(`.music-pro-category-toggle-grid > .setting-item.music-pro-category-toggle-row[data-music-pro-category-id="editors-choice"],
.music-pro-category-toggle-grid > .setting-item.music-pro-category-toggle-row[data-music-pro-category-id="recent"]`) && v65.includes("background: var(--music-pro-settings-playlist-row-bg) !important"), "Settings rows for Editor’s Choice and Recent should use the same row background as every other playlist toggle");
  assert(v65.includes(".music-pro-category-toggle-grid > .setting-item.music-pro-category-toggle-row .music-pro-toggle-button.is-active") && v65.includes("var(--music-pro-accent, var(--interactive-accent)) 18%"), "active On buttons in Settings should also share one background recipe");
});

check("missing playlist artwork uses metadata-aware generated placeholders", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const util = await readFile(new URL("../src/utils/artworkPlaceholder.ts", import.meta.url), "utf8");
  const marker = css.indexOf("playlist-specific generated placeholder artwork");
  assert(marker > css.lastIndexOf("standardized lightweight artwork for SoundCloud placeholder rows"), "metadata-aware placeholder artwork should build on the lightweight placeholder system");
  const artworkCss = css.slice(marker, css.indexOf("hold playlist-load scroll lock", marker));
  assert(util.includes("CATEGORY_ARTWORK_PROFILES") && util.includes("PERSONAL_PROFILE") && util.includes("getArtworkProfile") && util.includes("sourceFromInput"), "placeholder helper should choose artwork profiles from playlist metadata");
  assert(util.includes("resolveArtworkPalette") && util.includes("data-music-pro-art-palette") && util.includes("wider palette bank") && util.includes("% 6"), "placeholder colors should vary strongly per playlist so adjacent missing covers do not look duplicated");
  assert(util.includes("Apple Music / Spotify") || artworkCss.includes("Apple Music / Spotify"), "placeholder artwork should document the clean cover-art design reference");
  const paletteFamilyCount = (util.match(/\[\d+,\s*\d+,\s*\d+\]/g) || []).length;
  assert(paletteFamilyCount >= 24 && util.includes("ARTWORK_PLACEHOLDER_VARIANTS") && util.includes("formatHsl") && util.includes("wrapHue"), "placeholder helper should retain many deterministic color families for unknown playlists");
  for (const expected of ["ambience", "piano", "jazz-blues", "orchestra", "movies-games", "house", "acoustic", "personal"]) {
    assert(util.includes(`id: "${expected}"`), `missing metadata artwork profile: ${expected}`);
  }
  assert(sidebar.includes("placeholderSeed: string | CatalogItem") && sidebar.includes('this.renderArtwork(art, item.artworkUrl, displayTitle, "music", index < 8, item)') && sidebar.includes('this.plugin.getRecentArtworkUrl(item), displayTitle, "disc-3", true, item'), "sidebar and Recent rows should seed generated thumbnails from the playlist item, not only a generic title");
  assert(mini.includes("item || displayTitle") && mini.includes("const icon = applyArtworkPlaceholderStyle(container, seed, fallbackIcon)"), "compact mode should reuse metadata-aware placeholder artwork without layout changes");
  assert(artworkCss.includes("data-music-pro-art-profile") && artworkCss.includes("data-music-pro-art-motif") && artworkCss.includes("vinyl") && artworkCss.includes("aurora") && artworkCss.includes("grid") && artworkCss.includes("no network/generated bitmap assets"), "placeholder CSS should render category-specific motifs while staying lightweight/offline-safe");
});

check("default appearance is fixed accent-synced and adaptive theme is removed", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const settingsTab = await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v66");
  assert(marker > css.lastIndexOf("UI audit v65"), "fixed appearance mode should come after special playlist background normalization");
  const v66 = css.slice(marker);
  assert(!settings.includes("adaptiveThemeEnabled: boolean") && !settings.includes("adaptiveThemeEnabled: false"), "Adaptive To Your Theme should not be a current persisted setting anymore");
  assert(!settingsTab.includes("Adaptive To Your Theme") && !settingsTab.includes("setAdaptiveThemeEnabled") && !settingsTab.includes("adaptiveThemeEnabled"), "Settings should not expose Adaptive To Your Theme anymore");
  assert(main.includes('delete (this.settings as MusicProSettings & { adaptiveThemeEnabled?: boolean }).adaptiveThemeEnabled') && main.includes('element.addClass("music-pro-fixed-appearance")') && main.includes('element.removeClass("music-pro-adaptive-appearance")') && !main.includes("async setAdaptiveThemeEnabled"), "Music Pro should migrate old adaptive settings away and always apply fixed appearance");
  assert(v66.includes(".music-pro-sidebar.music-pro-fixed-appearance") && v66.includes("--background-primary: #111722") && v66.includes("--text-normal: #f4f7fb") && v66.includes("--music-pro-background-deep: color-mix(in srgb, var(--music-pro-background-accent) 22%, #06111f 78%)") && v66.includes("--music-pro-background-bottom"), "default fixed mode should lock the dark shell, white text, and accent-synced background tokens");
  assert(v66.includes(`background:
    radial-gradient`) && v66.includes("linear-gradient(180deg, var(--music-pro-background-deep)") && v66.includes("var(--music-pro-background-bottom) 100%"), "default sidebar background should follow the selected accent without blending into the old blue gradient");
  assert(v66.includes(".music-pro-settings.music-pro-fixed-appearance") && v66.includes("linear-gradient(180deg, color-mix(in srgb, var(--music-pro-background-deep) 42%, transparent)"), "settings background should use the same accent-synced glow in fixed mode");
  assert(v66.includes(".music-pro-sidebar.music-pro-fixed-appearance .music-pro-sidebar-header h2") && v66.includes("color: var(--text-normal) !important"), "Music Pro heading and section text should remain white in default mode");
  assert(v66.includes(".music-pro-sidebar.music-pro-fixed-appearance .music-pro-now-card") && v66.includes(".music-pro-settings.music-pro-fixed-appearance .music-pro-settings-section") && v66.includes(`background:
    linear-gradient`) && v66.includes("var(--music-pro-material) !important"), "default cards/settings surfaces should keep the same dark material background");
  assert(!v66.includes(".music-pro-sidebar.music-pro-adaptive-appearance") && !css.includes("color-scheme: normal"), "adaptive appearance CSS should be removed instead of kept as a theme-dependent mode");
});

check("major panels keep theme-independent Cupertino gutters", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v78");
  assert(marker > css.lastIndexOf("UI audit v77"), "panel gutter fix should be the latest layout override");
  const gutterCss = css.slice(marker);
  assert(gutterCss.includes("--music-pro-content-gutter: clamp(10px, 2.4cqw, 18px)"), "Music Pro should define a theme-independent content gutter");
  assert(gutterCss.includes(".music-pro-sidebar-header") && gutterCss.includes(".music-pro-now-card") && gutterCss.includes(".music-pro-playlist-tracks") && gutterCss.includes(".music-pro-library-panel"), "header, player, Tracks, and Playlists panels should share the same gutter rule");
  assert(gutterCss.includes("width: min(760px, calc(100% - (var(--music-pro-content-gutter) * 2)))") && gutterCss.includes("margin-left: auto") && gutterCss.includes("margin-right: auto"), "major panels should be centered and inset instead of relying on theme-provided view padding");
  assert(gutterCss.includes("box-sizing: border-box") && gutterCss.includes("@container (max-width: 390px)"), "panel gutters should include border-box sizing and shrink on very narrow panes");
});

check("fixed appearance buttons resist Obsidian default light button styling", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v79");
  assert(marker > css.lastIndexOf("UI audit v78"), "default-theme button override should come after gutter/layout fixes");
  const buttonCss = css.slice(marker);
  assert(buttonCss.includes("Obsidian's default theme paints native <button>") && buttonCss.includes("button.music-pro-control-button") && buttonCss.includes("button.music-pro-icon-button") && buttonCss.includes("button.music-pro-play-button"), "fixed appearance should use scoped button selectors with higher specificity than Obsidian's default button rule");
  assert(buttonCss.includes("-webkit-appearance: none !important") && buttonCss.includes("appearance: none !important"), "Music Pro buttons should reset native/default theme button appearance");
  assert(buttonCss.includes("background:") && buttonCss.includes("color-mix(in srgb, var(--background-secondary) 58%, transparent) !important") && buttonCss.includes("border-color: color-mix(in srgb, var(--background-modifier-border) 48%, transparent) !important"), "normal Music Pro icon/control buttons should keep dark material backgrounds under default themes");
  assert(buttonCss.includes("button.music-pro-loop-toggle.is-active") && buttonCss.includes("button.music-pro-random-toggle.is-active") && buttonCss.includes("var(--music-pro-accent-strong) !important"), "active random/loop controls should keep the accent background after the default button reset");
  assert(buttonCss.includes("button.music-pro-mini-play") && buttonCss.includes("color: currentColor !important") && buttonCss.includes("stroke: currentColor !important"), "compact and full controls should keep glyph colors bound to the Music Pro button color");
});

check("fixed Music Pro surfaces resist installed Obsidian theme bleed", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert(!/,\s*\{/.test(css), "CSS selector lists should not end with a trailing comma before an opening brace");
  const fixedSurfaceSelector = `.music-pro-sidebar.music-pro-fixed-appearance .music-pro-now-card,
.music-pro-sidebar.music-pro-fixed-appearance .music-pro-playlist-tracks,
.music-pro-sidebar.music-pro-fixed-appearance .music-pro-library-panel,
.music-pro-sidebar.music-pro-fixed-appearance .music-pro-playlist-category-intro,
.music-pro-settings.music-pro-fixed-appearance .music-pro-settings-section,
.music-pro-settings.music-pro-fixed-appearance .music-pro-category-toggle-settings,
.music-pro-settings.music-pro-fixed-appearance .music-pro-personal-playlist-settings,
.music-pro-mini-dock.music-pro-fixed-appearance .music-pro-mini-panel,
.music-pro-quick-picker.music-pro-fixed-appearance {`;
  assert(css.includes(fixedSurfaceSelector), "fixed material surfaces should have a valid selector list that includes the Quick Picker without a trailing comma");
  const marker = css.lastIndexOf("UI audit v81");
  assert(marker > css.lastIndexOf("UI audit v80"), "installed-theme hardening should come after compact timing overrides");
  const hardeningCss = css.slice(marker);
  assert(hardeningCss.includes("Minimal, Border, Blue Topaz, ITS, Primary, Prism, Cupertino") && hardeningCss.includes("without reintroducing adaptive theme"), "theme hardening should document the installed Obsidian themes it protects against");
  assert(hardeningCss.includes(".music-pro-view-container .view-content") && hardeningCss.includes("padding: 0 !important") && hardeningCss.includes("background: transparent !important"), "Music Pro should neutralize theme-provided view padding/background at the view-content boundary");
  assert(hardeningCss.includes("isolation: isolate") && hardeningCss.includes("font-family: var(--font-interface)") && hardeningCss.includes("text-shadow: none !important"), "fixed surfaces should isolate typography/shadow bleed from themes");
  assert(hardeningCss.includes(".music-pro-settings.music-pro-fixed-appearance .setting-item") && hardeningCss.includes(".setting-item-name") && hardeningCss.includes(".setting-item-description"), "Settings rows/names/descriptions should have scoped fixed-mode colors");
  assert(hardeningCss.includes(".music-pro-settings.music-pro-fixed-appearance .setting-item-control button:not(.music-pro-toggle-button):not(.music-pro-accent-swatch)") && hardeningCss.includes("button.music-pro-toggle-button.is-active") && hardeningCss.includes("button.music-pro-accent-swatch.is-active"), "Settings buttons, toggles, and color presets should resist broad theme button styling");
  assert(hardeningCss.includes(".music-pro-quick-picker.music-pro-fixed-appearance button.music-pro-quick-item") && hardeningCss.includes(".music-pro-quick-picker.music-pro-fixed-appearance button.music-pro-chip.is-active") && hardeningCss.includes("var(--music-pro-on-accent"), "Quick Picker rows and active chips should keep Music Pro material/accent styling");
  assert(hardeningCss.includes('.music-pro-settings.music-pro-fixed-appearance .setting-item-control input:not([type="range"]):not([type="color"])') && hardeningCss.includes('.music-pro-settings.music-pro-fixed-appearance .setting-item-control input[type="color"]') && hardeningCss.includes("accent-color: var(--music-pro-accent"), "text inputs, color inputs, and range accents should stay readable across themes");
  assert(!hardeningCss.includes("filter: none !important"), "theme hardening must not disable compact auto-hide brightness/filter animations");
});

check("sidebar fixed background survives view-content theme reset", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const hardeningMarker = css.lastIndexOf("UI audit v81");
  const restoreMarker = css.lastIndexOf("UI audit v83");
  assert(restoreMarker > hardeningMarker, "sidebar background restore should come after the v81 view-content reset");
  const hardeningCss = css.slice(hardeningMarker, restoreMarker);
  const restoreCss = css.slice(restoreMarker);
  assert(hardeningCss.includes(".music-pro-view-container .view-content:not(.music-pro-sidebar)") && hardeningCss.includes("background: transparent !important"), "view-content boundary reset must not target the sidebar contentEl itself");
  assert(restoreCss.includes("contentEl is the .view-content itself") && restoreCss.includes(".music-pro-view-container .view-content.music-pro-sidebar.music-pro-fixed-appearance"), "CSS should explicitly cover Obsidian ItemView where contentEl is also view-content");
  assert(restoreCss.includes("var(--music-pro-background-glow)") && restoreCss.includes("var(--music-pro-background-soft)") && restoreCss.includes("var(--music-pro-background-deep)") && restoreCss.includes("var(--music-pro-background-bottom) 100%) !important"), "sidebar view-content should restore the fixed dark accent-synced background after the theme reset");
  assert(restoreCss.includes("background-attachment: local") && restoreCss.includes("overflow: hidden auto") && restoreCss.includes("min-height: 100%"), "restored sidebar background should keep local scrolling and full-height coverage");
});

check("settings rows keep inner gutters under default-like themes", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v84");
  assert(marker > css.lastIndexOf("UI audit v83"), "Settings gutter fix should come after the view-content background restore");
  const settingsCss = css.slice(marker);
  assert(settingsCss.includes("Default-style Obsidian themes") && settingsCss.includes("labels and controls never touch the rounded row edge"), "Settings gutter fix should document the default-like theme issue");
  assert(settingsCss.includes(".music-pro-settings.music-pro-fixed-appearance .music-pro-settings-section > .setting-item") && settingsCss.includes(".music-pro-category-toggle-settings > .setting-item") && settingsCss.includes(".music-pro-personal-playlist-settings > .setting-item"), "Settings row gutter rule should cover main, playlist, and personal sections");
  assert(settingsCss.includes("padding: 14px 18px !important") && settingsCss.includes("border-radius: 16px !important") && settingsCss.includes("gap: 18px"), "Settings rows should have explicit comfortable inner padding, rounded corners, and label/control gap");
  assert(settingsCss.includes(".music-pro-settings.music-pro-fixed-appearance .setting-item-info") && settingsCss.includes("padding: 0 !important"), "Settings row text column should not inherit theme padding that can fight the row gutter");
  assert(settingsCss.includes(".music-pro-settings.music-pro-fixed-appearance .setting-item-control") && settingsCss.includes("padding-left: 16px !important") && settingsCss.includes("justify-content: flex-end") && settingsCss.includes("gap: 8px"), "Settings controls should stay inset from the right edge and separated from labels");
  assert(settingsCss.includes(".music-pro-settings.music-pro-fixed-appearance .music-pro-category-toggle-grid > .setting-item.music-pro-category-toggle-row") && settingsCss.includes("padding: 12px 14px !important"), "playlist visibility grid rows should also keep a smaller but explicit inner gutter");
  assert(settingsCss.includes("@container (max-width: 560px)") && settingsCss.includes("padding: 12px 14px !important") && settingsCss.includes("padding-left: 8px !important"), "Settings gutters should shrink gracefully in narrow panes");
});

check("personal playlist reorder handles drag immediately and support arrows", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v67");
  assert(marker > css.lastIndexOf("UI audit v66"), "personal playlist drag handle fix should come after fixed appearance mode");
  const v67 = css.slice(marker);
  assert(sidebar.includes('draggable: "true"') && sidebar.includes("handle.draggable = true") && sidebar.includes('handle.addEventListener("dragstart"') && sidebar.includes("text/music-pro-personal-folder-item-key"), "personal playlist row handles should be natively draggable immediately instead of waiting for hold-to-arm");
  assert(sidebar.includes('role: "button"') && sidebar.includes('tabindex: "0"') && sidebar.includes("ArrowUp") && sidebar.includes("ArrowDown") && sidebar.includes("movePersonalFolderItemWithKeyboard") && sidebar.includes("data-music-pro-folder-item-key") && sidebar.includes("candidate.focus()"), "personal playlist row handles should support keyboard Up/Down reordering and keep focus after each move");
  assert(sidebar.includes("event.dataTransfer.setDragImage(row") && sidebar.includes('effectAllowed = "move"') && sidebar.includes('handle.addEventListener("pointerdown"'), "drag feedback should start from the row and use move semantics");
  assert(sidebar.includes('direction < 0 ? "before" : "after"') && sidebar.includes("this.plugin.reorderPersonalFolderItem"), "keyboard reordering should use the same persisted personal-folder order API as drag/drop");
  assert(v67.includes("grid-template-columns: 28px 50px minmax(0, 1fr) auto") && v67.includes("touch-action: none") && v67.includes("cursor: grab !important"), "personal playlist handles should have a larger reliable grab target");
  assert(v67.includes(".music-pro-item.is-folder-drop-before") && v67.includes("outline: 1.5px solid") && v67.includes("inset 0 4px 0") && v67.includes("inset 0 -4px 0"), "drop targets should show clearer before/after indicators");
});

check("playlist Tracks reorder uses immediate handles and before/after drop indicators", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v69");
  assert(marker > css.lastIndexOf("UI audit v68"), "Tracks reorder polish should come after the inline folder picker cleanup");
  const v69 = css.slice(marker);
  assert(sidebar.includes("renderPlaylistTrackDragHandle") && sidebar.includes('draggable: "true"') && sidebar.includes("handle.draggable = true") && sidebar.includes('handle.addEventListener("dragstart"') && sidebar.includes("text/music-pro-sound-id"), "track handles should be natively draggable immediately");
  assert(sidebar.includes('role: "button"') && sidebar.includes('tabindex: "0"') && sidebar.includes("movePlaylistTrackWithKeyboard") && sidebar.includes("data-music-pro-sound-id") && sidebar.includes("candidate.focus()"), "track handles should support keyboard Up/Down reordering and keep focus");
  assert(sidebar.includes("getPlaylistTrackDropPlacement") && sidebar.includes("is-track-drop-before") && sidebar.includes("is-track-drop-after") && sidebar.includes("event.dataTransfer.setDragImage(row"), "track drag/drop should use row drag imagery plus before/after target classes");
  assert(main.includes('reorderCurrentPlaylistTrack(sourceSoundId: string, targetSoundId: string, placement: "before" | "after" = "before")') && main.includes('ordered.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, moved)'), "track order persistence should honor before/after placement instead of only target index");
  assert(v69.includes(".music-pro-playlist-track.is-track-reorderable") && v69.includes("grid-template-columns: 28px minmax(0, 1fr) auto") && v69.includes("touch-action: none") && v69.includes("cursor: grab !important"), "track rows should get the same larger reliable grab target as personal playlist rows");
  assert(v69.includes(".music-pro-playlist-track.is-track-drop-before") && v69.includes("outline: 1.5px solid") && v69.includes("inset 0 4px 0") && v69.includes("inset 0 -4px 0"), "track drop targets should show the same clear bright insertion affordance");
});


check("compact Quick Pick tracks are frameless and text centered", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v70");
  assert(marker > css.lastIndexOf("UI audit v69"), "compact Quick Pick visual cleanup should come after Tracks reorder handle rules");
  const v70 = css.slice(marker);
  assert(v70.includes(".music-pro-mini-dock .music-pro-mini-track-picker") && v70.includes("background: transparent !important") && v70.includes("box-shadow: none !important") && v70.includes("border-width: 0 !important"), "compact Quick Pick should lose only its heavy inner picker frame");
  assert(!v70.includes(".music-pro-sidebar .music-pro-playlist-tracks") && !v70.includes(".music-pro-sidebar.music-pro-fixed-appearance .music-pro-playlist-tracks"), "full-size sidebar Tracks panel should keep the old framed card styling");
  assert(v70.includes(".music-pro-mini-dock .music-pro-mini-track-row") && v70.includes("min-height: 42px") && v70.includes("padding: 6px 9px 7px"), "compact Quick Pick rows should keep pill boxes with more breathing room");
  assert(v70.includes(".music-pro-mini-dock .music-pro-mini-track-body") && v70.includes("transform: translateY(-1px)") && v70.includes("line-height: 1.14"), "compact Quick Pick track metadata should be optically centered inside each row");
});

check("Editor's Choice is manual-only and never auto-filled", async () => {
  const index = await readFile(new URL("../src/catalog/PlaylistIndex.ts", import.meta.url), "utf8");
  const taxonomy = await readFile(new URL("../src/catalog/playlistCategories.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const skill = await readFile(new URL("../catalog/PLAYLIST_CLASSIFICATION_SKILL.md", import.meta.url), "utf8");
  const seed = await readFile(new URL("./seed-catalog-from-search.mjs", import.meta.url), "utf8");
  const rebalance = await readFile(new URL("./rebalance-fresh-catalog.mjs", import.meta.url), "utf8");
  const catalogUtils = await readFile(new URL("./catalog-utils.mjs", import.meta.url), "utf8");
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert(index.includes("? items.filter((item) => isEditorsChoice(item))\n    : []") && !index.includes("explicitEditorsChoice"), "Editor's Choice should only contain explicitly tagged/manual items");
  assert(!index.includes('item.status === "active" && item.source === "curated"') && !index.includes(".slice(0, 8)"), "Editor's Choice should not auto-fill from active/curated category items");
  assert(taxonomy.includes('description: "Curated playlists selected by the editors."') && !taxonomy.includes("Manual Picks Only") && !taxonomy.includes("If Empty, Music Pro Suggests Music"), "Editor's Choice description should be user-facing while preserving manual behavior elsewhere");
  assert(sidebar.includes("No editor picks yet. Add links manually when you want them here."), "empty Editor's Choice UI should explain that links are manual");
  assert(skill.includes("Editor's Choice` is manual-only") && skill.includes("new catalog rebuild") && skill.includes("Do not add `Editor's Choice` automatically"), "catalog classification skill should preserve manual-only Editor's Choice rules");
  assert(seed.includes("freshCatalog") && seed.includes("Editor's Choice remains empty") && packageJson.includes("catalog:seed:fresh"), "fresh catalog seeding should start without Editor's Choice picks");
  assert(catalogUtils.includes("screenSoundCloudPlaylistAvailability") && catalogUtils.includes('policy === "SNIP"') && catalogUtils.includes('policy === "BLOCK"'), "catalog tooling should screen preview/restricted SoundCloud playlist candidates before release");
  assert(seed.includes("applyAvailabilityScreen") && seed.includes("maxPreviewTracks: 0") && rebalance.includes("applyAvailabilityScreen"), "fresh seed/rebalance flows should reject preview/restricted candidates by default");
  assert(skill.includes("anonymous/free SoundCloud embeds") && skill.includes("`SNIP`, `BLOCK`"), "classification skill should document global public-embed availability filtering");
  assert(seed.includes("fetchApiSearchLinks") && seed.includes("api-v2.soundcloud.com/search/playlists") && seed.includes("fetchMobileSearchLinks"), "catalog seeding should combine SoundCloud API and mobile playlist search for stronger candidate discovery");
  assert(seed.includes("HOUSE_PLAYLIST_MIN_TRACK_COUNT") && skill.includes("Flavour Trip-style warm house/groove sets") && skill.includes("Prefer 4+ track public playlists/sets"), "House mining should target Flavour Trip-style public multi-track playlists instead of weak placeholders");
});

check("manual Editor's Choice picks are present and show category context", async () => {
  const catalog = await readCatalog();
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v77");
  const v77 = css.slice(marker);
  const required = new Map([
    ["https://soundcloud.com/lazyviolinist/sets/studio-ghibli-complete", ["Movies/Games", "Asia"]],
    ["https://soundcloud.com/hivanmanh/giao-huong-beo-dat-may-troi", ["Orchestra", "Asia"]],
    ["https://soundcloud.com/user-572746326/sets/malte-marten", ["Handpan & Kalimba"]],
    ["https://soundcloud.com/ewout-hop/sets/flavour-trip", ["House"]]
  ]);
  const removedAsato = catalog.items.find((candidate) => normalizeSoundCloudUrl(candidate.url).toLowerCase() === "https://soundcloud.com/mateusasato-sc/sets/asato-4");
  assert(!removedAsato, "ASATO should stay removed after runtime skip telemetry showed repeated zero-listen skips");

  for (const [url, categories] of required) {
    const item = catalog.items.find((candidate) => normalizeSoundCloudUrl(candidate.url).toLowerCase() === normalizeSoundCloudUrl(url).toLowerCase());
    assert(item, `manual Editor's Choice URL missing: ${url}`);
    assert(item.categories.includes("Editor's Choice"), `${url} should be tagged as Editor's Choice`);
    for (const category of categories) assert(item.categories.includes(category), `${url} should keep real category ${category}`);
  }

  const singleTrack = catalog.items.find((item) => normalizeSoundCloudUrl(item.url).toLowerCase() === "https://soundcloud.com/hivanmanh/giao-huong-beo-dat-may-troi");
  assert(singleTrack?.type === "track", "the Vietnamese orchestral pick should remain a single-track Editor's Choice item");
  assert(sidebar.includes("is-editor-choice") && sidebar.includes("this.renderRecentPlaylistContext(row, item, 2)") && sidebar.includes("categoryId !== DEFAULT_PLAYLIST_CATEGORY_ID"), "Editor's Choice rows should reuse Recent category chips while hiding the Editor's Choice self-label");
  assert(marker > css.lastIndexOf("UI audit v76") && v77.includes(".music-pro-item.is-editor-choice > .music-pro-recent-playlist-context") && v77.includes("grid-row: 2") && v77.includes("max-width: min(150px, 46%)"), "Editor's Choice category chips should have their own grid lane like Recent");
});

check("non-playlist SoundCloud links show a single-track notice when added", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const addUserBody = main.slice(main.indexOf("async addUserSoundCloudUrl"), main.indexOf("async moveUserItem"));
  assert(addUserBody.includes('if (result.item.type !== "playlist") new Notice("Music Pro: this is a single track.");'), "adding any non-playlist SoundCloud link should notify that it behaves as a single track");
  assert(sidebar.includes(': "Track"'), "add preview should still detect track links before submission");
  assert(sidebar.includes("if (!isPlaylist)") && sidebar.includes("this.renderSingleTrackCallout(section)") && sidebar.includes("This is a single track"), "Tracks panel should render a persistent single-track explanation after playback");
});

check("single-track Tracks panel notice is centered and hierarchical", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v71");
  assert(marker > css.lastIndexOf("UI audit v70"), "single-track Tracks-panel notice should come after compact Quick Pick cleanup");
  const v71 = css.slice(marker);
  assert(sidebar.includes("music-pro-single-track-callout") && sidebar.includes("music-pro-single-track-title") && sidebar.includes("music-pro-single-track-desc"), "single-track panel should use title/body hierarchy instead of one small line");
  assert(v71.includes(".music-pro-playlist-tracks .music-pro-single-track-callout") && v71.includes("flex: 1 1 auto !important") && v71.includes("align-items: center") && v71.includes("justify-content: center") && v71.includes("text-align: center"), "single-track callout should be centered within the Tracks panel");
  assert(v71.includes(".music-pro-single-track-title") && v71.includes("font-size: clamp(22px, 3.2vw, 30px)") && v71.includes("font-weight: 880"), "single-track title should be large and clear");
  assert(v71.includes(".music-pro-single-track-desc") && v71.includes("max-width: 380px") && v71.includes("line-height: 1.45"), "single-track supporting copy should be readable and constrained");
});


check("single-track empty-state stack is centered as a whole", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v72");
  assert(marker > css.lastIndexOf("UI audit v71"), "single-track stack centering should override the original single-track notice rules");
  const v72 = css.slice(marker);
  assert(v72.includes("center the whole single-track message group, not just the icon"), "single-track centering should document the icon-vs-stack issue");
  assert(v72.includes("padding: 0 22px clamp(38px, 6vh, 58px) !important") && v72.includes("justify-content: center") && v72.includes("gap: 14px"), "single-track callout should bias the centered stack upward so icon, title, and body center together");
  assert(v72.includes("@container (max-width: 390px)") && v72.includes("padding: 0 16px 36px !important"), "small panels should keep the whole single-track stack centered without crowding");
});


check("full-size play button icon color is stable on click", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v73");
  assert(marker > css.lastIndexOf("UI audit v72"), "full-size play-button flicker fix should override earlier empty-state rules");
  const v73 = css.slice(marker);
  assert(v73.includes("compact-mode white") && v73.includes(".music-pro-now-card-option-b .music-pro-play-button:active") && v73.includes(".music-pro-now-card-option-b .music-pro-play-button:focus-visible"), "full-size play button should pin compact-style white across active/focus states");
  assert(v73.includes("color: #ffffff !important") && v73.includes("transition: transform 140ms ease, background 140ms ease, box-shadow 140ms ease !important") && !v73.includes("color: var(--music-pro-on-accent) !important"), "play button should stay white and should not animate icon color during play/pause rerenders");
  assert(v73.includes("stroke: currentColor !important") && v73.includes("transition: none !important") && v73.includes('svg [fill]:not([fill="none"])'), "play/pause SVG descendants should inherit the pinned white color without Obsidian active-state recoloring");
});

check("Obsidian command palette stays minimal and user-facing", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const commandMatches = [...main.matchAll(/this\.addCommand\(\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g)];
  const commands = commandMatches.map((match) => ({ id: match[1], name: match[2] }));
  const expected = [
    ["open", "Open"],
    ["shutdown", "Shutdown"],
    ["play-pause", "Play/Pause"],
    ["next-track", "Next Track"],
    ["previous-track", "Previous Track"],
    ["compact-fullsize", "Compact/Fullsize"],
    ["volume-0", "Volume 0%"],
    ["volume-30", "Volume 30%"],
    ["volume-60", "Volume 60%"],
    ["volume-90", "Volume 90%"]
  ];

  assert(JSON.stringify(commands) === JSON.stringify(expected.map(([id, name]) => ({ id, name }))), `unexpected command palette entries: ${commands.map((command) => `${command.id}:${command.name}`).join(", ")}`);
  for (const volume of [0, 30, 60, 90]) {
    assert(main.includes(`id: "volume-${volume}"`) && main.includes(`this.setUserVolume(${volume}, true)`), `Volume ${volume}% command should immediately set and persist the volume`);
  }
  assert(main.includes("async shutdown()") && main.includes("this.player.pause()") && main.includes('mode: "sidebar"') && main.includes("await this.closeSidebar()"), "Shutdown command should pause playback and hide both mini/full-size UI without changing the saved default mode");
  for (const removed of ["Open mini dock", "Add SoundCloud link", "Quick pick music or playlist", "Refresh remote catalog", "Check broken SoundCloud links", "Toggle random playlist mode", "Toggle current track loop"]) {
    assert(!readme.includes(removed), `README command list should not expose removed command: ${removed}`);
  }
  assert(readme.includes("search for **Music Pro**") && readme.includes("Music Pro: Open"), "README should explain that command-palette entries are found under Music Pro");
  for (const [, name] of expected) {
    assert(readme.includes(`- Music Pro: ${name}`), `README should document command with plugin context: Music Pro: ${name}`);
  }
});

check("short description is consistent across release-facing sources", async () => {
  const expected = "A plug-and-play music app for deep work.";
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert(manifest.description === expected, "manifest.description should use the approved short description");
  assert(packageJson.description === expected, "package.json description should use the approved short description");
  assert(readme.includes(`\n${expected}\n`), "README intro should use the approved short description");
  assert((await readFile(new URL("../src/ui/SettingsTab.ts", import.meta.url), "utf8")).includes(expected), "Settings hero should use the approved short description");
});

check("four-phase SoundCloud mining hardening is wired", async () => {
  const catalog = await readCatalog();
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const catalogService = await readFile(new URL("../src/catalog/CatalogService.ts", import.meta.url), "utf8");
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("../src/catalog/PlaylistIndex.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const util = await readFile(new URL("../src/utils/normalize.ts", import.meta.url), "utf8");
  const catalogUtils = await readFile(new URL("./catalog-utils.mjs", import.meta.url), "utf8");
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const activeDuplicates = findDuplicatePlaylistGroups(catalog.items.filter((item) => item.status === "active"));
  const hiddenDuplicates = catalog.items.filter((item) => item.status === "hidden" && item.tags?.includes("duplicate-hidden"));
  const editorsChoice = catalog.items.filter((item) => item.categories.includes("Editor's Choice"));
  assert(activeDuplicates.length === 0, `active duplicate playlist groups should be hidden, found ${activeDuplicates.length}`);
  assert(hiddenDuplicates.every((item) => item.status === "hidden"), "duplicate-hidden items should never remain active");
  assert(editorsChoice.every((item) => item.categories.includes("Editor's Choice")), "Editor's Choice should only contain explicitly/manual tagged picks");
  assert(main.includes("normalizeUserItems") && main.includes("assertEmbeddableSoundCloudUrl(url)") && main.includes('status: "broken"') && main.includes('"unembeddable"'), "settings migration should mark stale personalized Discover/user links broken");
  assert(main.includes("async checkBrokenSoundCloudLinks") && main.includes("fetchOEmbed(item.url)") && main.includes('"broken-link"'), "plugin should keep broken-link checking logic available internally and mark matching user links broken");
  assert(main.includes("refreshBehaviorRankingIfStale(true)") && main.includes("unavailableCount"), "unavailable playback should persist and immediately lower future ranking snapshots");
  assert(catalogService.includes("validateRemoteCatalogUrl") && catalogService.includes("Remote catalog URL must use HTTPS") && catalogService.includes("bundled fallback < remote catalog < local user links"), "remote catalog fetch should be URL-hardened and remote/user entries should override bundled duplicates");
  assert(catalogService.includes("removeDuplicatePlaylistItems") && catalogService.includes("getPlaylistDuplicateKey") && catalogService.includes("DUPLICATE_TITLE_STOP_WORDS"), "runtime catalog merge should drop over-duplicated playlists before indexing");
  assert(catalogUtils.includes("hasStrongTitleTrackDuplicateSignal") && catalogUtils.includes("title:${titleKey}::tracks"), "catalog duplicate logic should also catch same-title/same-track-count playlist clones across different users");
  assert(catalogService.includes("VALID_CATEGORY_LABEL_KEYS") && catalogService.includes("REMOVED_CATEGORY_KEYS") && catalogService.includes("displayTitle should be 4 words or fewer"), "runtime remote validation should be close to script validation");
  assert(player.includes("PLAYLIST_METADATA_CACHE_MS") && player.includes("PLAYLIST_METADATA_FAILURE_BACKOFF_MS") && player.includes("playlistTrackMetadataCache") && player.includes("playlistTrackMetadataFailureAt"), "SoundCloud playlist hydration should cache metadata and back off after failures");
  assert(index.includes("normalizePlaylistText([") && sidebar.includes("const q = normalizePlaylistText(this.query)") && quickPicker.includes("const q = normalizePlaylistText(this.query)"), "search should normalize accents/diacritics across sidebar and quick picker");
  assert(util.includes("assertEmbeddableSoundCloudUrl") && catalogUtils.includes("assertEmbeddableSoundCloudUrl") && catalogUtils.includes("findDuplicatePlaylistGroups") && catalogUtils.includes("hideDuplicatePlaylists"), "shared URL and duplicate tooling should exist for scripts/tests");
  assert(packageJson.includes("catalog:dedupe") && packageJson.includes("catalog:curate-editors-choice") && packageJson.includes("catalog:enrich-popularity") && packageJson.includes("catalog:seed:fresh"), "package scripts should expose dedupe, curation, popularity, and fresh seed workflows");
});


check("mode switching and hot UI paths avoid blocking on settings writes", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/player/PlayerStore.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v73");
  assert(marker > css.lastIndexOf("UI audit v72"), "runtime responsiveness guard should come after the latest visual audit");
  const setModeStart = main.indexOf("async setMode");
  const playItemStart = main.indexOf("async playItem");
  const reorderTrackStart = main.indexOf("async reorderCurrentPlaylistTrack");
  const setMode = main.slice(setModeStart, main.indexOf("async openSidebar", setModeStart));
  const playItem = main.slice(playItemStart, main.indexOf("getRecentlyPlayedItems", playItemStart));
  const reorderTrack = main.slice(reorderTrackStart, main.indexOf("private async handleTrackFinish", reorderTrackStart));
  assert(main.includes("private settingsSaveTimer") && main.includes("saveSettingsSoon(delay = 220)") && main.includes("flushScheduledSettingsSave()"), "non-critical persistence should be debounced and flushed on unload");
  assert(setMode.includes("this.saveSettingsSoon()") && !setMode.includes("await this.saveSettings()") && setMode.indexOf("this.saveSettingsSoon()") < setMode.indexOf('if (mode === "sidebar")'), "full/compact mode switching should update UI before writing settings to disk");
  assert(playItem.includes("this.saveSettingsSoon()") && !playItem.includes("await this.saveSettings()") && playItem.indexOf("this.saveSettingsSoon()") < playItem.indexOf("await this.player.load"), "playlist selection should start player loading without waiting for saveData");
  assert(!main.includes("lastStatusBarKey") && !main.includes("statusKey") && !main.includes("renderStatusBar") && main.includes("this.miniDock?.refresh()"), "removed status-bar controls should not add any store-update render work");
  assert(store.includes("hasChangedValue") && store.includes("if (!hasChangedValue) return") && store.includes('hasOwnProperty.call(update, "soundList")'), "PlayerStore should not emit when state values did not change");
  assert(mini.includes("private seekInput") && mini.includes("private volumeInput") && !mini.includes('this.root.querySelector<HTMLInputElement>(".music-pro-mini-seek-slider")'), "MiniDock progress updates should use cached control references instead of querying DOM every tick");
  assert(mini.includes("lastRenderedVolume") && mini.includes("volumeChanged") && mini.includes("if (volumeChanged && this.volumeIconEl)"), "MiniDock should avoid rerendering the volume icon on unrelated progress updates");
  assert(reorderTrack.includes("this.renderAll()") && reorderTrack.includes("this.saveSettingsSoon()") && reorderTrack.indexOf("this.renderAll()") < reorderTrack.indexOf("this.saveSettingsSoon()"), "track reorders should render immediately and persist asynchronously");
});


check("real-world runtime hot paths are cached and throttled", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const mini = await readFile(new URL("../src/ui/MiniDock.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const monitor = await readFile(new URL("../src/integrations/ExternalAudioMonitor.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v74");
  assert(marker > css.lastIndexOf("UI audit v73"), "end-to-end performance guard should come after the previous runtime responsiveness pass");
  const setModeStart = main.indexOf("async setMode");
  const setMode = main.slice(setModeStart, main.indexOf("async openSidebar", setModeStart));
  const sidebarUpdateVolume = sidebar.slice(sidebar.indexOf("private updateVolumeControls"), sidebar.indexOf("private renderVolumeIcon"));
  const monitorRecompute = monitor.slice(monitor.indexOf("private recompute"), monitor.indexOf("private isWebviewAudible"));
  assert(main.includes("catalogItemsByIdCache") && main.includes("getCatalogItemsById()") && main.includes("getCatalogItemById(this.settings.currentItemId)"), "saved/recent lookup should use a cached catalog id map instead of scanning the catalog repeatedly");
  assert(main.includes("personalAssignmentFingerprintCache") && main.includes("getPersonalCategoryIdSet()") && main.includes("categoryIdByLabelKey"), "personal assignment/index building should reuse category fingerprints and id sets");
  assert(main.includes("rankedItemsCache") && main.includes("communityItemsCache") && main.includes("behaviorUpdatedAt") && main.includes("this.rankedItemsCache.clear()"), "ranked category/community lists should be cached and invalidated by behavior-ranking changes");
  assert(main.includes("orderedSoundsCache") && main.includes("orderSignature") && main.includes("const orderedIds = new Set(order)"), "playlist track ordering should be cached and avoid repeated O(n²) order.includes checks");
  assert(main.includes('data-music-pro-accent-cache') && main.includes("onAccentColorCache") && main.includes("if (cached) return cached"), "accent application should skip repeated style writes and cache contrast decisions");
  assert(setMode.indexOf("await this.openSidebar()") < setMode.indexOf("this.store.setMode(mode)") && setMode.indexOf("this.store.setMode(mode)", setMode.indexOf('} else {')) < setMode.indexOf("await this.closeSidebar()"), "compact→full should keep compact visible until full view is ready, while full→compact should show compact before detaching sidebar");
  assert(main.includes("this.miniDock?.refresh()") && mini.includes("refresh(): void") && mini.includes("getRenderKey") && mini.includes("this.unsubscribe = plugin.store.subscribe(() => this.refresh())"), "MiniDock should refresh by render key instead of rebuilding on every chrome call");
  assert(sidebar.includes("private volumeInput") && sidebar.includes("private volumeIconEl") && sidebar.includes("lastRenderedVolume") && !sidebarUpdateVolume.includes("querySelectorAll"), "full-size player progress ticks should update cached volume refs instead of querying DOM repeatedly");
  assert(player.includes("POSITION_EMIT_MIN_INTERVAL_MS") && player.includes("private emitPosition") && player.includes("this.emitPosition(event.currentPosition)") && player.includes("this.emitPosition(positionMs || 0, true)"), "SoundCloud PLAY_PROGRESS should be throttled while explicit seeks/polls still flush position");
  assert(monitor.includes("scheduleScan()") && monitor.includes("scanTimer") && monitor.includes("new MutationObserver(() => this.scheduleScan())") && !monitorRecompute.includes("querySelectorAll"), "external-audio monitoring should debounce DOM scans and recompute from watched elements instead of polling the whole DOM");
});


check("selected playlist cannot be replaced by stale SoundCloud callbacks", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/ui/SidebarView.ts", import.meta.url), "utf8");
  const quickPicker = await readFile(new URL("../src/ui/QuickPickerModal.ts", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v75");
  assert(marker > css.lastIndexOf("UI audit v74"), "playlist selection race guard should follow the end-to-end performance audit");
  assert(player.includes("private loadToken") && player.includes("private pendingWidgetLoadToken") && player.includes("const loadToken = ++this.loadToken"), "each SoundCloud load should receive a monotonic token");
  assert(player.includes("if (!this.isCurrentLoad(loadToken, item)) return;") && player.includes("current?.id === item.id && current.url === item.url"), "async load continuation should confirm the selected catalog item still matches");
  assert(player.includes("callback: () => {") && player.includes("this.currentUrl !== item.url") && player.includes("this.pendingWidgetLoadToken = 0"), "widget load callbacks should ignore stale playlist callbacks before setting ready/play state");
  assert(player.includes("this.updateDuration(loadToken)") && player.includes("this.updatePlaylistState(loadToken)") && player.includes("this.updateCurrentSound(loadToken)"), "duration/playlist/current-sound async callbacks should inherit the active load token");
  assert(player.includes("hasPendingWidgetLoad()") && player.includes("this.widget.bind(events.PLAY") && player.includes("if (this.hasPendingWidgetLoad()) return;"), "untokened SoundCloud widget events should be ignored while a newer playlist load is pending");
  assert(sidebar.includes('"data-music-pro-item-id": item.id') && sidebar.includes("this.plugin.playItem(item)") && quickPicker.includes("this.plugin.playItem(item)"), "sidebar and Quick Pick row clicks should pass the exact row item into playItem");
});

check("House catalog artwork is preserved from SoundCloud pages", async () => {
  const catalog = await readCatalog();
  const catalogUtils = await readFile(new URL("./catalog-utils.mjs", import.meta.url), "utf8");
  const refreshArtwork = await readFile(new URL("./refresh-artwork.mjs", import.meta.url), "utf8");
  const seedSearch = await readFile(new URL("./seed-catalog-from-search.mjs", import.meta.url), "utf8");
  const houseItems = catalog.items.filter((item) => (item.categories || []).includes("House"));
  assert(houseItems.length >= 40, `expected a meaningful House catalog, got ${houseItems.length}`);
  const missing = houseItems.filter((item) => !item.artworkUrl || /fb_placeholder/i.test(item.artworkUrl));
  assert(missing.length === 0, `House catalog should preserve original SoundCloud artwork; missing ${missing.length}: ${missing[0]?.id || ""}`);
  assert(catalogUtils.includes("extractPageArtworkUrl") && catalogUtils.includes('extractMetaContent(html, "og:image")') && catalogUtils.includes("artworkUrl: pageArtworkUrl || firstTrackArtworkUrl"), "availability screening should prefer page-level og:image artwork, then first usable track artwork");
  assert(seedSearch.includes("screen.artworkUrl") && seedSearch.includes("candidate.item.artworkUrl = screen.artworkUrl"), "new catalog seeding should preserve original page artwork when oEmbed omits it");
  assert(refreshArtwork.includes("--category=") && refreshArtwork.includes("categoryFilter") && refreshArtwork.includes("fetchFirstTrackArtworkUrlFromHtml(html)"), "artwork refresh tool should support targeted category repair from SoundCloud page metadata and track-art fallbacks");
});

check("SoundCloud album thumbnails prefer current page artwork", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const util = await readFile(new URL("../src/utils/normalize.ts", import.meta.url), "utf8");
  const catalogService = await readFile(new URL("../src/catalog/CatalogService.ts", import.meta.url), "utf8");
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const catalogUtils = await readFile(new URL("./catalog-utils.mjs", import.meta.url), "utf8");
  const refreshArtwork = await readFile(new URL("./refresh-artwork.mjs", import.meta.url), "utf8");
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const marker = css.lastIndexOf("UI audit v76");
  assert(marker > css.lastIndexOf("UI audit v75"), "album-thumbnail audit guard should be tagged as the newest visual-no-op change");
  assert(util.includes("normalizeSoundCloudArtworkUrl") && util.includes("fb_placeholder") && util.includes("-t500x500.$1$2"), "runtime artwork URLs should drop SoundCloud placeholders and normalize CDN image sizes");
  assert(catalogService.includes("enrichItemArtworkFromPage") && catalogService.includes("this.fetchPageMetadata(item.url)") && catalogService.includes('extractMetaContent(html, "og:image")'), "user-added playlists should refresh album artwork from the live SoundCloud page, not oEmbed placeholders");
  assert(catalogService.includes("fetchFirstTrackArtworkUrlFromHtml") && catalogService.includes("extractFirstUsableTrackArtworkUrl") && catalogService.includes("const artworkUrl = pageArtworkUrl || firstTrackArtworkUrl"), "user-added playlists should fall back to the first usable track artwork before Music Pro generated placeholders");
  assert(catalogService.includes("const artworkUrl = normalizeSoundCloudArtworkUrl(data.thumbnail_url)") && catalogService.includes("const artworkUrl = normalizeSoundCloudArtworkUrl(item.artworkUrl)"), "oEmbed, remote, and bundled catalog artwork should be normalized before display");
  assert(player.includes("normalizeSoundCloudArtworkUrl(raw?.artwork_url)") && !player.includes('replace("large.jpg", "t500x500.jpg")'), "player track thumbnails should use the same artwork normalization helper");
  assert(catalogUtils.includes("normalizeSoundCloudArtworkUrl") && catalogUtils.includes("extractFirstUsableTrackArtworkUrl") && catalogUtils.includes("extractBestSoundCloudArtworkUrl") && refreshArtwork.includes("fetchPageArtworkUrl") && refreshArtwork.includes("extractPageArtworkUrl(html) || await fetchFirstTrackArtworkUrlFromHtml(html)"), "catalog tooling should refresh stale/placeholder thumbnails using page artwork first, then track artwork");
  assert(packageJson.includes("catalog:refresh-artwork"), "package scripts should expose the album-thumbnail refresh audit tool");
});

check("production data persistence and privacy disclosure are sound", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const player = await readFile(new URL("../src/player/SoundCloudPlayer.ts", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert(main.includes("normalizeRecentItemIds") && main.includes("if (ids.length >= 30) break"), "Recent history should stay capped before it is persisted");
  assert(main.includes("normalizeBehaviorStats") && main.includes(".slice(0, 300)") && main.includes("normalizeBehaviorRankingScores") && main.includes(".slice(0, 300)"), "local behavior stats and ranking snapshots should be capped before persistence");
  assert(main.includes("flushUserVolumeSaveTimer()") && main.includes("private flushUserVolumeSaveTimer") && main.includes("this.saveSettings().catch(() => undefined);"), "pending volume changes should flush on unload instead of being silently dropped");
  assert(main.includes("rememberPlaybackSession(this.store.getState(), true)") && main.includes("finalizeBehaviorSession(\"unload\")") && main.includes("clearBehaviorSaveTimer()") && main.includes("flushScheduledSettingsSave()"), "unload should flush playback session, behavior session, and debounced settings writes");
  assert(player.includes("PLAYLIST_METADATA_CACHE_MS") && player.includes("PLAYLIST_METADATA_FAILURE_BACKOFF_MS") && player.includes("playlistTrackMetadataCache") && !settings.includes("playlistTrackMetadataCache"), "SoundCloud playlist hydration metadata should be cached in memory with backoff, not stored in plugin data");
  assert(settings.includes("behaviorStats") && settings.includes("recentlyPlayedItemIds") && settings.includes("currentPositionMs"), "settings schema should explicitly own local listening/history/resume fields");
  assert(!main.includes("localStorage") && !main.includes("indexedDB") && !player.includes("localStorage") && !player.includes("indexedDB"), "Music Pro should store production data through Obsidian plugin data, not browser storage");
  assert(readme.includes("Music Pro has no telemetry, analytics, ads, or account requirement") && readme.includes("SoundCloud, to play music and load public playlist info") && readme.includes("Saved locally in Obsidian") && readme.includes("ranking, and UI preferences") && readme.includes("Cached catalog data"), "README should disclose privacy/network use in concise user-facing language");
});

check("release metadata uses GPL-3.0-only licensing", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
  const notice = await readFile(new URL("../NOTICE.md", import.meta.url), "utf8");
  const prepareRelease = await readFile(new URL("./prepare-release.mjs", import.meta.url), "utf8");
  assert(packageJson.license === "GPL-3.0-only", "package.json should use SPDX GPL-3.0-only");
  assert(packageLock.packages?.[""]?.license === "GPL-3.0-only", "package-lock root package should use SPDX GPL-3.0-only");
  assert(license.includes("GNU GENERAL PUBLIC LICENSE") && license.includes("Version 3, 29 June 2007"), "LICENSE should contain the GPL-3.0 text");
  assert(readme.includes("GNU General Public License v3.0 only") && readme.includes("GPL-3.0-only"), "README should disclose the GPL-3.0-only license");
  assert(packageJson.author === "Minh Hoang" && manifest.author === "Minh Hoang", "release-facing author metadata should name Minh Hoang");
  assert(readme.includes("Copyright © 2026 Minh Hoang") && notice.includes("Copyright (C) 2026 Minh Hoang"), "copyright notices should name Minh Hoang");
  assert(notice.includes("GNU General Public License version 3 only") && notice.includes("WITHOUT ANY WARRANTY"), "NOTICE should include the concise GPL application notice and warranty disclaimer");
  assert(prepareRelease.includes('packageJson.license === "GPL-3.0-only"') && prepareRelease.includes("LICENSE should contain GPL-3.0 text") && prepareRelease.includes('manifest.author === "Minh Hoang"') && prepareRelease.includes("noticePath"), "release preparation should guard against license and author regressions");
});


check("README feature images are visual-first", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const render = await readFile(new URL("./render-readme-assets.mjs", import.meta.url), "utf8");
  const assetFiles = await readdir(new URL("../assets", import.meta.url));
  const pageHero = render.slice(render.indexOf("function pageHero"), render.indexOf("function pageCuratedDefaults"));
  const pageCuratedDefaults = render.slice(render.indexOf("function pageCuratedDefaults"), render.indexOf("function pageCuratedMovies"));
  const pageCuratedMovies = render.slice(render.indexOf("function pageCuratedMovies"), render.indexOf("function addModal"));
  const pagePersonal = render.slice(render.indexOf("function pagePersonalAdd"), render.indexOf("function youtubeWindow"));
  const pageAutoPause = render.slice(render.indexOf("function pageAutoPause"), render.indexOf("function fullSizeBody"));
  const pageFullSize = render.slice(render.indexOf("function pageFullSize"), render.indexOf("function compactPanel"));
  const pageCompact = render.slice(render.indexOf("function pageCompact"), render.indexOf("function pageAutoHide"));
  const pageAutoHide = render.slice(render.indexOf("function pageAutoHide"), render.indexOf("const pages"));
  assert([
    "readme-hero.png",
    "readme-curated-defaults.png",
    "readme-curated-movies-games.png",
    "readme-personal-add.png",
    "readme-personal-assign.png",
    "readme-personal-folder-mh.png",
    "readme-auto-pause.png",
    "readme-full-size.png",
    "readme-compact.png",
    "readme-auto-hide.png"
  ].every((asset) => readme.includes(asset)), "README should use the generated hero and visual-first split feature assets");
  assert(!readme.includes("readme-quick-pick.png"), "README feature section should not show a separate Quick Pick image");
  assert(render.includes("loadItems") && render.includes("fetchArtwork") && render.includes("fetchTracks") && render.includes('fs.readFileSync(path.join(root, "catalog", "catalog.json")'), "README asset renderer should use real catalog playlists, SoundCloud artwork, and real playlist tracks");
  assert(!assetFiles.some((file) => ["readme-full-player.png", "readme-compact-player.png", "readme-quick-pick.png", "readme-customize.png"].includes(file)), "unused legacy README images should be removed so stale synthetic assets do not ship");
  assert(render.includes("traffic(") && render.includes("simpleAppChrome(") && render.includes("compactPanel("), "README asset renderer should intentionally use Cupertino-style window, dark material, and compact-player primitives");
  assert(pageHero.includes('"Music Pro"') && pageHero.includes('"A plug-and-play music app"') && pageHero.includes("simpleAppChrome(468, 98, 638, 1004") && !pageHero.includes("appFull(190, 50"), "README hero should use sparse copy and a Cupertino-style desktop mockup with a real Music Pro window");
  assert(pageCuratedDefaults.includes('"Curated Playlists"') && pageCuratedDefaults.includes('"Movies/Games"') && pageCuratedDefaults.includes("DATA.categories") && !pageCuratedDefaults.includes('"MH"'), "curated defaults image should use real category labels and avoid showing the personal MH folder");
  assert(pageCuratedMovies.includes('"Movies/Games"') && pageCuratedMovies.includes("DATA.movieList.slice(0, 8)") && !pageCuratedMovies.includes('"MH"'), "curated category detail image should show real playlist rows without personal folders");
  assert(pagePersonal.includes('"Personal"') && render.includes('"Add Music"') && pagePersonal.includes('"Saved to folder"') && pagePersonal.includes('"MH"'), "personal playlist images should show the add/save/folder flow");
  assert(pageAutoPause.includes("youtubeWindow") && pageAutoPause.includes("pausedPlayerCard(") && render.includes('button(x + w - 110, cy, 31, "play"') && !pageAutoPause.includes('"No overlap"'), "auto-pause image should use a sparse visual flow with browser audio and Music Pro paused");
  assert(!render.includes("quickPick(") && !render.includes('"Quick Pick"') && pageFullSize.includes('"FULL-SIZE"') && pageCompact.includes('"COMPACT"') && pageAutoHide.includes('"AUTO"') && pageAutoHide.includes('"HIDE"'), "player-size images should compare full/compact modes and show compact auto-hide without Quick Pick");
});

let failed = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`✗ ${name}: ${error.message}`);
  }
}

if (failed > 0) {
  console.error(`Audit failed: ${failed}/${checks.length} checks failed.`);
  process.exit(1);
}
console.log(`Audit passed: ${checks.length} checks.`);
