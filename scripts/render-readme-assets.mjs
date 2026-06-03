#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "assets");
const tmpDir = path.join("/tmp", `musicpro-readme-dark-render-${Date.now()}`);
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif`;

const C = {
  bg0: "#0c111b",
  bg1: "#101827",
  bg2: "#162034",
  obsidian: "#0f1724",
  app: "#121a29",
  app2: "#172235",
  panel: "rgba(19,28,44,.78)",
  panelSolid: "#131c2c",
  panel2: "rgba(24,35,54,.82)",
  field: "rgba(16,24,38,.78)",
  border: "rgba(170,190,225,.13)",
  border2: "rgba(210,225,255,.18)",
  text: "#f4f7ff",
  text2: "#dce6f7",
  muted: "#aeb8ca",
  faint: "#708097",
  accent: "#4d92ff",
  accent2: "#62a5ff",
  accentDark: "#1d58b7",
  green: "#34c759",
  orange: "#ff9f0a",
  red: "#ff453a",
  yellow: "#ffd60a",
  purple: "#bf5af2",
  youtube: "#ff0033"
};

let defs = "";
let uid = 0;
function resetDefs() { defs = ""; uid = 0; }
function esc(v = "") { return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;"); }
function clip(v = "", max = 36) {
  const clean = String(v || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1)).trim()}…` : clean;
}
function cleanTitle(v = "") {
  return String(v || "").replace(/[\u{1F300}-\u{1FAFF}]/gu, "").replace(/\s+/g, " ").trim();
}
function rect(x, y, w, h, r = 0, fill = "#000", stroke = "none", extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
}
function circle(x, y, r, fill = "#000", stroke = "none", extra = "") {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
}
function line(x1, y1, x2, y2, color = C.border, width = 1, extra = "") {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${extra}/>`;
}
function t(x, y, text, size = 24, weight = 700, color = C.text, opts = {}) {
  const attrs = [
    `x="${x}"`, `y="${y}"`, `font-family="${FONT}"`, `font-size="${size}"`,
    `font-weight="${weight}"`, `fill="${color}"`, `dominant-baseline="alphabetic"`
  ];
  if (opts.anchor) attrs.push(`text-anchor="${opts.anchor}"`);
  if (opts.spacing) attrs.push(`letter-spacing="${opts.spacing}"`);
  if (opts.opacity) attrs.push(`opacity="${opts.opacity}"`);
  if (opts.stroke) {
    attrs.push(`stroke="${opts.stroke}"`, `stroke-width="${opts.strokeWidth ?? 0.7}"`, `paint-order="stroke"`, `stroke-linejoin="round"`);
  }
  return `<text ${attrs.join(" ")}>${esc(text)}</text>`;
}
function headline(x, y, text, size = 48, color = C.text, opts = {}) {
  const strokeWidth = opts.strokeWidth ?? Math.max(.34, +(size / 70).toFixed(2));
  return t(x, y, text, size, 900, color, { ...opts, stroke: opts.stroke || color, strokeWidth });
}
function multi(x, y, lines, size = 28, weight = 760, color = C.text, lineHeight = 1.18, opts = {}) {
  return lines.map((v, i) => t(x, y + i * size * lineHeight, v, size, weight, color, opts)).join("");
}
function pathD(d, fill = "none", stroke = C.border, width = 2, extra = "") {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
}
function fmtCount(item) {
  const n = Number(item?.soundcloudTrackCount || 0);
  return n ? `${n} tracks` : "playlist";
}
function title(item, max = 34) { return clip(cleanTitle(item?.displayTitle || item?.title || "SoundCloud Playlist"), max); }
function sub(item, max = 34) { return clip(`${cleanTitle(item?.artist || "SoundCloud")} · ${fmtCount(item)}`, max); }
function duration(ms = 0) {
  const sec = Math.round(Math.max(0, Number(ms || 0)) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function icon(name, x, y, size = 24, color = C.text, weight = 2.4) {
  const scale = size / 24;
  const g = (body, fill = "none", stroke = color) => `<g transform="translate(${x} ${y}) scale(${scale})" stroke="${stroke}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" fill="${fill}">${body}</g>`;
  switch (name) {
    case "play": return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M8 5v14l11-7Z" fill="${color}"/></g>`;
    case "pause": return g(`<path d="M9 5v14M15 5v14"/>`);
    case "prev": return g(`<path d="M19 20 9 12l10-8v16Z"/><path d="M5 19V5"/>`);
    case "next": return g(`<path d="M5 4v16l10-8L5 4Z"/><path d="M19 5v14"/>`);
    case "folder": return g(`<path d="M3 7.5a2 2 0 0 1 2-2h5l2.2 2.3H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>`);
    case "folder-heart": return g(`<path d="M3 7.5a2 2 0 0 1 2-2h5l2.2 2.3H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M14.7 12.2c.7-.9 2.2-.6 2.2.6 0 1.5-2.3 2.8-2.9 3.1-.6-.3-2.9-1.6-2.9-3.1 0-1.2 1.5-1.5 2.2-.6l.7.8Z"/>`);
    case "check": return g(`<path d="m5 12 5 5L20 7"/>`);
    case "plus": return g(`<path d="M12 5v14M5 12h14"/>`);
    case "search": return g(`<circle cx="11" cy="11" r="7"/><path d="m21 21-4.4-4.4"/>`);
    case "music": return g(`<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`);
    case "link": return g(`<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"/>`);
    case "external": return g(`<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>`);
    case "chevron": return g(`<path d="m9 18 6-6-6-6"/>`);
    case "wave": return g(`<path d="M4 12h2m3 0h2m3 0h2m3 0h2"/><path d="M7 8v8M12 5v14M17 8v8"/>`);
    case "volume": return g(`<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9a5 5 0 0 1 0 6"/><path d="M18 6a9 9 0 0 1 0 12"/>`);
    case "shuffle": return g(`<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h2c3.4 0 5.4-12 9-12h9"/><path d="M2 6h2c1.8 0 3.2 2.4 4.4 5"/><path d="M13 18h9"/>`);
    case "repeat": return g(`<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`);
    case "expand": return g(`<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 21H3v-6"/><path d="m3 21 7-7"/>`);
    case "x": return g(`<path d="M6 6l12 12M18 6 6 18"/>`);
    case "sidebar": return g(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>`);
    case "monitor": return g(`<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>`);
    case "cursor": return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M4 3 19 15.5l-7.2 1.1-3.4 6.4Z" fill="${color}" stroke="rgba(0,0,0,.45)" stroke-width="1.2" stroke-linejoin="round"/></g>`;
    case "book": return g(`<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"/>`);
    case "video": return g(`<rect x="3" y="5" width="15" height="14" rx="2"/><path d="m18 9 4-3v12l-4-3Z"/>`);
    default: return "";
  }
}
function pill(x, y, w, h, label, opts = {}) {
  const active = opts.active;
  const fill = opts.fill || (active ? "url(#accentGrad)" : "rgba(255,255,255,.075)");
  const stroke = opts.stroke || (active ? "rgba(100,165,255,.55)" : C.border);
  const color = opts.color || (active ? "#fff" : C.text2);
  let s = rect(x, y, w, h, h / 2, fill, stroke, opts.shadow ? `filter="url(#tactileShadow)"` : "");
  if (opts.icon) s += icon(opts.icon, x + 18, y + (h - 22) / 2, 22, color);
  s += t(x + (opts.icon ? 52 : w / 2), y + h * .66, label, opts.size || Math.min(22, h * .45), 760, color, { anchor: opts.icon ? undefined : "middle" });
  return s;
}
function button(x, y, r, name, opts = {}) {
  const fill = opts.active ? "url(#accentGrad)" : (opts.fill || "rgba(255,255,255,.08)");
  const stroke = opts.active ? "rgba(115,175,255,.50)" : (opts.stroke || C.border);
  const color = opts.active ? "#fff" : (opts.color || C.text2);
  let s = circle(x, y, r, fill, stroke, `filter="${opts.active ? "url(#blueGlow)" : "url(#tactileShadow)"}"`);
  s += icon(name, x - (opts.iconSize || r * .8) / 2, y - (opts.iconSize || r * .8) / 2, opts.iconSize || r * .8, color, opts.weight || 2.4);
  return s;
}
function slider(x, y, w, pct = .55, opts = {}) {
  const h = opts.h || 7;
  const fillW = Math.max(0, Math.min(w, w * pct));
  return rect(x, y, w, h, h / 2, "rgba(135,150,175,.25)")
    + rect(x, y, fillW, h, h / 2, opts.color || C.accent)
    + circle(x + fillW, y + h / 2, opts.knob || 12, "#fff", "rgba(255,255,255,.35)", `filter="url(#knobShadow)"`);
}
function surface(x, y, w, h, r = 36, fill = C.panel, stroke = C.border, shadow = true) {
  return rect(x, y, w, h, r, fill, stroke, shadow ? `filter="url(#panelShadow)"` : "");
}
function traffic(x, y, r = 8) {
  return circle(x, y, r, "#ff5f57") + circle(x + r * 2.6, y, r, "#ffbd2e") + circle(x + r * 5.2, y, r, "#28c840");
}
function albumPlaceholder(x, y, size, seed = 0) {
  const id = `artgrad${uid++}`;
  const palettes = [
    ["#7dd3fc", "#4d92ff", "#172554"],
    ["#fcd34d", "#fb7185", "#4c1d95"],
    ["#c084fc", "#60a5fa", "#111827"],
    ["#86efac", "#22d3ee", "#082f49"],
    ["#fda4af", "#f97316", "#451a03"]
  ];
  const p = palettes[Math.abs(seed) % palettes.length];
  defs += `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset=".58" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient>`;
  let s = rect(x, y, size, size, Math.round(size * .22), `url(#${id})`, "rgba(255,255,255,.20)");
  s += circle(x + size * .78, y + size * .22, size * .36, "rgba(255,255,255,.18)");
  s += circle(x + size * .18, y + size * .86, size * .42, "rgba(0,0,0,.20)");
  s += icon("music", x + size * .31, y + size * .30, size * .42, "rgba(255,255,255,.86)", 2.2);
  return s;
}
function album(x, y, size, item, seed = 0) {
  if (!item?.artworkDataUrl) return albumPlaceholder(x, y, size, seed);
  const clip = `clipArt${uid++}`;
  const r = Math.round(size * .20);
  defs += `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" ry="${r}"/></clipPath>`;
  return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${item.artworkDataUrl}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`
    + rect(x, y, size, size, r, "rgba(0,0,0,0)", "rgba(255,255,255,.22)");
}
function halo(x, y, r, color = C.accent, opacity = .18) {
  return circle(x, y, r, color, "none", `opacity="${opacity}" filter="url(#softBlur)"`);
}
function background(w, h) {
  return rect(0, 0, w, h, 0, "url(#baseBg)")
    + halo(w * .18, h * .08, Math.min(w, h) * .35, C.accent2, .18)
    + halo(w * .88, h * .84, Math.min(w, h) * .38, C.purple, .12)
    + `<path d="M${w * .02} ${h * .78} C${w * .28} ${h * .58} ${w * .42} ${h * .92} ${w * .62} ${h * .72} C${w * .78} ${h * .56} ${w * .88} ${h * .80} ${w} ${h * .64}" fill="none" stroke="rgba(98,165,255,.06)" stroke-width="${Math.max(4, w * .004)}"/>`;
}
function base(w, h, body, opts = {}) {
  const rx = opts.rx || Math.round(Math.min(w, h) * .07);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
  <clipPath id="rootClip"><rect x="0" y="0" width="${w}" height="${h}" rx="${rx}" ry="${rx}"/></clipPath>
  <linearGradient id="baseBg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#0b111c"/><stop offset=".55" stop-color="#121b2a"/><stop offset="1" stop-color="#0a0e16"/></linearGradient>
  <linearGradient id="accentGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#65b2ff"/><stop offset="1" stop-color="#347dff"/></linearGradient>
  <linearGradient id="glassGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.11)"/><stop offset="1" stop-color="rgba(255,255,255,.045)"/></linearGradient>
  <filter id="panelShadow" x="-25%" y="-25%" width="150%" height="160%"><feDropShadow dx="0" dy="20" stdDeviation="34" flood-color="#000000" flood-opacity=".34"/></filter>
  <filter id="windowShadow" x="-22%" y="-22%" width="150%" height="160%"><feDropShadow dx="0" dy="28" stdDeviation="42" flood-color="#000000" flood-opacity=".46"/></filter>
  <filter id="deviceShadow" x="-20%" y="-20%" width="145%" height="155%"><feDropShadow dx="0" dy="30" stdDeviation="40" flood-color="#000000" flood-opacity=".50"/></filter>
  <filter id="tactileShadow" x="-50%" y="-50%" width="210%" height="210%"><feDropShadow dx="0" dy="7" stdDeviation="11" flood-color="#000000" flood-opacity=".22"/></filter>
  <filter id="blueGlow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#4d92ff" flood-opacity=".30"/></filter>
  <filter id="knobShadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity=".35"/></filter>
  <filter id="softBlur" x="-55%" y="-55%" width="210%" height="210%"><feGaussianBlur stdDeviation="80"/></filter>
  ${defs}
</defs>
<g clip-path="url(#rootClip)">
  <g id="00-background">${background(w, h)}</g>
  ${body}
</g>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${rx}" ry="${rx}" fill="none" stroke="rgba(255,255,255,.10)"/>
</svg>`;
}

function loadItems() {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "catalog", "catalog.json"), "utf8"));
  return (raw.items || []).filter((item) => item?.status === "active" && item.provider === "soundcloud" && item.type === "playlist");
}
function findItem(items, category, patterns, fallback = 0) {
  const pool = items.filter((item) => (item.categories || []).includes(category));
  for (const pattern of patterns) {
    const hit = pool.find((item) => pattern.test(`${item.title} ${item.artist} ${(item.tags || []).join(" ")}`));
    if (hit) return hit;
  }
  return pool[fallback] || items[fallback] || items[0];
}
function categoryCounts(items) {
  const counts = new Map();
  for (const item of items) for (const category of item.categories || []) counts.set(category, (counts.get(category) || 0) + 1);
  return counts;
}
async function fetchArtwork(item) {
  if (!item?.artworkUrl) return "";
  try {
    const response = await fetch(item.artworkUrl, {
      headers: { "User-Agent": "MusicProReadmeRenderer/2.0", Accept: "image/jpeg,image/png,image/*" },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch { return ""; }
}
function extractHydration(html = "") {
  const match = String(html).match(/window\.__sc_hydration\s*=\s*([\s\S]*?);<\/script>/);
  if (!match?.[1]) return [];
  try { return JSON.parse(match[1]); } catch { return []; }
}
async function fetchTracks(item, limit = 6) {
  if (!item?.url) return [];
  try {
    const response = await fetch(item.url, {
      headers: { "User-Agent": "MusicProReadmeRenderer/2.0", Accept: "text/html" },
      signal: AbortSignal.timeout(14_000)
    });
    if (!response.ok) return [];
    const hydration = extractHydration(await response.text());
    const playlist = hydration.find((entry) => entry?.hydratable === "playlist")?.data;
    const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
    return tracks.slice(0, limit).map((track) => ({
      title: cleanTitle(track?.title || "SoundCloud Track"),
      artist: cleanTitle(track?.user?.username || item.artist || "SoundCloud"),
      duration: Number(track?.duration || track?.full_duration || 0) || 210000
    }));
  } catch { return []; }
}

const allItems = loadItems();
const counts = categoryCounts(allItems);
const DATA = {
  categories: ["Editor's Choice", "Acoustic", "Ambience", "Asia", "Bossa", "Fantasy Folk", "Handpan & Kalimba", "House", "Jazz & Blues", "Movies/Games", "Orchestra", "Piano"],
  movies: {
    mario: findItem(allItems, "Movies/Games", [/Super Mario Odyssey/i, /Mario Kart/i]),
    zelda: findItem(allItems, "Movies/Games", [/Zelda.*Ocarina/i, /Legend of Zelda/i]),
    skyrim: findItem(allItems, "Movies/Games", [/Skyrim.*Full/i, /Skyrim/i]),
    ghibli: findItem(allItems, "Movies/Games", [/Joe Hisaishi.*Ghibli/i, /Studio Ghibli/i]),
    minecraft: findItem(allItems, "Movies/Games", [/C418 Minecraft/i, /Minecraft/i]),
    persona: findItem(allItems, "Movies/Games", [/persona playlist/i, /Persona/i]),
    celeste: findItem(allItems, "Movies/Games", [/Celeste Soundtrack/i, /Celeste/i]),
    baldurs: findItem(allItems, "Movies/Games", [/Baldur's Gate 3/i, /Baldur/i]),
    interstellar: findItem(allItems, "Movies/Games", [/Interstellar/i])
  },
  focus: {
    jazz: findItem(allItems, "Jazz & Blues", [/jazz|blues|bb king|etta|coltrane|fitzgerald/i]),
    house: findItem(allItems, "House", [/chill lounge|flavour trip|amii watson|soulful|groove/i]),
    ambience: findItem(allItems, "Ambience", [/rain|ocean|white noise|forest/i]),
    ambienceAlt: findItem(allItems, "Ambience", [/binaural|frequency|meditation|sleep/i], 1),
    orchestra: findItem(allItems, "Orchestra", [/Hilary Hahn/i, /Beethoven\s*-\s*Symphony No\.?5/i, /Bach/i, /London Symphony/i]),
    piano: findItem(allItems, "Piano", [/piano/i])
  }
};
DATA.movieList = [DATA.movies.mario, DATA.movies.zelda, DATA.movies.skyrim, DATA.movies.ghibli, DATA.movies.minecraft, DATA.movies.persona, DATA.movies.celeste, DATA.movies.baldurs, DATA.movies.interstellar].filter(Boolean);
DATA.orchestraList = [...new Map([
  DATA.focus.orchestra,
  findItem(allItems, "Orchestra", [/Beethoven\s*-\s*Symphony No\.?5/i, /Beethoven.*Symphony/i]),
  findItem(allItems, "Orchestra", [/Classical\s*-\s*Bach/i, /Bach Cello Suite/i, /Bach/i]),
  findItem(allItems, "Orchestra", [/London Symphony/i]),
  findItem(allItems, "Orchestra", [/Mozart/i]),
  findItem(allItems, "Orchestra", [/Cello Suite/i])
].filter(Boolean).map((item) => [item.url, item])).values()];
const uniqueArtwork = [...new Map([...DATA.movieList, ...DATA.orchestraList, ...Object.values(DATA.focus)].filter(Boolean).map((item) => [item.url, item])).values()];
await Promise.all(uniqueArtwork.map(async (item) => { item.artworkDataUrl = await fetchArtwork(item); }));
DATA.tracks = {
  mario: await fetchTracks(DATA.movies.mario, 6),
  zelda: await fetchTracks(DATA.movies.zelda, 4),
  jazz: await fetchTracks(DATA.focus.jazz, 5),
  ambience: await fetchTracks(DATA.focus.ambience, 5),
  orchestra: await fetchTracks(DATA.focus.orchestra, 5)
};
if (!DATA.tracks.mario.length) DATA.tracks.mario = [
  { title: "Fossil Falls", artist: "Dappa Fuster", duration: 196000 },
  { title: "Steam Gardens", artist: "Dappa Fuster", duration: 226000 },
  { title: "Jump Up, Super Star!", artist: "Dappa Fuster", duration: 249000 },
  { title: "New Donk City", artist: "Dappa Fuster", duration: 178000 }
];
if (!DATA.tracks.zelda.length) DATA.tracks.zelda = [
  { title: "Title Theme", artist: "agatio", duration: 178000 },
  { title: "Kokiri Forest", artist: "agatio", duration: 212000 },
  { title: "Song of Storms", artist: "agatio", duration: 166000 }
];
if (!DATA.tracks.ambience.length) DATA.tracks.ambience = [
  { title: title(DATA.focus.ambience), artist: DATA.focus.ambience?.artist || "SoundCloud", duration: 240000 },
  { title: "Deep Focus Ambience", artist: DATA.focus.ambience?.artist || "SoundCloud", duration: 216000 },
  { title: "Soft Rain Texture", artist: DATA.focus.ambience?.artist || "SoundCloud", duration: 226000 },
  { title: "Calm Room Tone", artist: DATA.focus.ambience?.artist || "SoundCloud", duration: 205000 }
];
if (!DATA.tracks.orchestra.length) DATA.tracks.orchestra = [
  { title: "Violin Concerto", artist: DATA.focus.orchestra?.artist || "Orchestra", duration: 255000 },
  { title: "Adagio Movement", artist: DATA.focus.orchestra?.artist || "Orchestra", duration: 312000 },
  { title: "Chamber Strings", artist: DATA.focus.orchestra?.artist || "Orchestra", duration: 238000 },
  { title: "Symphony Sketch", artist: DATA.focus.orchestra?.artist || "Orchestra", duration: 284000 }
];

function playlistRow(x, y, w, item, opts = {}) {
  const h = opts.h || 104;
  const art = opts.art || 64;
  const active = opts.active;
  const folderState = opts.folder;
  const fill = active ? "rgba(77,146,255,.13)" : "rgba(255,255,255,.055)";
  let s = rect(x, y, w, h, opts.r || 28, fill, active ? "rgba(110,175,255,.36)" : C.border, `filter="url(#tactileShadow)"`);
  s += album(x + 18, y + (h - art) / 2, art, item, opts.seed || 0);
  s += t(x + 18 + art + 18, y + h * .43, title(item, opts.titleMax || 34), opts.titleSize || 22, 760, active ? "#ffffff" : C.text);
  s += t(x + 18 + art + 18, y + h * .70, sub(item, opts.subMax || 36), opts.subSize || 16, 590, C.muted);
  if (opts.showFolder !== false) {
    s += button(x + w - 88, y + h / 2, 24, folderState ? "folder-heart" : "folder", { active: folderState, iconSize: 20 });
  }
  if (opts.showPlay) s += button(x + w - 40, y + h / 2, 24, opts.playIcon || "play", { active: opts.playing, iconSize: 19 });
  return s;
}
function trackList(x, y, w, tracks, opts = {}) {
  let s = "";
  const rowH = opts.rowH || 54;
  tracks.slice(0, opts.limit || 5).forEach((track, i) => {
    const yy = y + i * rowH;
    const active = i === (opts.activeIndex ?? 0);
    if (active) s += rect(x, yy - 7, w, rowH - 4, 17, "rgba(77,146,255,.14)", "rgba(95,165,255,.26)");
    s += t(x + 22, yy + 25, String(i + 1).padStart(2, "0"), 15, 760, active ? C.accent2 : C.faint);
    s += t(x + 64, yy + 25, clip(track.title, opts.titleMax || 36), opts.size || 18, 740, active ? C.accent2 : C.text2);
    s += t(x + w - 18, yy + 25, duration(track.duration), opts.size ? opts.size - 2 : 16, 650, C.faint, { anchor: "end" });
    if (i < (opts.limit || 5) - 1) s += line(x + 62, yy + rowH - 6, x + w - 18, yy + rowH - 6, "rgba(255,255,255,.065)");
  });
  return s;
}
function playerCard(x, y, w, item, track, opts = {}) {
  const h = opts.h || 138;
  const art = opts.art || 78;
  let s = surface(x, y, w, h, opts.r || 36, opts.fill || "rgba(18,27,42,.82)", opts.stroke || C.border2);
  s += album(x + 24, y + (h - art) / 2, art, item, 1);
  s += t(x + 24 + art + 20, y + 52, clip(track?.title || title(item), opts.titleMax || 30), opts.titleSize || 25, 760, C.text);
  s += t(x + 24 + art + 20, y + 82, clip(track?.artist || item?.artist || "SoundCloud", opts.subMax || 30), opts.subSize || 17, 590, C.muted);
  s += slider(x + 24 + art + 20, y + h - 36, Math.min(320, w * .35), opts.progress ?? .42, { h: 7, knob: 11 });
  const cx = x + w - (opts.compact ? 246 : 338);
  const cy = y + h / 2;
  s += button(cx, cy, opts.compact ? 22 : 26, "prev", { iconSize: opts.compact ? 17 : 20 });
  s += button(cx + (opts.compact ? 58 : 70), cy, opts.compact ? 32 : 38, opts.paused ? "play" : "pause", { active: true, iconSize: opts.compact ? 23 : 27 });
  s += button(cx + (opts.compact ? 116 : 140), cy, opts.compact ? 22 : 26, "next", { iconSize: opts.compact ? 17 : 20 });
  if (!opts.compact) {
    s += button(cx + 218, cy, 25, "repeat", { iconSize: 19 });
    s += button(cx + 284, cy, 25, "expand", { iconSize: 19 });
  } else {
    s += icon("volume", cx + 164, cy - 11, 22, C.muted);
    s += slider(cx + 195, cy - 3, 80, .62, { h: 6, knob: 8 });
  }
  return s;
}
function appChrome(x, y, w, h, body, opts = {}) {
  const r = opts.r || 44;
  let s = rect(x, y, w, h, r, "rgba(11,16,26,.92)", "rgba(255,255,255,.16)", `filter="url(#windowShadow)"`);
  s += rect(x + 14, y + 14, w - 28, h - 28, r - 12, C.obsidian, "rgba(255,255,255,.06)");
  s += rect(x + 14, y + 14, w - 28, 66, r - 12, "rgba(255,255,255,.07)", "none");
  s += traffic(x + 48, y + 48, 9);
  s += rect(x + w / 2 - 160, y + 29, 320, 34, 17, "rgba(255,255,255,.09)", "rgba(255,255,255,.06)");
  s += t(x + w / 2, y + 52, opts.title || "Music Pro", 16, 760, C.text2, { anchor: "middle" });
  s += icon("plus", x + w - 190, y + 36, 21, C.muted);
  s += icon("shuffle", x + w - 140, y + 36, 21, C.muted);
  s += icon("sidebar", x + w - 80, y + 36, 21, C.muted);
  s += body(x + 30, y + 94, w - 60, h - 124);
  return s;
}
function simpleAppChrome(x, y, w, h, body, opts = {}) {
  const r = opts.r || 44;
  let s = rect(x, y, w, h, r, "rgba(11,16,26,.92)", "rgba(255,255,255,.16)", `filter="url(#windowShadow)"`);
  s += rect(x + 12, y + 12, w - 24, h - 24, r - 12, C.obsidian, "rgba(255,255,255,.06)");
  s += rect(x + 12, y + 12, w - 24, 64, r - 12, "rgba(255,255,255,.065)", "none");
  s += traffic(x + 44, y + 44, 8.5);
  s += body(x + 30, y + 94, w - 60, h - 126);
  return s;
}
function categoryChipList(x, y, w, active = "Movies/Games", limit = 7) {
  const cats = ["House", "Ambience", "Piano", "Jazz & Blues", "Movies/Games", "Orchestra", "Bossa"];
  let s = "";
  let xx = x;
  for (const cat of cats.slice(0, limit)) {
    const cw = cat.length * 10 + 58;
    if (xx + cw > x + w) break;
    s += pill(xx, y, cw, 40, cat, { active: cat === active, size: 16, shadow: cat === active });
    xx += cw + 12;
  }
  return s;
}
function heroWindowBody(x, y, w, h) {
  const current = DATA.focus.ambience;
  const track = DATA.tracks.ambience[0] || { title: title(DATA.focus.ambience), artist: DATA.focus.ambience?.artist, duration: 240000 };
  let s = "";
  const playerH = 178;
  s += surface(x, y, w, playerH, 34, "rgba(18,27,42,.84)", C.border2);
  s += album(x + 24, y + 28, 88, current, 1);
  s += t(x + 132, y + 66, clip(track?.title || title(current), 23), 24, 760, C.text);
  s += t(x + 132, y + 96, clip(track?.artist || current?.artist || "SoundCloud", 26), 17, 590, C.muted);
  s += slider(x + 132, y + 128, w - 304, .42, { h: 7, knob: 10 });
  s += button(x + w - 168, y + 88, 21, "prev", { iconSize: 15 });
  s += button(x + w - 112, y + 88, 32, "pause", { active: true, iconSize: 22 });
  s += button(x + w - 56, y + 88, 21, "next", { iconSize: 15 });

  const tracksY = y + 214;
  s += surface(x, tracksY, w, 304, 34, "rgba(255,255,255,.045)", C.border, false);
  s += headline(x + 28, tracksY + 50, "Tracks", 27, C.text);
  s += trackList(x + 22, tracksY + 88, w - 44, DATA.tracks.ambience, { limit: 4, activeIndex: 1, titleMax: 31, rowH: 54, size: 18 });

  const listY = tracksY + 338;
  s += surface(x, listY, w, h - (listY - y), 34, "rgba(255,255,255,.045)", C.border, false);
  s += headline(x + 28, listY + 50, "Playlists", 27, C.text);
  let yy = listY + 84;
  [DATA.focus.ambience, DATA.focus.ambienceAlt].filter(Boolean).forEach((item, i) => {
    s += playlistRow(x + 22, yy, w - 44, item, { h: 112, art: 70, active: i === 0, folder: i === 0, showPlay: true, playing: i === 0, titleMax: 27, subMax: 30, titleSize: 20, subSize: 15, seed: i });
    yy += 128;
  });
  return s;
}
function pageHero() {
  resetDefs();
  const W = 1200, H = 1200;
  let body = "";
  body += halo(1030, 145, 290, C.accent2, .16);
  body += headline(88, 170, "Music Pro", 68, C.text);
  body += multi(92, 226, ["A plug-and-play music app", "for deep work inside", "Obsidian."], 24, 620, C.muted, 1.26);
  body += simpleAppChrome(468, 98, 638, 1004, heroWindowBody, { r: 46 });
  return base(W, H, body, { rx: 88 });
}
function pageCuratedDefaults() {
  resetDefs();
  const W = 1200, H = 1200;
  let body = "";
  body += headline(86, 130, "Curated Playlists", 56, C.text);
  const colW = 500;
  const startY = 206;
  DATA.categories.forEach((cat, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 86 + col * 552;
    const y = startY + row * 130;
    const active = cat === "Movies/Games";
    const iconName = cat === "Movies/Games" ? "video" : cat === "Ambience" ? "wave" : cat === "Editor's Choice" ? "check" : "music";
    body += rect(x, y, colW, 92, 30, active ? "rgba(77,146,255,.13)" : "rgba(255,255,255,.055)", active ? "rgba(110,175,255,.28)" : C.border, `filter="url(#tactileShadow)"`);
    body += circle(x + 48, y + 46, 24, active ? "url(#accentGrad)" : "rgba(255,255,255,.08)", active ? "rgba(110,175,255,.32)" : C.border);
    body += icon(iconName, x + 36, y + 34, 24, active ? "#fff" : C.muted, 2.25);
    body += t(x + 88, y + 55, cat, 23, 720, C.text2);
  });
  return base(W, H, body, { rx: 90 });
}
function pageCuratedMovies() {
  resetDefs();
  const W = 1200, H = 1200;
  let body = "";
  body += headline(86, 126, "Movies/Games", 56, C.text);
  body += categoryChipList(86, 165, 1000, "Movies/Games", 5);
  let y = 268;
  DATA.movieList.slice(0, 8).forEach((item, i) => {
    body += playlistRow(86, y, 1028, item, { h: 104, art: 68, active: i === 0, folder: false, showPlay: true, titleMax: 42, subMax: 44, seed: i });
    y += 118;
  });
  return base(W, H, body, { rx: 90 });
}
function addModal(x, y, w, h) {
  let s = surface(x, y, w, h, 48, "rgba(18,27,42,.92)", C.border2);
  s += headline(x + 48, y + 78, "Add Music", 44, C.text);
  s += button(x + w - 70, y + 66, 34, "x", { iconSize: 19, fill: "rgba(255,255,255,.06)" });
  s += line(x + 48, y + 122, x + w - 48, y + 122, "rgba(255,255,255,.09)");
  s += t(x + 48, y + 178, "SoundCloud Link", 25, 820, C.text2);
  s += rect(x + 48, y + 204, w - 96, 76, 28, "rgba(11,17,28,.74)", C.border2);
  s += t(x + 72, y + 252, "https://soundcloud.com/theociderecords/sets/jaz…", 22, 700, C.text);
  s += t(x + 48, y + 318, "Playlist detected", 22, 800, C.muted);
  s += line(x + 48, y + 366, x + w - 48, y + 366, "rgba(255,255,255,.09)");
  s += t(x + 48, y + 420, "Personal Playlists", 25, 820, C.text2);
  s += pill(x + 48, y + 452, 152, 58, "MH", { active: true, icon: "folder-heart", size: 21, shadow: true });
  s += line(x + 48, y + 560, x + w - 48, y + 560, "rgba(255,255,255,.09)");
  s += t(x + 48, y + 615, "New Personal Playlist", 25, 820, C.text2);
  s += rect(x + 48, y + 646, w - 240, 72, 26, "rgba(11,17,28,.74)", C.border2);
  s += t(x + 72, y + 692, "MH", 25, 680, C.text);
  s += pill(x + w - 178, y + 646, 130, 72, "Create", { fill: "rgba(255,255,255,.16)", stroke: "rgba(255,255,255,.20)", size: 22, shadow: true });
  s += line(x + 48, y + 768, x + w - 48, y + 768, "rgba(255,255,255,.09)");
  s += pill(x + w - 330, y + 812, 180, 64, "Add & Play", { active: true, size: 23, shadow: true });
  s += pill(x + w - 132, y + 812, 132, 64, "Cancel", { fill: "rgba(255,255,255,.15)", stroke: "rgba(255,255,255,.20)", size: 22, shadow: true });
  return s;
}
function pagePersonalAdd() {
  resetDefs();
  const W = 900, H = 1350;
  let body = "";
  body += headline(84, 118, "Personal", 48, C.text);
  body += headline(84, 164, "Playlists", 48, C.text);
  body += addModal(54, 232, 792, 930);
  return base(W, H, body, { rx: 80 });
}
function pagePersonalAssign() {
  resetDefs();
  const W = 900, H = 1350;
  let body = "";
  body += headline(72, 116, "Movies/Games", 48, C.text);
  let y = 220;
  [DATA.movies.mario, DATA.movies.zelda, DATA.movies.ghibli, DATA.movies.minecraft].forEach((item, i) => {
    body += playlistRow(64, y, 772, item, { h: 154, art: 92, folder: i < 3, active: i === 3, showPlay: true, titleMax: 27, subMax: 28, titleSize: 24, subSize: 17, seed: i });
    y += 184;
  });
  body += icon("cursor", 704, 828, 72, "#ffffff");
  return base(W, H, body, { rx: 80 });
}
function pagePersonalFolder() {
  resetDefs();
  const W = 900, H = 1350;
  let body = "";
  body += surface(70, 94, 760, 1140, 58, "rgba(18,27,42,.88)", C.border2);
  body += circle(142, 172, 44, "url(#accentGrad)", "rgba(110,175,255,.36)", `filter="url(#blueGlow)"`);
  body += icon("folder-heart", 119, 149, 46, "#fff", 2.1);
  body += headline(206, 166, "MH", 56, C.text);
  body += t(208, 204, "4 playlists", 22, 650, C.muted);
  let y = 292;
  [DATA.movies.mario, DATA.movies.zelda, DATA.movies.ghibli, DATA.movies.minecraft].forEach((item, i) => {
    body += playlistRow(112, y, 676, item, { h: 144, art: 88, active: i === 0, showFolder: false, showPlay: true, titleMax: 26, subMax: 30, titleSize: 23, subSize: 16, seed: i });
    y += 166;
  });
  body += surface(112, 1024, 676, 112, 34, "rgba(77,146,255,.10)", "rgba(77,146,255,.22)", false);
  body += icon("check", 156, 1062, 36, C.green, 2.8);
  body += t(222, 1089, "Saved to folder", 27, 760, C.text2);
  return base(W, H, body, { rx: 80 });
}
function youtubeWindow(x, y, w, h) {
  let s = surface(x, y, w, h, 48, "rgba(17,24,38,.92)", C.border2);
  s += traffic(x + 52, y + 52, 9);
  s += rect(x + 136, y + 31, w - 194, 42, 21, "rgba(255,255,255,.07)", C.border);
  s += t(x + 162, y + 58, "youtube.com/watch?v=HAnw168huqA&t=149s", 17, 650, C.muted);
  const vx = x + 48, vy = y + 112, vw = w - 96, vh = h - 172;
  s += rect(vx, vy, vw, vh, 34, "#05070b", "rgba(255,255,255,.08)");
  s += rect(vx, vy, vw, vh, 34, "url(#youtubeGrad)", "none", 'opacity=".92"');
  s += circle(vx + vw / 2, vy + vh / 2 - 18, 92, "rgba(0,0,0,.42)", "rgba(255,255,255,.18)");
  s += icon("pause", vx + vw / 2 - 32, vy + vh / 2 - 50, 64, "#ffffff", 3);
  s += rect(vx + 36, vy + vh - 72, vw - 72, 6, 3, "rgba(255,255,255,.32)");
  s += rect(vx + 36, vy + vh - 72, (vw - 72) * .46, 6, 3, C.youtube);
  s += icon("pause", vx + 38, vy + vh - 48, 27, "#fff", 2.5);
  s += t(vx + 82, vy + vh - 27, "2:29 / 11:42", 17, 700, "#fff");
  s += t(vx + vw - 32, vy + vh - 27, "HD", 16, 800, "#fff", { anchor: "end" });
  return s;
}
function pausedPlayerCard(x, y, w, item, track) {
  const h = 228;
  let s = surface(x, y, w, h, 46, "rgba(18,27,42,.88)", C.border2);
  s += album(x + 34, y + 42, 92, item, 2);
  s += t(x + 150, y + 76, clip(track?.title || title(item), 20), 25, 760, C.text);
  s += t(x + 150, y + 108, clip(track?.artist || item?.artist || "SoundCloud", 18), 17, 590, C.muted);
  const cy = y + 92;
  s += button(x + w - 160, cy, 20, "prev", { iconSize: 14 });
  s += button(x + w - 110, cy, 31, "play", { active: true, iconSize: 22 });
  s += button(x + w - 60, cy, 20, "next", { iconSize: 14 });
  s += slider(x + 150, y + 142, w - 246, .68, { h: 7, knob: 11 });
  return s;
}
function pageAutoPause() {
  resetDefs();
  const W = 1800, H = 1200;
  defs += `<linearGradient id="youtubeGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#10243d"/><stop offset=".48" stop-color="#101827"/><stop offset="1" stop-color="#2f121a"/></linearGradient>`;
  let body = "";
  body += youtubeWindow(70, 260, 730, 560);
  body += line(842, 540, 1008, 540, C.accent2, 10, `stroke-linecap="round"`);
  body += `<polygon points="1022,540 984,516 984,564" fill="${C.accent2}"/>`;
  body += surface(1050, 318, 640, 430, 56, "rgba(18,27,42,.90)", C.border2);
  body += pausedPlayerCard(1102, 402, 536, DATA.focus.orchestra, null);
  return base(W, H, body, { rx: 88 });
}
function fullSizeBody(x, y, w, h) {
  let s = "";
  s += playerCard(x, y, w, DATA.focus.orchestra, null, { h: 176, art: 96, titleMax: 24, subMax: 30, progress: .47 });
  s += rect(x, y + 206, w, 62, 25, "rgba(255,255,255,.07)", C.border);
  s += icon("search", x + 24, y + 224, 24, C.muted);
  s += t(x + 64, y + 245, "Search playlists", 20, 650, C.faint);
  s += pill(x, y + 298, 166, 40, "Orchestra", { active: true, size: 15, shadow: true });
  s += pill(x + 182, y + 298, 108, 40, "Piano", { size: 15 });
  s += pill(x + 306, y + 298, 124, 40, "Jazz", { size: 15 });
  s += surface(x, y + 368, w, 326, 34, "rgba(255,255,255,.045)", C.border, false);
  s += headline(x + 28, y + 420, "Tracks", 30, C.text);
  s += trackList(x + 22, y + 458, w - 44, DATA.tracks.orchestra, { limit: 4, activeIndex: 0, titleMax: 30, rowH: 58 });
  s += surface(x, y + 728, w, h - 728, 34, "rgba(255,255,255,.045)", C.border, false);
  s += headline(x + 28, y + 780, "Playlists", 30, C.text);
  let yy = y + 818;
  DATA.orchestraList.slice(0, 3).forEach((item, i) => {
    s += playlistRow(x + 22, yy, w - 44, item, { h: 108, art: 68, showPlay: true, folder: i === 0, active: i === 1, titleMax: 25, subMax: 28, titleSize: 20, subSize: 15, seed: i });
    yy += 126;
  });
  return s;
}
function pageFullSize() {
  resetDefs();
  const W = 900, H = 1600;
  let body = "";
  body += simpleAppChrome(56, 76, 788, 1340, (x, y, w, h) => fullSizeBody(x, y, w, h), { r: 44 });
  body += headline(W / 2, 1528, "FULL-SIZE", 42, C.text, { anchor: "middle" });
  return base(W, H, body, { rx: 88 });
}
function compactPanel(x, y, w) {
  let s = surface(x, y, w, 272, 42, "rgba(18,27,42,.88)", C.border2);
  s += rect(x + w / 2 - 48, y + 18, 96, 8, 4, "rgba(170,190,225,.32)");
  s += album(x + 28, y + 54, 82, DATA.focus.orchestra, 2);
  s += t(x + 132, y + 86, title(DATA.focus.orchestra, 22), 23, 850, C.text);
  s += t(x + 132, y + 116, sub(DATA.focus.orchestra, 25), 17, 650, C.muted);
  s += button(x + w - 188, y + 94, 24, "prev", { iconSize: 18 });
  s += button(x + w - 124, y + 94, 36, "pause", { active: true, iconSize: 26 });
  s += button(x + w - 60, y + 94, 24, "next", { iconSize: 18 });
  s += slider(x + 132, y + 158, w - 184, .54, { h: 8, knob: 12 });
  s += t(x + 132, y + 188, "1:49", 15, 650, C.faint);
  s += t(x + w - 54, y + 188, "3:28", 15, 650, C.faint, { anchor: "end" });
  s += icon("volume", x + 132, y + 212, 24, C.muted);
  s += slider(x + 166, y + 221, w - 220, .72, { h: 7, knob: 10 });
  return s;
}
function pageCompact() {
  resetDefs();
  const W = 900, H = 1600;
  let body = "";
  body += compactPanel(98, 170, 704);
  body += headline(W / 2, 1528, "COMPACT", 42, C.text, { anchor: "middle" });
  return base(W, H, body, { rx: 88 });
}
function pageAutoHide() {
  resetDefs();
  const W = 1920, H = 1080;
  let body = "";
  defs += `<linearGradient id="obsidianPane" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#14315a"/><stop offset=".62" stop-color="#12233d"/><stop offset="1" stop-color="#0b111b"/></linearGradient>`;
  defs += `<linearGradient id="obsidianChrome" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2b2b2f"/><stop offset="1" stop-color="#1f2024"/></linearGradient>`;
  defs += `<linearGradient id="handleFace" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#101a2b"/><stop offset="1" stop-color="#0d1522"/></linearGradient>`;

  const winX = 82, winY = 92, winW = 1390, winH = 820;
  const paneX = winX, paneY = winY + 74, paneW = 935, paneH = 706;
  const handleX = paneX + paneW - 4;
  const handleY = paneY + 112;

  let workspace = "";
  workspace += rect(winX, winY, winW, winH, 42, "rgba(24,25,29,.90)", "rgba(255,255,255,.20)", `filter="url(#windowShadow)"`);

  let chrome = "";
  chrome += rect(winX, winY, winW, 74, 42, "url(#obsidianChrome)", "none");
  chrome += traffic(winX + 48, winY + 37, 8.5);
  chrome += t(winX + 108, winY + 44, "MINH'S VAULT", 15, 820, "rgba(220,226,238,.58)", { spacing: 1.4 });
  chrome += icon("sidebar", winX + winW - 82, winY + 25, 24, "rgba(230,236,248,.62)");

  let pane = "";
  pane += rect(paneX, paneY, paneW, paneH, 0, "url(#obsidianPane)", "rgba(77,146,255,.24)");
  pane += rect(paneX + 84, paneY + 126, 450, 76, 28, "rgba(12,20,34,.88)", "rgba(130,170,230,.20)", `filter="url(#tactileShadow)"`);
  pane += icon("folder", paneX + 122, paneY + 151, 28, C.text2, 2.2);
  pane += t(paneX + 170, paneY + 175, "Music Pro", 26, 820, C.text2);

  let noteLines = "";
  for (let i = 0; i < 8; i++) {
    const yy = paneY + 250 + i * 44;
    const ww = [500, 610, 430, 560, 470, 640, 380, 520][i];
    noteLines += rect(paneX + 92, yy, ww, 12, 6, "rgba(215,225,245,.10)");
  }

  let handle = "";
  handle += rect(handleX - 16, handleY - 18, 128, 328, 34, "rgba(77,146,255,.17)", "none", `filter="url(#blueGlow)"`);
  handle += rect(handleX, handleY, 104, 292, 28, "url(#handleFace)", "rgba(77,146,255,.70)", `filter="url(#panelShadow)"`);
  handle += rect(handleX + 18, handleY + 78, 10, 86, 5, C.accent2, "none", `filter="url(#blueGlow)"`);

  let label = "";
  label += rect(1254, 388, 224, 154, 22, "rgba(255,255,255,.035)", "rgba(255,255,255,.28)");
  label += headline(1366, 448, "AUTO", 40, C.text, { anchor: "middle" });
  label += headline(1366, 508, "HIDE", 40, C.text, { anchor: "middle" });
  label += line(1196, 590, 1536, 590, "rgba(98,165,255,.32)", 3, `stroke-linecap="round"`);

  body += `<g id="01-obsidian-workspace-frame">${workspace}</g>`;
  body += `<g id="02-obsidian-top-chrome">${chrome}</g>`;
  body += `<g id="03-obsidian-active-pane">${pane}</g>`;
  body += `<g id="04-note-placeholder-lines">${noteLines}</g>`;
  body += `<g id="05-hidden-compact-handle">${handle}</g>`;
  body += `<g id="06-auto-hide-label">${label}</g>`;

  return base(W, H, body, { rx: 82 });
}

const pages = {
  "readme-hero": pageHero,
  "readme-curated-defaults": pageCuratedDefaults,
  "readme-curated-movies-games": pageCuratedMovies,
  "readme-personal-add": pagePersonalAdd,
  "readme-personal-assign": pagePersonalAssign,
  "readme-personal-folder-mh": pagePersonalFolder,
  "readme-auto-pause": pageAutoPause,
  "readme-full-size": pageFullSize,
  "readme-compact": pageCompact,
  "readme-auto-hide": pageAutoHide
};

for (const [name, render] of Object.entries(pages)) {
  fs.writeFileSync(path.join(tmpDir, `${name}.svg`), render(), "utf8");
}
for (const name of Object.keys(pages)) {
  const svgPath = path.join(tmpDir, `${name}.svg`);
  const pngPath = path.join(tmpDir, `${name}.png`);
  execFileSync("/usr/bin/sips", ["-s", "format", "png", svgPath, "--out", pngPath], { stdio: "ignore" });
  fs.copyFileSync(pngPath, path.join(outDir, `${name}.png`));
  if (name === "readme-auto-hide") {
    fs.copyFileSync(svgPath, path.join(outDir, "readme-auto-hide.affinity-editable.svg"));
  }
}
console.log(`Generated ${Object.keys(pages).length} dark Cupertino README images in ${outDir}`);
