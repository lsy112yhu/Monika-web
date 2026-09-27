"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { Readable } = require("node:stream");

const HOST = process.env.MUSIC_API_HOST || "127.0.0.1";
const PORT = Number(process.env.MUSIC_API_PORT || 8767);
const DATA_FILE = process.env.MUSIC_DATA_FILE || "/var/lib/web-lsy2005-music/state.json";
const ADMIN_USERNAME = process.env.MUSIC_ADMIN_USERNAME || "Monika";
const ADMIN_PASSWORD_HASH = process.env.MUSIC_ADMIN_PASSWORD_HASH || "";
const SESSION_SECRET = process.env.MUSIC_SESSION_SECRET || "";
const SESSION_TTL_SECONDS = Number(process.env.MUSIC_SESSION_TTL_SECONDS || 43200);
const SESSION_COOKIE = "monika_music_session";
const AUDIO_QUALITY = process.env.MUSIC_AUDIO_QUALITY || "320";
const MAX_BODY_BYTES = 1024 * 1024;
const PUBLIC_STREAM_LIMIT = Number(process.env.MUSIC_PUBLIC_STREAM_LIMIT || 12);
const PER_IP_STREAM_LIMIT = Number(process.env.MUSIC_PER_IP_STREAM_LIMIT || 3);

const qualityMap = {
  "128": { prefix: "M500", suffix: ".mp3" },
  "320": { prefix: "M800", suffix: ".mp3" },
  flac: { prefix: "F000", suffix: ".flac" },
};

const activeStreams = new Map();
let totalActiveStreams = 0;
const loginAttempts = new Map();
const streamRequests = new Map();
const playbackUrlCache = new Map();
let globalStreamRequests = [];

function emptyState() {
  return {
    version: 1,
    credentials: null,
    connectedUin: "",
    catalog: [],
    tracks: [],
    lastSyncAt: "",
  };
}

function ensureDataDirectory() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true, mode: 0o700 });
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { ...emptyState(), ...parsed };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Unable to read state:", error.message);
    return emptyState();
  }
}

let state = loadState();

function saveState() {
  ensureDataDirectory();
  const temporary = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, DATA_FILE);
}

function encryptionKey() {
  const raw = String(process.env.MUSIC_CREDENTIALS_KEY || "").trim();
  if (!raw) return null;
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const value = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return value.length === 32 ? value : null;
  } catch {
    return null;
  }
}

function encryptSecret(value) {
  const key = encryptionKey();
  if (!key) throw new Error("credentials_encryption_not_configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decryptSecret(payload) {
  const key = encryptionKey();
  if (!key || !payload?.iv || !payload?.tag || !payload?.ciphertext) {
    throw new Error("credentials_unavailable");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function parseCookieText(cookieText) {
  const values = {};
  for (const part of String(cookieText || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key && value) values[key] = value;
  }
  const uin = String(values.uin || values.wxuin || "").replace(/\D/g, "");
  const musicKey = values.qqmusic_key || values.qm_keyst || "";
  if (!uin || !musicKey) throw new Error("cookie_missing_fields");
  return { values, uin, musicKey };
}

function getCredentials() {
  if (!state.credentials) throw new Error("qq_not_connected");
  const cookieText = decryptSecret(state.credentials);
  return { cookieText, ...parseCookieText(cookieText) };
}

function base64urlDecode(value) {
  return Buffer.from(`${value}${"=".repeat((4 - (value.length % 4)) % 4)}`, "base64url");
}

function verifyPassword(password) {
  try {
    const [algorithm, iterationText, saltText, digestText] = ADMIN_PASSWORD_HASH.split("$");
    if (algorithm !== "pbkdf2_sha256") return false;
    const digest = crypto.pbkdf2Sync(
      String(password || ""),
      base64urlDecode(saltText),
      Number(iterationText),
      32,
      "sha256",
    );
    return crypto.timingSafeEqual(digest, base64urlDecode(digestText));
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    result[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return result;
}

function makeSession() {
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${issuedAt}.${nonce}`;
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function authenticated(req) {
  if (!SESSION_SECRET) return false;
  const token = parseCookies(req)[SESSION_COOKIE] || "";
  const [issuedAt, nonce, signature] = token.split(".");
  if (!/^\d+$/.test(issuedAt || "") || !nonce || !signature) return false;
  const payload = `${issuedAt}.${nonce}`;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false;
  }
  return Math.floor(Date.now() / 1000) - Number(issuedAt) <= SESSION_TTL_SECONDS;
}

function secureRequest(req) {
  const peer = String(req.socket.remoteAddress || "");
  const trustedProxy = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  return trustedProxy && String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
}

function sessionCookie(req, value, maxAge = SESSION_TTL_SECONDS) {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/api/music",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secureRequest(req) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
}

function mutationAllowed(req) {
  if (req.headers["x-requested-with"] !== "XMLHttpRequest") return false;
  if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function clientIp(req) {
  const peer = String(req.socket.remoteAddress || "");
  const trustedProxy = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  if (trustedProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map((value) => value.trim()).filter(Boolean);
    for (let index = forwarded.length - 1; index >= 0; index -= 1) {
      if (net.isIP(forwarded[index])) return forwarded[index];
    }
  }
  return peer || "unknown";
}

function streamRateLimited(req) {
  const now = Date.now();
  const cutoff = now - 60_000;
  const ip = clientIp(req);
  const recent = (streamRequests.get(ip) || []).filter((timestamp) => timestamp > cutoff);
  globalStreamRequests = globalStreamRequests.filter((timestamp) => timestamp > cutoff);
  if (recent.length >= 80 || globalStreamRequests.length >= 600) return true;
  recent.push(now);
  globalStreamRequests.push(now);
  streamRequests.set(ip, recent);
  return false;
}

function loginRateLimited(req) {
  const now = Date.now();
  const cutoff = now - 15 * 60 * 1000;
  const ip = clientIp(req);
  const recent = (loginAttempts.get(ip) || []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= 8) return true;
  recent.push(now);
  loginAttempts.set(ip, recent);
  if (loginAttempts.size > 4096) {
    for (const [key, values] of loginAttempts) {
      if (!values.length || values[values.length - 1] <= cutoff) loginAttempts.delete(key);
    }
  }
  return false;
}

function stripJsonp(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const start = trimmed.indexOf("(");
  const end = trimmed.lastIndexOf(")");
  return start >= 0 && end > start ? trimmed.slice(start + 1, end) : trimmed;
}

async function qqJson(url, options = {}) {
  const credentials = getCredentials();
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json, text/plain, */*",
      Cookie: credentials.cookieText,
      Referer: "https://y.qq.com/",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`qq_http_${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(stripJsonp(text));
  } catch {
    throw new Error("qq_invalid_response");
  }
}

async function fetchCatalog() {
  const { uin } = getCredentials();
  const createdUrl = new URL("https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss");
  Object.entries({
    hostUin: "0", hostuin: uin, sin: "0", size: "200", g_tk: "5381",
    loginUin: uin, format: "json", inCharset: "utf8", outCharset: "utf-8",
    notice: "0", platform: "yqq.json", needNewCode: "0",
  }).forEach(([key, value]) => createdUrl.searchParams.set(key, value));

  const created = await qqJson(createdUrl);
  if (Number(created?.code) === 1000 || !created?.data || !Array.isArray(created?.data?.disslist)) {
    throw new Error("qq_not_logged_in");
  }
  const createdList = Array.isArray(created?.data?.disslist) ? created.data.disslist : [];
  const catalog = createdList.map((item) => ({
    id: String(item.tid || item.dissid || ""),
    title: String(item.diss_name || item.title || "未命名歌单"),
    cover: String(item.diss_cover || "").replace(/^http:/, "https:"),
    count: Number(item.song_cnt || 0),
    kind: Number(item.dirid) === 201 ? "liked" : "created",
  })).filter((item) => item.id);

  const collectedUrl = new URL("https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg");
  Object.entries({ ct: "20", cid: "205360956", userid: uin, reqtype: "3", sin: "0", ein: "199" })
    .forEach(([key, value]) => collectedUrl.searchParams.set(key, value));
  try {
    const collected = await qqJson(collectedUrl);
    const collectedList = Array.isArray(collected?.data?.cdlist) ? collected.data.cdlist : [];
    for (const item of collectedList) {
      const id = String(item.dissid || item.tid || item.dirid || "");
      if (!id || catalog.some((entry) => entry.id === id)) continue;
      catalog.push({
        id,
        title: String(item.dissname || item.diss_name || item.title || "收藏歌单"),
        cover: String(item.logo || item.diss_cover || "").replace(/^http:/, "https:"),
        count: Number(item.songnum || item.song_cnt || 0),
        kind: "collected",
      });
    }
  } catch (error) {
    console.warn("Unable to load collected playlists:", error.message);
  }

  if (!catalog.some((item) => item.kind === "liked")) {
    const profileUrl = new URL("https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg");
    Object.entries({ cid: "205360838", userid: uin, reqfrom: "1" })
      .forEach(([key, value]) => profileUrl.searchParams.set(key, value));
    try {
      const profile = await qqJson(profileUrl);
      const liked = profile?.data?.mymusic?.[0];
      if (liked?.id) {
        catalog.unshift({ id: String(liked.id), title: "我喜欢", cover: "", count: Number(liked.num0 || 0), kind: "liked" });
      }
    } catch (error) {
      console.warn("Unable to locate liked playlist:", error.message);
    }
  }

  return catalog;
}

function trackId(songmid) {
  return crypto.createHash("sha256").update(`qq:${songmid}`).digest("base64url").slice(0, 18);
}

function normalizeTrack(song, sourcePlaylist) {
  const songmid = String(song.songmid || song.mid || song.songMid || "");
  if (!songmid) return null;
  const album = song.album || {};
  const albumMid = String(album.mid || song.albummid || song.albumMid || "");
  const singers = Array.isArray(song.singer) ? song.singer : Array.isArray(song.singers) ? song.singers : [];
  const artist = singers.map((item) => item.name || item.title).filter(Boolean).join(" / ") || song.singername || "未知歌手";
  const mediaMid = String(song.file?.media_mid || song.strMediaMid || song.media_mid || songmid);
  return {
    id: trackId(songmid),
    songmid,
    mediaMid,
    title: String(song.songname || song.name || song.title || "未命名歌曲"),
    artist: String(artist),
    album: String(album.name || song.albumname || song.albumName || ""),
    cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg?max_age=2592000` : "",
    sourcePlaylistId: sourcePlaylist.id,
    sourcePlaylistTitle: sourcePlaylist.title,
    published: false,
    sort: Number.MAX_SAFE_INTEGER,
  };
}

async function fetchPlaylistTracks(sourcePlaylist) {
  const url = new URL("https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg");
  Object.entries({ type: "1", utf8: "1", format: "json", disstid: sourcePlaylist.id })
    .forEach(([key, value]) => url.searchParams.set(key, value));
  const result = await qqJson(url);
  const songs = result?.cdlist?.[0]?.songlist || result?.data?.cdlist?.[0]?.songlist || [];
  if (!Array.isArray(songs)) throw new Error("qq_playlist_unavailable");
  return songs.map((song) => normalizeTrack(song, sourcePlaylist)).filter(Boolean);
}

function publicTrack(track) {
  return {
    id: track.id,
    title: track.titleOverride || track.title,
    artist: track.artist,
    album: track.album,
    cover: track.coverOverride || track.cover,
    stream: `/api/music/stream/${encodeURIComponent(track.id)}`,
  };
}

function publishedTracks() {
  return state.tracks
    .filter((track) => track.published)
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
    .map(publicTrack);
}

async function requestPlaybackUrl(track, requestedQuality = AUDIO_QUALITY) {
  const credentials = getCredentials();
  const quality = qualityMap[requestedQuality] || qualityMap["320"];
  const credentialFingerprint = crypto.createHash("sha256").update(`${credentials.uin}:${credentials.musicKey}`).digest("hex").slice(0, 16);
  const cacheKey = `${credentialFingerprint}:${track.id}:${requestedQuality}`;
  const cached = playbackUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const filename = `${quality.prefix}${track.mediaMid}${quality.suffix}`;
  const payload = {
    req_0: {
      module: "vkey.GetVkeyServer",
      method: "CgiGetVkey",
      param: {
        filename: [filename],
        guid: String(crypto.randomInt(1000000, 9999999)),
        songmid: [track.songmid],
        songtype: [0],
        uin: credentials.uin,
        loginflag: 1,
        platform: "20",
      },
    },
    comm: { uin: credentials.uin, format: "json", ct: 19, cv: 0, authst: credentials.musicKey },
  };
  const url = new URL("https://u.y.qq.com/cgi-bin/musicu.fcg");
  Object.entries({
    "-": "getplaysongvkey", g_tk: "5381", loginUin: credentials.uin, hostUin: "0",
    format: "json", inCharset: "utf8", outCharset: "utf-8", notice: "0",
    platform: "yqq.json", needNewCode: "0", data: JSON.stringify(payload),
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const result = await qqJson(url);
  const data = result?.req_0?.data;
  const purl = data?.midurlinfo?.[0]?.purl;
  const domain = data?.sip?.find((value) => String(value).startsWith("https://")) || data?.sip?.[0];
  if (!purl || !domain) {
    if (requestedQuality !== "128") return requestPlaybackUrl(track, "128");
    throw new Error("qq_playback_not_authorized");
  }
  const playbackUrl = `${String(domain).replace(/^http:/, "https:")}${purl}`;
  playbackUrlCache.set(cacheKey, { url: playbackUrl, expiresAt: Date.now() + 3 * 60_000 });
  return playbackUrl;
}

function acquireStream(req) {
  const ip = clientIp(req);
  const count = activeStreams.get(ip) || 0;
  if (totalActiveStreams >= PUBLIC_STREAM_LIMIT || count >= PER_IP_STREAM_LIMIT) return null;
  totalActiveStreams += 1;
  activeStreams.set(ip, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    totalActiveStreams = Math.max(0, totalActiveStreams - 1);
    const next = Math.max(0, (activeStreams.get(ip) || 1) - 1);
    if (next) activeStreams.set(ip, next);
    else activeStreams.delete(ip);
  };
}

async function proxyStream(req, res, track) {
  if (streamRateLimited(req)) return sendJson(res, 429, { error: "rate_limited", message: "请求过于频繁，请稍后再试。" }, { "Retry-After": "30" });
  const release = acquireStream(req);
  if (!release) return sendJson(res, 429, { error: "stream_limit", message: "当前播放人数较多，请稍后再试。" }, { "Retry-After": "10" });
  const controller = new AbortController();
  let nodeStream = null;
  let connectTimer = null;
  let idleTimer = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(connectTimer);
    clearTimeout(idleTimer);
    req.removeListener("aborted", abortUpstream);
    release();
  };
  const abortUpstream = () => {
    controller.abort();
    if (nodeStream && !nodeStream.destroyed) nodeStream.destroy();
    cleanup();
  };
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(abortUpstream, 45_000);
  };
  req.once("aborted", abortUpstream);
  res.once("close", () => { if (!res.writableEnded) abortUpstream(); });
  try {
    const playbackUrl = await requestPlaybackUrl(track);
    connectTimer = setTimeout(() => controller.abort(), 15_000);
    const upstream = await fetch(playbackUrl, {
      method: req.method,
      headers: {
        ...(req.headers.range ? { Range: req.headers.range } : {}),
        ...(req.headers["if-range"] ? { "If-Range": req.headers["if-range"] } : {}),
        Referer: "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(connectTimer);
    connectTimer = null;
    if (upstream.status === 416) {
      const contentRange = upstream.headers.get("content-range");
      res.writeHead(416, { ...(contentRange ? { "Content-Range": contentRange } : {}), "Accept-Ranges": "bytes" });
      res.end();
      cleanup();
      return;
    }
    if (![200, 206].includes(upstream.status)) {
      playbackUrlCache.clear();
      throw new Error(`qq_stream_${upstream.status}`);
    }
    const headers = {
      "Cache-Control": "private, no-store",
      "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      "X-Content-Type-Options": "nosniff",
    };
    for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    if (req.method === "HEAD" || !upstream.body) {
      res.end();
      cleanup();
      return;
    }
    nodeStream = Readable.fromWeb(upstream.body);
    resetIdleTimer();
    nodeStream.on("data", resetIdleTimer);
    nodeStream.once("end", cleanup);
    nodeStream.once("close", cleanup);
    nodeStream.once("error", () => { cleanup(); res.destroy(); });
    nodeStream.pipe(res);
  } catch (error) {
    cleanup();
    console.error(`Stream failed for ${track.id}:`, error.message);
    if (!res.headersSent) sendJson(res, 502, { error: "stream_unavailable", message: "这首歌暂时无法播放。" });
    else res.destroy();
  }
}

function adminState() {
  return {
    connected: Boolean(state.credentials),
    uin: state.connectedUin ? `${state.connectedUin.slice(0, 2)}***${state.connectedUin.slice(-2)}` : "",
    catalog: state.catalog,
    tracks: state.tracks.map(({ songmid, mediaMid, ...track }) => track),
    lastSyncAt: state.lastSyncAt,
  };
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const route = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, { Allow: "GET, HEAD, POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Requested-With" });
    return res.end();
  }

  if ((req.method === "GET" || req.method === "HEAD") && route.startsWith("/api/music/stream/")) {
    if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
      return sendJson(res, 403, { error: "hotlink_denied" });
    }
    const id = decodeURIComponent(route.slice("/api/music/stream/".length));
    const track = state.tracks.find((item) => item.id === id && item.published);
    if (!track) return sendJson(res, 404, { error: "track_not_found" });
    return proxyStream(req, res, track);
  }

  if (req.method === "GET" && route === "/api/music/playlist") {
    return sendJson(res, 200, { tracks: publishedTracks(), available: Boolean(state.credentials), updatedAt: state.lastSyncAt });
  }

  if (req.method === "GET" && route === "/api/music/session") {
    return sendJson(res, 200, { authenticated: authenticated(req), user: authenticated(req) ? ADMIN_USERNAME : "" });
  }

  if (req.method === "POST" && route === "/api/music/session") {
    if (!mutationAllowed(req)) return sendJson(res, 403, { error: "bad_origin" });
    if (loginRateLimited(req)) return sendJson(res, 429, { error: "rate_limited", message: "登录尝试过多，请稍后再试。" }, { "Retry-After": "900" });
    const body = await readJson(req);
    if (body.username !== ADMIN_USERNAME || !verifyPassword(body.password)) {
      return sendJson(res, 401, { error: "invalid_credentials", message: "用户名或密码不对。" });
    }
    if (!SESSION_SECRET) return sendJson(res, 503, { error: "auth_not_configured" });
    return sendJson(res, 200, { authenticated: true, user: ADMIN_USERNAME }, { "Set-Cookie": sessionCookie(req, makeSession()) });
  }

  if (req.method === "DELETE" && route === "/api/music/session") {
    if (!mutationAllowed(req)) return sendJson(res, 403, { error: "bad_origin" });
    return sendJson(res, 200, { authenticated: false }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  if (!route.startsWith("/api/music/admin")) return sendJson(res, 404, { error: "not_found" });
  if (!authenticated(req)) return sendJson(res, 401, { error: "unauthorized", message: "请先登录管理员账号。" });
  if (req.method !== "GET" && !mutationAllowed(req)) return sendJson(res, 403, { error: "bad_origin" });

  if (req.method === "GET" && route === "/api/music/admin") {
    return sendJson(res, 200, adminState());
  }

  if (req.method === "PUT" && route === "/api/music/admin/credentials") {
    const body = await readJson(req);
    const parsed = parseCookieText(body.cookieText);
    const previous = state.credentials;
    const previousConnectedUin = state.connectedUin;
    state.credentials = encryptSecret(String(body.cookieText || "").trim());
    state.connectedUin = parsed.uin;
    try {
      state.catalog = await fetchCatalog();
      playbackUrlCache.clear();
      saveState();
      return sendJson(res, 200, adminState());
    } catch (error) {
      state.credentials = previous;
      state.connectedUin = previousConnectedUin;
      throw error;
    }
  }

  if (req.method === "POST" && route === "/api/music/admin/catalog") {
    state.catalog = await fetchCatalog();
    saveState();
    return sendJson(res, 200, adminState());
  }

  if (req.method === "POST" && route === "/api/music/admin/sync") {
    const body = await readJson(req);
    const source = state.catalog.find((item) => item.id === String(body.playlistId || ""));
    if (!source) return sendJson(res, 400, { error: "playlist_not_found", message: "请先选择一个 QQ 音乐歌单。" });
    const synced = await fetchPlaylistTracks(source);
    const existing = new Map(state.tracks.map((track) => [track.id, track]));
    state.tracks = synced.map((track) => {
      const previous = existing.get(track.id);
      return {
        ...track,
        published: Boolean(previous?.published),
        sort: Number.isFinite(previous?.sort) ? previous.sort : Number.MAX_SAFE_INTEGER,
        titleOverride: previous?.titleOverride || "",
        coverOverride: previous?.coverOverride || "",
      };
    });
    state.lastSyncAt = new Date().toISOString();
    saveState();
    return sendJson(res, 200, adminState());
  }

  if (req.method === "PUT" && route === "/api/music/admin/published") {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const allowed = new Set(state.tracks.map((track) => track.id));
    if (ids.some((id) => !allowed.has(id))) return sendJson(res, 400, { error: "invalid_track" });
    const positions = new Map(ids.map((id, index) => [id, index]));
    state.tracks = state.tracks.map((track) => ({
      ...track,
      published: positions.has(track.id),
      sort: positions.has(track.id) ? positions.get(track.id) : Number.MAX_SAFE_INTEGER,
    }));
    saveState();
    return sendJson(res, 200, adminState());
  }

  return sendJson(res, 404, { error: "not_found" });
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error(`${req.method} ${req.url}:`, error.message);
    if (!res.headersSent) {
      const known = {
        cookie_missing_fields: [400, "Cookie 中缺少 uin 和 qm_keyst/qqmusic_key。"],
        credentials_encryption_not_configured: [503, "服务器尚未配置凭据加密密钥。"],
        qq_not_connected: [409, "请先连接 QQ 音乐。"],
        qq_not_logged_in: [401, "QQ 音乐登录已过期，请重新登录。"],
        qq_playback_not_authorized: [403, "当前账号无权播放这首歌，或登录已过期。"],
      };
      const [status, message] = known[error.message] || [502, "QQ 音乐服务暂时不可用。"];
      sendJson(res, status, { error: error.message, message });
    } else {
      res.destroy();
    }
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Music API listening on http://${HOST}:${PORT}`));
}

module.exports = { clientIp, parseCookieText, verifyPassword, normalizeTrack, publicTrack, trackId };
