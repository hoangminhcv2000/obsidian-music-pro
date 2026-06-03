# Music Pro Playlist Classification Skill

Purpose: classify every imported SoundCloud playlist/album/long set into Music Pro's single **Playlist** taxonomy. Use this when AI refreshes `catalog/catalog.json` or when adding links from user-provided URLs.

## UI rule

- The Library has one mode: **Playlist**.
- The category rail sits on the left.
- Default category on app open: **Editor's Choice**.
- `Editor's Choice` is manual-only. Leave it empty unless the user explicitly asks to add specific links there.
- For a completely new catalog rebuild, start with **zero** `Editor's Choice` items. Add editor picks later only through a separate manual curation pass.
- `Recent` is user-local runtime history, not a catalog category.
- Do not create/use `Other`. If an item does not fit the taxonomy, do not add it to the curated catalog.

## Selection/ranking logic

1. Release catalogs must optimize for anonymous/free SoundCloud embeds first.
2. Before adding a playlist, sample its SoundCloud track metadata and reject it if sampled tracks contain `SNIP`, `BLOCK`, 30-second previews, private tracks, non-public embed rights, unknown availability, or very short filler tracks.
3. Prefer public UGC/community long sets and playlists whose sampled tracks expose normal full durations and playable transcodings.
4. Search famous/mainstream/community-acclaimed names for relevance, but penalize official album/release/chart/hits feeds because they are more likely to be Go+/rights/region restricted.
5. Prefer SoundCloud results that appear popular: higher plays/likes/reposts if known; otherwise preserve SoundCloud search order as a proxy.
6. If the artist/franchise/composer is clearly famous in a category, the playlist title does not need a perfect category-name match.
7. If the item has no known/famous signal, require a stronger title/metadata match to the category.
8. Avoid repeating too many playlists from the same franchise/artist in Movies/Games or any single category.

## Category taxonomy

Use these exact category names in `catalog/catalog.json`:

1. **Editor's Choice**
   - Manual picks only.
   - Do not auto-fill from other categories or general curated picks.

2. **Ambience**
   - Only frequency, environmental, weather, nature, noise, and soundscape audio.
   - Include: rain, thunder, forest, jungle, ocean, waves, river, waterfall, birds, wind, fireplace, campfire, space ambience, `Hz`, binaural, solfeggio, white/brown/pink noise.
   - Do not add generic ambient/chill/relax/sleep music unless it is clearly frequency or environmental sound.

3. **Jazz & Blues**
   - Jazz, blues, and soul.
   - Include: sax/trumpet jazz, bebop, swing, smooth/cafe/lounge jazz, delta/electric blues, soul jazz, classic soul, Motown, neo-soul, quiet storm.

4. **Orchestra**
   - Classical, symphonic, chamber, strings, violin, cello, choir, concerto, ensemble.
   - Can include instrument-focused classical playlists, not only full orchestras.

5. **Piano**
   - Pure piano-first playlists.
   - Include solo piano, piano sonata/concerto, peaceful/study/sleep piano, piano covers.

6. **Movies/Games**
   - Famous film, anime, TV, and game OST/soundtrack/theme playlists.
   - Include famous games/movies/anime and composers first: Zelda, Mario, Minecraft/C418, Final Fantasy/Nobuo Uematsu, Chrono Trigger, NieR, Persona, Halo, Skyrim/Jeremy Soule, Witcher, Journey, Hollow Knight, Celeste, Undertale, Red Dead, The Last of Us, Baldur's Gate, Elden Ring, Ghibli/Joe Hisaishi, Star Wars/John Williams, LOTR/Howard Shore, Harry Potter, Hans Zimmer, Interstellar, Dune, Oppenheimer, Blade Runner, Pirates, Jurassic Park, La La Land, Amélie, Cinema Paradiso, Naruto, One Piece, Attack on Titan, Demon Slayer, Jujutsu Kaisen, Death Note, Cowboy Bebop, Evangelion, Samurai Champloo, Fullmetal Alchemist, Steins;Gate, Your Name, Suzume.
   - Rule: if the match is mainly a franchise/title/OST, classify here first. Do **not** add Fantasy Folk just because the franchise is fantasy.

7. **Handpan & Kalimba**
   - Handpan, hang drum, pantam, steel tongue drum, kalimba, mbira, thumb piano.

8. **House**
   - Funky House, Disco House, Deep House, Soulful House, Chill House, Lounge House, Nu-Disco, disco/groove.
   - Vibe reference: Flavour Trip-style warm house/groove sets: Amii Watson/Jimmi Harvey, cozy rooftop/poolside/sunset/cafe/pizza/lounge mixes, funky/jazzy/piano/soulful/disco/deep house.
   - Prefer 4+ track public playlists/sets with a smooth long-listening flow. Avoid one-track placeholder playlists unless a human explicitly approves it as a full long DJ mix.
   - Avoid hard/techno/trance/dubstep/EDM festival/chart/top-hit playlists when refreshing this category; they are less aligned with the warm Flavour Trip experience and more likely to create preview/rights risk.

9. **Acoustic**
   - Acoustic guitar solo, fingerstyle guitar, Americana, Texas/country acoustic, bluegrass, folk guitar.

10. **Fantasy Folk**
   - Nordic/Norse/Scandinavian/Viking, Celtic, medieval, tavern, bard, lute, hurdy-gurdy, lyre, harp, pagan/dungeon synth.

11. **Bossa**
   - Bossa and gentle Latin lounge styles.
   - Include: samba, Brazilian jazz/lounge, salsa lounge, tango, bolero, rumba, Afro-Cuban.
   - Store this category only as `Bossa`; never save an expanded Bossa label.

12. **Asia**
   - Only traditional Asian styles/instruments or renowned traditional artists.
   - Include: guzheng, guqin, koto, erhu, shamisen, shakuhachi, dizi, pipa, đàn bầu, đàn tranh, taiko, gamelan, sitar, tabla, raga, Silk Road Ensemble.
   - Do not classify generic J-pop/K-pop/anime/lofi here.

13. **Middle East**
   - Only traditional Middle Eastern/North African/Turkish/Persian styles/instruments or renowned artists.
   - Include: oud, qanun/kanun, ney, darbuka, duduk, saz, tanbur, riq, maqam, hijaz, Sufi, Arabic/Persian/Turkish traditional, desert caravan music.
   - Do not classify from the word `desert` alone.

## Classification logic

1. Read title, artist, URL path, SoundCloud author, categories, and tags.
2. Match by semantic intent first, then keywords.
3. A playlist may belong to multiple categories if it strongly fits more than one.
   - Example: `Skyrim peaceful piano OST` → `Movies/Games`, `Piano`; add `Fantasy Folk` only if the metadata says tavern/medieval/folk.
4. Prefer the more specific category when the playlist is clearly dedicated to one style.
   - Example: `Bossa Jazz Cafe` → `Bossa` first; it may also include `Jazz & Blues` if useful.
5. Do not add `Editor's Choice` automatically. Use it only when the user explicitly provides/approves specific links for it.
6. Keep category names short and exact.

## Prompt for AI catalog refresh

```text
You are updating Music Pro's SoundCloud catalog.

For each SoundCloud URL:
1. Fetch/read available metadata: title, author, URL path, oEmbed data if available.
2. Reject the URL if anonymous SoundCloud metadata suggests Go+/region/rights risk:
   `policy: SNIP`, `policy: BLOCK`, preview duration around 30 seconds,
   private/non-public embed rights, unavailable state, unknown sampled availability,
   or too many very short tracks.
3. Classify the surviving item using Music Pro's Playlist taxonomy:
   Ambience, Jazz & Blues, Orchestra, Piano, Movies/Games,
   Handpan & Kalimba, House, Acoustic, Fantasy Folk, Bossa, Asia, Middle East.
4. Use 1-3 categories only.
5. Do not assign Editor's Choice during automatic refreshes.
6. Do not use removed/legacy labels: Rock/Metal, Other, or any expanded Bossa label. Use exactly `Bossa`.
7. Use old category words like Focus, Lofi, Deep House only as tags unless they map cleanly to the taxonomy.
8. If unsure and it does not fit strongly, skip the item instead of adding `Other`.

Return catalog JSON items compatible with catalog/catalog.json.
```

## Implementation references

- Runtime classifier: `src/catalog/playlistCategories.ts`
- Catalog CLI classifier: `scripts/playlist-category-rules.mjs`
- Add URL command: `scripts/add-soundcloud.mjs`
