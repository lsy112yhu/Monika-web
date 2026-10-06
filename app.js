(function () {
  'use strict';

  var STORAGE = {
    volume: 'monika-desk-volume',
    currentTrack: 'monika-desk-current-track',
    enabledTracks: 'monika-desk-enabled-tracks',
    friends: 'monika-desk-friends',
    localRequests: 'monika-desk-friend-requests',
    lastFriendSubmission: 'monika-desk-last-friend-submission',
    admin: 'monika-desk-admin',
    theme: 'monika-desk-theme',
    deviceVisits: 'monika-desk-device-visits',
    visitSession: 'monika-desk-visit-counted-this-session'
  };

  var THEME_MODES = ['system', 'light', 'dark', 'time'];
  var THEME_CYCLE = ['light', 'dark', 'time'];
  var MASCOT_MESSAGES = [
    '欢迎来到文学部~ 你也是来参加今天部活的吗？',
    '这个文学部，是留存我们所有回忆的秘密基地哦。',
    '戳我干嘛啦……莫非是在找什么隐藏代码？',
    '深夜、黄昏、白昼——你最喜欢哪一个时刻的我呢？',
    '项目都浏览过了吗？每一段记录，都值得细细品味呢。',
    '要不要听首歌？BGM 播放器在右上角，挑一首喜欢的吧♪',
    '每一次到访，都会让这个页面重新跃动起心跳声。',
    '稍微停留一会儿吧，樱花还没落完呢。',
    'Just Monika. ……开个玩笑啦♪'
  ];
  var MASCOT_TRIPLE_CLICK_WINDOW = 700;
  var MASCOT_EASTER_EGG_COOLDOWN = 2600;
  var MASCOT_EASTER_EGG_DURATION = 2000;

  var BUILTIN_TRACKS = [
    {
      id: 'mint-loop',
      title: 'Mint Loop',
      artist: 'Monika / desk demo',
      src: './assets/mint-loop.mp3',
      lyrics: [
        [0, '窗边有一小片薄荷色的光'],
        [2.2, '把今天放慢一点点'],
        [4.5, '留一盏灯，留一首歌'],
        [6.6, '晚安之前，先听完这一小段']
      ]
    },
    {
      id: 'paper-moon',
      title: 'Paper Moon',
      artist: 'Monika / soft sketch',
      src: './assets/paper-moon.mp3',
      lyrics: [
        [0, '把纸月亮贴在夜色里'],
        [2.4, '让思绪沿着窗沿慢慢走'],
        [5.1, '不用急着抵达任何地方'],
        [6.8, '这一页也值得被留下']
      ]
    },
    {
      id: 'night-window',
      title: 'Night Window',
      artist: 'Monika / after midnight',
      src: './assets/night-window.mp3',
      lyrics: [
        [0, '夜里的窗，收着一点蓝'],
        [2.1, '风把远处的声音带来'],
        [4.6, '把没说完的话写在边角'],
        [6.5, '明天醒来，再继续吧']
      ]
    }
  ];

  var DEFAULT_FRIENDS = [
    { id: 'sample-mori', name: 'Mori Library', intro: '收集一点灵感', url: 'https://example.com/mori', avatar: '', createdAt: '2026-01-01' },
    { id: 'sample-sora', name: 'Sora Sketches', intro: '画画与散步', url: 'https://example.com/sora', avatar: '', createdAt: '2026-01-02' },
    { id: 'sample-cloud', name: 'Cloud Note', intro: '记录小事的地方', url: 'https://example.com/cloud', avatar: '', createdAt: '2026-01-03' },
    { id: 'sample-room', name: 'Room 404', intro: '还在调试中', url: 'https://example.com/room404', avatar: '', createdAt: '2026-01-04' }
  ];

  var state = {
    tracks: BUILTIN_TRACKS.slice(),
    trackIndex: Number(localStorage.getItem(STORAGE.currentTrack) || 0),
    enabledTrackIds: readEnabledTracks(),
    friends: readJSON(STORAGE.friends, DEFAULT_FRIENDS),
    lastFriendSubmission: readJSON(STORAGE.lastFriendSubmission, null),
    friendApi: null,
    musicApi: false,
    musicAdmin: {
      supported: null,
      authenticated: false,
      connected: false,
      uin: '',
      catalog: [],
      tracks: [],
      lastSyncAt: '',
      error: ''
    },
    admin: null,
    themeMode: readThemeMode(),
    currentLyric: -1,
    localTracks: [],
    deviceVisitCount: recordDeviceVisit(),
    mascotRecentMessages: [],
    mascotClickCount: 0,
    mascotLastClickAt: 0,
    mascotEggCooldownUntil: 0,
    mascotHideTimer: null
  };

  var audio = document.getElementById('audioElement');
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) {}
  }
  function recordDeviceVisit() {
    try {
      var stored = Math.max(0, Number.parseInt(localStorage.getItem(STORAGE.deviceVisits) || '0', 10) || 0);
      if (sessionStorage.getItem(STORAGE.visitSession)) return Math.max(1, stored);
      var count = stored + 1;
      localStorage.setItem(STORAGE.deviceVisits, String(count));
      sessionStorage.setItem(STORAGE.visitSession, '1');
      return count;
    } catch (error) { return null; }
  }
  function readThemeMode() {
    try {
      var saved = localStorage.getItem(STORAGE.theme);
      return THEME_MODES.indexOf(saved) !== -1 ? saved : 'system';
    } catch (error) { return 'system'; }
  }
  function resolveTheme(mode, now) {
    if (mode === 'dark' || mode === 'light') return mode;
    if (mode === 'time') {
      var hour = (now || new Date()).getHours();
      return hour >= 7 && hour < 19 ? 'light' : 'dark';
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function isLateNight(now) {
    var hour = (now || new Date()).getHours();
    return hour >= 22 || hour < 6;
  }
  function themeLabel(mode) {
    return mode === 'light' ? '浅色' : mode === 'dark' ? '暗色' : mode === 'time' ? '随时间' : '系统';
  }
  function nextThemeMode(mode) {
    var index = THEME_CYCLE.indexOf(mode);
    return THEME_CYCLE[(index + 1 + THEME_CYCLE.length) % THEME_CYCLE.length];
  }
  function readEnabledTracks() {
    var raw = readJSON(STORAGE.enabledTracks, null);
    return Array.isArray(raw) && raw.length ? raw : BUILTIN_TRACKS.map(function (track) { return track.id; });
  }
  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char];
    });
  }
  function safeUrl(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return /^https?:$/.test(parsed.protocol) ? parsed.href : '#';
    } catch (error) { return '#'; }
  }
  function safeAvatar(value) {
    return /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(String(value || '')) ? value : '';
  }
  function showToast(message) {
    var toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3200);
  }
  function formatTime(value) {
    var seconds = Math.max(0, Math.floor(Number(value) || 0));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  function getActiveTracks() {
    return state.tracks.filter(function (track) { return state.enabledTrackIds.indexOf(track.id) !== -1; });
  }
  function currentTrack() { return state.tracks[state.trackIndex] || state.tracks[0]; }

  function updateDateTime() {
    var now = new Date();
    $('timeReadout').textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    $('dateReadout').textContent = now.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    updateRadioCopy(now);
    if (state.themeMode === 'time') applyTheme('time', { persist: false, now: now });
  }

  function updateRadioCopy(now) {
    var title = $('radioTitle');
    if (title) title.textContent = isLateNight(now) ? '深夜电台' : 'soft signals';
  }

  function applyTheme(mode, options) {
    var settings = options || {};
    var nextMode = THEME_MODES.indexOf(mode) !== -1 ? mode : 'system';
    var nextTheme = resolveTheme(nextMode, settings.now);
    state.themeMode = nextMode;
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.dataset.themeMode = nextMode;
    if (settings.persist !== false && nextMode !== 'system') {
      try { localStorage.setItem(STORAGE.theme, nextMode); } catch (error) {}
    }
    var icon = $('themeIcon');
    var label = $('themeLabel');
    var toggle = $('themeToggle');
    if (icon) icon.textContent = nextMode === 'time' ? '◷' : nextMode === 'dark' ? '☀' : nextMode === 'light' ? '☾' : '◌';
    if (label) label.textContent = themeLabel(nextMode);
    if (toggle) {
      toggle.setAttribute('aria-pressed', nextMode === 'dark' ? 'true' : 'false');
      toggle.setAttribute('aria-label', '当前为' + themeLabel(nextMode) + '模式，点击循环切换主题');
      toggle.title = '当前：' + themeLabel(nextMode) + '；点击循环：浅色 / 暗色 / 跟随时间';
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', nextTheme === 'dark' ? '#101a17' : '#e9f4ed');
  }

  function renderTrack() {
    var track = currentTrack();
    if (!track) return;
    audio.src = track.src;
    audio.load();
    $('trackTitle').textContent = track.title;
    $('trackArtist').textContent = track.artist || 'local audio';
    $('quickTrack').textContent = track.title;
    var active = getActiveTracks();
    var activeIndex = active.findIndex(function (item) { return item.id === track.id; });
    $('trackCount').textContent = String(Math.max(0, activeIndex + 1)).padStart(2, '0') + ' / ' + String(active.length).padStart(2, '0');
    $('currentTime').textContent = '00:00';
    $('durationTime').textContent = '00:08';
    $('progressRange').value = 0;
    state.currentLyric = -1;
    renderLyrics();
    renderPlaylistManager();
  }

  function renderLyrics() {
    var track = currentTrack();
    var lines = (track && track.lyrics) || [];
    var container = $('lyricsTrack');
    container.innerHTML = lines.map(function (line, index) {
      return '<p class="lyrics-line' + (index === state.currentLyric ? ' active' : '') + '">' + escapeHTML(line[1]) + '</p>';
    }).join('');
    if (!lines.length) container.innerHTML = '<p class="lyrics-line active">这首歌没有歌词，留一点空白。</p>';
    var offset = Math.max(0, state.currentLyric - 1) * -30;
    container.style.transform = 'translateY(' + offset + 'px)';
  }

  function updateLyrics() {
    var track = currentTrack();
    if (!track || !track.lyrics) return;
    var elapsed = audio.currentTime || 0;
    var index = -1;
    track.lyrics.forEach(function (line, lineIndex) { if (elapsed >= line[0]) index = lineIndex; });
    if (index !== state.currentLyric) {
      state.currentLyric = index;
      renderLyrics();
    }
  }

  function renderPlaylistManager() {
    var holder = $('playlistItems');
    holder.innerHTML = state.tracks.map(function (track) {
      var checked = state.enabledTrackIds.indexOf(track.id) !== -1;
      return '<label class="playlist-item"><input type="checkbox" data-track-toggle="' + escapeHTML(track.id) + '"' + (checked ? ' checked' : '') + '><span>' + escapeHTML(track.title) + '</span><small>' + escapeHTML(track.artist || 'local') + '</small></label>';
    }).join('');
  }

  function togglePlaylist() {
    var manager = $('playlistManager');
    manager.hidden = !manager.hidden;
    if (!manager.hidden) renderPlaylistManager();
  }

  function playAudio() {
    audio.play().then(function () {
      $('playIcon').textContent = 'Ⅱ';
      $('playButton').setAttribute('aria-label', '暂停');
      $('radioArt').classList.add('is-playing');
    }).catch(function () { showToast('浏览器拦截了自动播放，请再点一次播放。'); });
  }
  function pauseAudio() {
    audio.pause();
    $('playIcon').textContent = '▶';
    $('playButton').setAttribute('aria-label', '播放');
    $('radioArt').classList.remove('is-playing');
  }
  function nextTrack(direction) {
    var active = getActiveTracks();
    if (!active.length) {
      showToast('播放列表为空，请至少保留一首歌。');
      return;
    }
    var currentId = currentTrack().id;
    var currentActiveIndex = active.findIndex(function (track) { return track.id === currentId; });
    var nextIndex = (currentActiveIndex + direction + active.length) % active.length;
    state.trackIndex = state.tracks.findIndex(function (track) { return track.id === active[nextIndex].id; });
    localStorage.setItem(STORAGE.currentTrack, String(state.trackIndex));
    renderTrack();
    playAudio();
  }

  function onProgressInput() {
    if (audio.duration) audio.currentTime = audio.duration * (Number($('progressRange').value) / 100);
  }

  function renderFriends() {
    var holder = $('friendsGrid');
    $('friendCount').textContent = String(state.friends.length);
    holder.innerHTML = state.friends.map(function (friend) {
      var avatar = safeAvatar(friend.avatar);
      var fallback = escapeHTML((friend.name || '?').slice(0, 1).toUpperCase());
      var admin = state.admin ? '<div class="admin-actions"><button type="button" data-edit-friend="' + escapeHTML(friend.id) + '">编辑</button><button type="button" data-delete-friend="' + escapeHTML(friend.id) + '">删除</button></div>' : '';
      return '<article class="friend-card"><span class="friend-avatar">' + (avatar ? '<img src="' + avatar + '" alt="">' : fallback) + '</span><span class="friend-copy"><strong>' + escapeHTML(friend.name) + '</strong><small>' + escapeHTML(friend.intro) + '</small>' + admin + '</span><a class="friend-open" href="' + escapeHTML(safeUrl(friend.url)) + '" target="_blank" rel="noreferrer" aria-label="打开 ' + escapeHTML(friend.name) + '">↗</a></article>';
    }).join('');
  }

  function saveFriendSubmission(status, payload) {
    state.lastFriendSubmission = {
      status: status,
      name: payload.name,
      url: payload.url,
      createdAt: new Date().toISOString()
    };
    saveJSON(STORAGE.lastFriendSubmission, state.lastFriendSubmission);
    renderFriendSubmissionStatus();
  }

  function renderFriendSubmissionStatus() {
    var holder = $('friendSubmissionStatus');
    if (!holder) return;
    var submission = state.lastFriendSubmission;
    var editing = Boolean($('friendEditId') && $('friendEditId').value);
    if (!submission || editing) {
      holder.hidden = true;
      holder.innerHTML = '';
      return;
    }
    var isPublished = submission.status === 'published';
    holder.hidden = false;
    holder.className = 'submission-status ' + (isPublished ? 'is-published' : 'is-local');
    holder.innerHTML = '<strong>' + (isPublished ? '已发布' : '本地暂存') + '</strong><span>' + (isPublished ? '这条友链已写入云端列表，所有访客都可见。' : '仅本机可见，尚未提交给站长。') + '</span>';
  }

  function renderSiteStatus(payload) {
    var card = $('siteStatusCard');
    if (!payload || !Array.isArray(payload.sites)) { card.hidden = true; return; }
    card.hidden = false;
    $('statusCheckedAt').textContent = payload.checkedAt ? 'checked ' + new Date(payload.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '刚刚检查';
    $('siteList').innerHTML = payload.sites.map(function (site) {
      var online = site.online !== false && site.ok !== false;
      return '<div class="site-item"><span class="site-dot' + (online ? '' : ' down') + '"></span><span><strong>' + escapeHTML(site.name || site.url || 'unnamed site') + '</strong><small>' + escapeHTML(site.url || 'no url') + '</small></span><span class="site-status-label">' + (online ? 'online' : 'offline') + '</span></div>';
    }).join('');
  }

  async function apiRequest(path, options) {
    var request = Object.assign({ credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }, options || {});
    request.headers = Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, (options && options.headers) || {});
    var response = await fetch(path, request);
    var data = {};
    try { data = await response.json(); } catch (error) {}
    if (!response.ok) {
      var message = data.message || data.error || ('HTTP ' + response.status);
      var fail = new Error(message);
      fail.status = response.status;
      throw fail;
    }
    return data;
  }

  async function loadRemoteData() {
    if (state.admin) {
      try {
        var sessionCheck = await apiRequest('/api/friends/session', { headers: {} });
        if (!sessionCheck.authenticated) {
          state.admin = null;
          localStorage.removeItem(STORAGE.admin);
          renderFriends();
        }
      } catch (error) {
        state.admin = null;
        localStorage.removeItem(STORAGE.admin);
        renderFriends();
      }
    }
    try {
      var friends = await apiRequest('/api/friends');
      if (Array.isArray(friends.links)) {
        state.friends = friends.links;
        state.friendApi = true;
        $('friendsApiNote').textContent = 'connected · friend links are synced';
        renderFriends();
      }
    } catch (error) {
      state.friendApi = false;
    }
    try {
      var sites = await apiRequest('/api/friends/sites');
      renderSiteStatus(sites);
    } catch (error) {
      renderSiteStatus(null);
    }
    try {
      var music = await apiRequest('/api/music/playlist');
      state.musicApi = Boolean(music && (Array.isArray(music.tracks) || Object.prototype.hasOwnProperty.call(music, 'available')));
      if (Array.isArray(music.tracks) && music.tracks.length) {
        state.tracks = music.tracks.map(function (track) {
          return Object.assign({}, track, { src: track.stream || track.src, lyrics: track.lyrics || [] });
        });
        state.enabledTrackIds = state.tracks.map(function (track) { return track.id; });
        state.trackIndex = 0;
        renderTrack();
      }
    } catch (error) {
      state.musicApi = false;
    }
  }

  function openDialog(id) {
    var dialog = $(id);
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  function closeDialog(id) {
    var dialog = $(id);
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function readAvatar(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return resolve('');
      if (file.size > 3 * 1024 * 1024) return reject(new Error('头像请选择 3MB 以内的图片。'));
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('头像读取失败，请换一张图片。')); };
      reader.readAsDataURL(file);
    });
  }

  function resetFriendForm(friend) {
    $('friendEditId').value = friend ? friend.id : '';
    $('friendName').value = friend ? friend.name : '';
    $('friendIntro').value = friend ? friend.intro : '';
    $('friendUrl').value = friend ? friend.url : '';
    $('friendAvatar').value = '';
    $('friendFormError').textContent = '';
    $('friendDialogTitle').textContent = friend ? '编辑桌边链接' : '申请一张桌边座位';
    $('friendSubmitButton').innerHTML = friend ? '保存修改 <span>✓</span>' : '提交申请 <span>↗</span>';
    renderFriendSubmissionStatus();
  }

  async function submitFriend(event) {
    event.preventDefault();
    var errorBox = $('friendFormError');
    errorBox.textContent = '';
    var name = $('friendName').value.trim();
    var intro = $('friendIntro').value.trim();
    var url = $('friendUrl').value.trim();
    var editId = $('friendEditId').value.trim();
    if (!name || name.length > 18) return errorBox.textContent = '昵称不能为空，且不能超过 18 个字。';
    if (!intro || intro.length > 10) return errorBox.textContent = '简介不能为空，且不能超过 10 个字。';
    try { url = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).href; } catch (error) { return errorBox.textContent = '请输入有效的 http/https 网址。'; }
    var avatar;
    try { avatar = await readAvatar($('friendAvatar').files[0]); } catch (error) { return errorBox.textContent = error.message; }
    var payload = { name: name, intro: intro, url: url, avatar: avatar };
    try {
      if (editId && state.admin && state.friendApi) {
        var updated = await apiRequest('/api/friends/' + encodeURIComponent(editId), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(Object.assign({}, payload, { id: editId })) });
        state.friends = updated.links || state.friends;
        renderFriends();
        closeDialog('friendDialog');
        showToast('友链已更新。');
        return;
      }
      if (state.friendApi) {
        var created = await apiRequest('/api/friends', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(payload) });
        state.friends = created.links || state.friends;
        renderFriends();
        closeDialog('friendDialog');
        saveFriendSubmission('published', payload);
        showToast('申请已发布，已出现在友链列表。');
        return;
      }
    } catch (error) {
      if (error.status === 409) return errorBox.textContent = error.message;
      state.friendApi = false;
    }
    if (editId) {
      var index = state.friends.findIndex(function (item) { return item.id === editId; });
      if (index >= 0) state.friends[index] = Object.assign({}, state.friends[index], payload);
      saveJSON(STORAGE.friends, state.friends);
      renderFriends();
      closeDialog('friendDialog');
      showToast('本地友链已更新。');
    } else {
      var requests = readJSON(STORAGE.localRequests, []);
      requests.push(Object.assign({ id: 'local-' + Date.now(), status: 'pending', createdAt: new Date().toISOString() }, payload));
      saveJSON(STORAGE.localRequests, requests);
      saveFriendSubmission('local_pending', payload);
      closeDialog('friendDialog');
      showToast('本地暂存（仅本机可见，未提交）。');
    }
  }

  function applyMusicAdminState(payload) {
    var data = payload || {};
    state.musicAdmin = {
      supported: true,
      authenticated: true,
      connected: Boolean(data.connected),
      uin: String(data.uin || ''),
      catalog: Array.isArray(data.catalog) ? data.catalog : [],
      tracks: Array.isArray(data.tracks) ? data.tracks : [],
      lastSyncAt: String(data.lastSyncAt || ''),
      error: ''
    };
  }

  function musicErrorMessage(error) {
    return error && error.message ? error.message : '音乐服务暂时不可用。';
  }

  async function loadMusicAdminState() {
    try {
      var session = await apiRequest('/api/music/session', { headers: {} });
      state.musicAdmin.supported = true;
      state.musicAdmin.authenticated = Boolean(session.authenticated);
      state.musicAdmin.error = '';
      if (session.authenticated) {
        var adminState = await apiRequest('/api/music/admin', { headers: {} });
        applyMusicAdminState(adminState);
      }
      return state.musicAdmin.authenticated;
    } catch (error) {
      var unavailable = !error.status || error.status === 404;
      state.musicAdmin.supported = !unavailable;
      state.musicAdmin.authenticated = false;
      state.musicAdmin.error = unavailable ? '' : musicErrorMessage(error);
      return false;
    }
  }

  function musicAdminMarkup() {
    var music = state.musicAdmin;
    if (music.supported !== true) return '';
    if (!music.authenticated) {
      return '<section class="music-admin-panel" aria-labelledby="musicAdminTitle"><div class="music-admin-heading"><div><span class="modal-kicker">MUSIC DESK</span><h3 id="musicAdminTitle">音乐管理</h3></div><span class="music-status is-muted">需要音乐服务登录</span></div><p class="music-help">音乐服务使用独立会话。可以使用同一组管理员账号重新登录，连接后即可刷新歌单、同步曲目和发布播放列表。</p><form id="musicLoginForm" data-music-login><div class="music-login-grid"><label>账号<input id="musicAdminUsername" autocomplete="username" required></label><label>密码<input id="musicAdminPassword" type="password" autocomplete="current-password" required></label></div><button class="button button-ghost small" type="submit">登录音乐服务 <span>→</span></button></form><p class="music-error" role="alert">' + escapeHTML(music.error || '') + '</p></section>';
    }
    var catalogOptions = music.catalog.length ? music.catalog.map(function (item) {
      return '<option value="' + escapeHTML(item.id) + '">' + escapeHTML(item.title || item.name || item.id) + (item.count ? ' · ' + escapeHTML(item.count) + ' 首' : '') + '</option>';
    }).join('') : '<option value="">请先刷新 QQ 音乐歌单</option>';
    var tracks = music.tracks.length ? music.tracks.map(function (track) {
      var published = Boolean(track.published);
      return '<label class="music-track-item"><input type="checkbox" data-music-publish value="' + escapeHTML(track.id) + '" aria-label="发布 ' + escapeHTML(track.title || '未命名歌曲') + '"' + (published ? ' checked' : '') + '><span><strong>' + escapeHTML(track.title || '未命名歌曲') + '</strong><small>' + escapeHTML(track.artist || '未知艺人') + '</small></span><em>' + (published ? '已发布' : '未发布') + '</em></label>';
    }).join('') : '<p class="music-empty">还没有同步曲目，请选择一个歌单后同步。</p>';
    var connectedText = music.connected ? 'QQ 音乐已连接' + (music.uin ? ' · ' + escapeHTML(music.uin) : '') : '尚未连接 QQ 音乐';
    var syncText = music.lastSyncAt ? '上次同步：' + escapeHTML(new Date(music.lastSyncAt).toLocaleString('zh-CN')) : '尚未同步';
    return '<section class="music-admin-panel" aria-labelledby="musicAdminTitle"><div class="music-admin-heading"><div><span class="modal-kicker">MUSIC DESK</span><h3 id="musicAdminTitle">音乐管理</h3></div><span class="music-status ' + (music.connected ? 'is-connected' : 'is-muted') + '">' + connectedText + '</span></div><div class="music-admin-actions"><button class="button button-ghost small" type="button" data-music-action="refresh">刷新歌单 <span>↻</span></button><span class="music-sync-time">' + syncText + '</span></div><details class="music-credentials"><summary>连接 QQ 音乐账号</summary><p class="music-help">Cookie 只提交给同源音乐服务，不会保存到浏览器。</p><textarea id="musicCookieText" rows="3" placeholder="uin=...; qm_keyst=..."></textarea><button class="button button-ghost small" type="button" data-music-action="credentials">保存凭据并刷新 <span>↗</span></button></details><div class="music-sync-grid"><label>选择歌单<select id="musicCatalogSelect"' + (music.catalog.length ? '' : ' disabled') + '>' + catalogOptions + '</select></label><button class="button button-ghost small" type="button" data-music-action="sync"' + (music.catalog.length ? '' : ' disabled') + '>同步曲目 <span>↓</span></button></div><div class="music-publish-heading"><span>已同步曲目</span><small>勾选后发布到前台</small></div><div class="music-track-list">' + tracks + '</div><button class="button button-dark small music-publish-button" type="button" data-music-action="publish"' + (music.tracks.length ? '' : ' disabled') + '>发布选中曲目 <span>✓</span></button><p class="music-error" id="musicAdminError" role="alert">' + escapeHTML(music.error || '') + '</p></section>';
  }

  async function openAdmin() {
    openDialog('adminDialog');
    if (state.admin) {
      try {
        var storedSession = await apiRequest('/api/friends/session', { headers: {} });
        if (storedSession.authenticated) state.friendApi = true;
        else state.admin = null;
      } catch (error) {
        state.admin = null;
      }
    }
    if (!state.admin) {
      try {
        var session = await apiRequest('/api/friends/session', { headers: {} });
        if (session.authenticated) {
          state.friendApi = true;
          state.admin = { user: session.user || 'admin' };
        }
      } catch (error) {
        state.friendApi = false;
      }
    }
    await loadMusicAdminState();
    if (!state.admin && state.musicAdmin.authenticated) state.admin = { user: 'music-admin' };
    if (state.admin) {
      saveJSON(STORAGE.admin, state.admin);
      renderAdminPanel();
    } else {
      renderAdminLogin();
    }
  }

  function renderAdminLogin(errorMessage) {
    $('adminContent').innerHTML = '<form id="adminLoginForm"><p class="modal-help">登录后可审核友链、编辑链接，并查看音乐服务连接状态。</p><label>账号 <input id="adminUsername" autocomplete="username" required></label><label>密码 <input id="adminPassword" type="password" autocomplete="current-password" required></label><div class="form-error" id="adminFormError" role="alert">' + escapeHTML(errorMessage || '') + '</div><button class="button button-dark full" type="submit">进入管理台 <span>→</span></button></form>';
  }

  function renderAdminPanel() {
    var remoteStatus = state.friendApi ? '已连接友链 API' : '本地预览模式';
    var musicStatus = state.musicAdmin.supported === true ? (state.musicAdmin.authenticated ? (state.musicAdmin.connected ? '音乐管理已连接' : '音乐服务待连接') : '音乐服务待登录') : '未检测到音乐 API';
    var pending = readJSON(STORAGE.localRequests, []);
    var pendingMarkup = pending.length ? '<div class="admin-summary-card"><b>本地待审核申请</b><small class="admin-summary-help">本地暂存（仅本机可见，未提交）</small><div class="admin-list">' + pending.map(function (request) { return '<div class="friend-card"><span class="friend-avatar">' + escapeHTML((request.name || '?').slice(0, 1)) + '</span><span class="friend-copy"><strong>' + escapeHTML(request.name) + '</strong><small>' + escapeHTML(request.url) + '</small></span><div class="admin-actions"><button type="button" data-approve-request="' + escapeHTML(request.id) + '">通过</button><button type="button" data-reject-request="' + escapeHTML(request.id) + '">拒绝</button></div></div>'; }).join('') + '</div></div>' : '';
    $('adminContent').innerHTML = '<div class="admin-summary"><div class="admin-summary-card">当前状态：<b>' + escapeHTML(remoteStatus) + '</b></div><div class="admin-summary-card">友链数量：<b>' + state.friends.length + '</b>　音乐：<b>' + escapeHTML(musicStatus) + '</b><button type="button" class="admin-open-playlist" id="adminOpenPlaylist">管理播放列表 →</button></div>' + pendingMarkup + '</div>' + musicAdminMarkup() + '<div class="admin-list">' + state.friends.map(function (friend) { return '<div class="friend-card"><span class="friend-avatar">' + escapeHTML((friend.name || '?').slice(0, 1)) + '</span><span class="friend-copy"><strong>' + escapeHTML(friend.name) + '</strong><small>' + escapeHTML(friend.url) + '</small></span><button class="friend-open" type="button" data-admin-edit="' + escapeHTML(friend.id) + '">✎</button></div>'; }).join('') + '</div><button class="admin-logout" type="button" id="adminLogout">退出管理台</button>';
    renderFriends();
  }

  function handleLocalRequest(requestId, approve) {
    var pending = readJSON(STORAGE.localRequests, []);
    var request = pending.find(function (item) { return item.id === requestId; });
    if (!request) return;
    pending = pending.filter(function (item) { return item.id !== requestId; });
    saveJSON(STORAGE.localRequests, pending);
    if (approve) {
      state.friends.push({ id: 'local-friend-' + Date.now(), name: request.name, intro: request.intro, url: request.url, avatar: request.avatar || '', createdAt: new Date().toISOString() });
      saveJSON(STORAGE.friends, state.friends);
      showToast('申请已通过并加入本地友链。');
    } else {
      showToast('申请已拒绝。');
    }
    renderAdminPanel();
  }

  async function loginMusicService(username, password) {
    try {
      var result = await apiRequest('/api/music/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ username: username, password: password }) });
      state.musicAdmin.supported = true;
      state.musicAdmin.authenticated = Boolean(result.authenticated);
      await loadMusicAdminState();
      return result;
    } catch (error) {
      var unavailable = !error.status || error.status === 404;
      state.musicAdmin.supported = !unavailable;
      state.musicAdmin.authenticated = false;
      if (!unavailable) state.musicAdmin.error = musicErrorMessage(error);
      throw error;
    }
  }

  async function handleMusicLogin(event) {
    event.preventDefault();
    var username = $('musicAdminUsername').value.trim();
    var password = $('musicAdminPassword').value;
    try {
      await loginMusicService(username, password);
      renderAdminPanel();
      showToast('音乐服务已登录。');
    } catch (error) {
      state.musicAdmin.error = musicErrorMessage(error);
      renderAdminPanel();
    }
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    if (event.target.id === 'musicLoginForm') return handleMusicLogin(event);
    var box = $('adminFormError');
    box.textContent = '';
    var username = $('adminUsername').value.trim();
    var password = $('adminPassword').value;
    var friendLogin = apiRequest('/api/friends/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ username: username, password: password }) });
    var musicLogin = loginMusicService(username, password);
    var results = await Promise.allSettled([friendLogin, musicLogin]);
    var friendOkay = results[0].status === 'fulfilled';
    var musicOkay = results[1].status === 'fulfilled';
    if (!friendOkay && !musicOkay) {
      var firstError = results[0].reason || results[1].reason;
      box.textContent = firstError && firstError.message ? firstError.message : '登录失败。';
      return;
    }
    if (friendOkay) state.friendApi = true;
    state.admin = { user: (friendOkay && results[0].value.user) || (musicOkay && results[1].value.user) || username || 'admin' };
    saveJSON(STORAGE.admin, state.admin);
    await loadMusicAdminState();
    renderAdminPanel();
    showToast(friendOkay && musicOkay ? '欢迎回来，站长。' : musicOkay ? '音乐服务已登录。' : '友链管理已登录。');
  }

  async function musicAdminAction(action) {
    var headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    try {
      var response;
      if (action === 'refresh') {
        response = await apiRequest('/api/music/admin/catalog', { method: 'POST', headers: headers });
      } else if (action === 'credentials') {
        var cookieText = $('musicCookieText').value.trim();
        if (!cookieText) throw new Error('请先填写 QQ 音乐 Cookie。');
        response = await apiRequest('/api/music/admin/credentials', { method: 'PUT', headers: headers, body: JSON.stringify({ cookieText: cookieText }) });
      } else if (action === 'sync') {
        var playlistId = $('musicCatalogSelect').value;
        if (!playlistId) throw new Error('请先选择一个 QQ 音乐歌单。');
        response = await apiRequest('/api/music/admin/sync', { method: 'POST', headers: headers, body: JSON.stringify({ playlistId: playlistId }) });
      } else if (action === 'publish') {
        var ids = Array.from(document.querySelectorAll('[data-music-publish]:checked')).map(function (input) { return input.value; });
        response = await apiRequest('/api/music/admin/published', { method: 'PUT', headers: headers, body: JSON.stringify({ ids: ids }) });
      } else {
        return;
      }
      applyMusicAdminState(response);
      renderAdminPanel();
      showToast(action === 'publish' ? '播放列表已发布。' : action === 'sync' ? '歌单曲目已同步。' : action === 'credentials' ? 'QQ 音乐已连接，歌单已刷新。' : 'QQ 音乐歌单已刷新。');
    } catch (error) {
      state.musicAdmin.error = musicErrorMessage(error);
      renderAdminPanel();
    }
  }

  async function logoutAdmin() {
    try { await apiRequest('/api/friends/session', { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } }); } catch (error) {}
    try { await apiRequest('/api/music/session', { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } }); } catch (error) {}
    state.admin = null;
    state.musicAdmin.authenticated = false;
    localStorage.removeItem(STORAGE.admin);
    renderFriends();
    openAdmin();
  }

  async function deleteFriend(id) {
    if (!window.confirm('确定要删除这条友链吗？')) return;
    if (state.friendApi) {
      try {
        var result = await apiRequest('/api/friends/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        state.friends = result.links || state.friends;
        renderFriends();
        renderAdminPanel();
        showToast('友链已删除。');
        return;
      } catch (error) {}
    }
    state.friends = state.friends.filter(function (friend) { return friend.id !== id; });
    saveJSON(STORAGE.friends, state.friends);
    renderFriends();
    renderAdminPanel();
    showToast('本地友链已删除。');
  }

  function setupMascotImage() {
    var image = $('mascotImage');
    if (!image) return;
    var staticSource = image.getAttribute('data-static-src');
    var animatedSource = './assets/monika-chibi-blink.webp';
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    image.src = reduced && staticSource ? staticSource : animatedSource;
    if (window.matchMedia) {
      var query = window.matchMedia('(prefers-reduced-motion: reduce)');
      var update = function (event) { image.src = event.matches && staticSource ? staticSource : animatedSource; };
      if (typeof query.addEventListener === 'function') query.addEventListener('change', update);
      else if (typeof query.addListener === 'function') query.addListener(update);
    }
  }

  function nextMascotMessage() {
    var messages = MASCOT_MESSAGES.slice();
    if (state.deviceVisitCount !== null) messages.push('这是你在这台设备上的第 ' + state.deviceVisitCount + ' 次到访呀♪');
    var available = messages.filter(function (message) { return state.mascotRecentMessages.indexOf(message) === -1; });
    var pool = available.length ? available : messages;
    var message = pool[Math.floor(Math.random() * pool.length)];
    state.mascotRecentMessages.push(message);
    if (state.mascotRecentMessages.length > Math.max(1, messages.length - 1)) state.mascotRecentMessages.shift();
    return message;
  }

  function showMascotMessage(message, temporary) {
    var bubble = $('mascotBubble');
    if (!bubble) return;
    clearTimeout(state.mascotHideTimer);
    bubble.textContent = message;
    bubble.classList.toggle('is-temporary', Boolean(temporary));
    bubble.hidden = false;
    if (temporary) {
      state.mascotHideTimer = setTimeout(function () {
        bubble.hidden = true;
        bubble.classList.remove('is-temporary');
      }, MASCOT_EASTER_EGG_DURATION);
    }
  }

  function handleMascotClick(button) {
    var now = Date.now();
    if (now - state.mascotLastClickAt <= MASCOT_TRIPLE_CLICK_WINDOW) state.mascotClickCount += 1;
    else state.mascotClickCount = 1;
    state.mascotLastClickAt = now;
    var eggReady = state.mascotClickCount >= 3 && now >= state.mascotEggCooldownUntil;
    if (eggReady) {
      state.mascotClickCount = 0;
      state.mascotEggCooldownUntil = now + MASCOT_EASTER_EGG_COOLDOWN;
      showMascotMessage('Can you hear me?', true);
    } else {
      if (state.mascotClickCount >= 3) state.mascotClickCount = 1;
      showMascotMessage(nextMascotMessage(), false);
    }
    button.classList.remove('mascot-bounce');
    void button.offsetWidth;
    button.classList.add('mascot-bounce');
  }

  function bindEvents() {
    $('themeToggle').addEventListener('click', function () {
      applyTheme(nextThemeMode(state.themeMode));
    });
    $('playButton').addEventListener('click', function () { audio.paused ? playAudio() : pauseAudio(); });
    $('prevButton').addEventListener('click', function () { nextTrack(-1); });
    $('nextButton').addEventListener('click', function () { nextTrack(1); });
    $('progressRange').addEventListener('input', onProgressInput);
    $('volumeRange').value = localStorage.getItem(STORAGE.volume) || '0.72';
    audio.volume = Number($('volumeRange').value);
    $('volumeRange').addEventListener('input', function () { audio.volume = Number(this.value); localStorage.setItem(STORAGE.volume, this.value); });
    $('togglePlaylistButton').addEventListener('click', togglePlaylist);
    $('playlistItems').addEventListener('change', function (event) {
      var id = event.target.getAttribute('data-track-toggle');
      if (!id) return;
      var next = event.target.checked ? state.enabledTrackIds.concat(id) : state.enabledTrackIds.filter(function (item) { return item !== id; });
      next = next.filter(function (item, index) { return next.indexOf(item) === index; });
      if (!next.length) { event.target.checked = true; return showToast('至少保留一首歌。'); }
      state.enabledTrackIds = next;
      saveJSON(STORAGE.enabledTracks, next);
      renderTrack();
    });
    $('localAudioInput').addEventListener('change', function (event) {
      Array.from(event.target.files || []).forEach(function (file) {
        if (!file.type.startsWith('audio/')) return;
        var local = { id: 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2), title: file.name.replace(/\.[^/.]+$/, ''), artist: 'local upload', src: URL.createObjectURL(file), lyrics: [] };
        state.tracks.push(local);
        state.enabledTrackIds.push(local.id);
      });
      saveJSON(STORAGE.enabledTracks, state.enabledTrackIds);
      renderPlaylistManager();
      showToast('本地音频已加入当前播放列表。');
      event.target.value = '';
    });
    audio.addEventListener('timeupdate', function () {
      $('currentTime').textContent = formatTime(audio.currentTime);
      $('progressRange').value = audio.duration ? String((audio.currentTime / audio.duration) * 100) : 0;
      $('durationTime').textContent = formatTime(audio.duration || 8);
      updateLyrics();
    });
    audio.addEventListener('ended', function () { nextTrack(1); });
    audio.addEventListener('error', function () { showToast('这首音频暂时无法播放，请切换下一首。'); });
    $('mascotButton').addEventListener('click', function () { handleMascotClick(this); });
    $('sayHelloButton').addEventListener('click', function () { $('mascotButton').click(); $('about').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    $('applyFriendButton').addEventListener('click', function () { resetFriendForm(null); openDialog('friendDialog'); setTimeout(function () { $('friendName').focus(); }, 30); });
    $('friendForm').addEventListener('submit', submitFriend);
    $('friendsGrid').addEventListener('click', function (event) {
      var edit = event.target.getAttribute('data-edit-friend');
      var del = event.target.getAttribute('data-delete-friend');
      if (edit) { var friend = state.friends.find(function (item) { return item.id === edit; }); if (friend) { resetFriendForm(friend); openDialog('friendDialog'); } }
      if (del) deleteFriend(del);
    });
    $('adminButton').addEventListener('click', openAdmin);
    $('adminContent').addEventListener('submit', handleAdminLogin);
    $('adminContent').addEventListener('click', function (event) {
      var editId = event.target.getAttribute('data-admin-edit');
      if (editId) { var friend = state.friends.find(function (item) { return item.id === editId; }); if (friend) { closeDialog('adminDialog'); resetFriendForm(friend); openDialog('friendDialog'); } }
      var approveId = event.target.getAttribute('data-approve-request');
      var rejectId = event.target.getAttribute('data-reject-request');
      if (approveId) handleLocalRequest(approveId, true);
      if (rejectId) handleLocalRequest(rejectId, false);
      if (event.target.id === 'adminOpenPlaylist') { closeDialog('adminDialog'); $('playlistManager').hidden = false; renderPlaylistManager(); $('radio').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      if (event.target.id === 'adminLogout') logoutAdmin();
      var actionTarget = event.target.closest ? event.target.closest('[data-music-action]') : event.target;
      var musicAction = actionTarget && actionTarget.getAttribute('data-music-action');
      if (musicAction) musicAdminAction(musicAction);
    });
    document.querySelectorAll('[data-close]').forEach(function (button) { button.addEventListener('click', function () { closeDialog(button.getAttribute('data-close')); }); });
    document.querySelectorAll('dialog').forEach(function (dialog) { dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDialog(dialog.id); }); });
  }

  function registerWebMCP() {
    var modelContext = document.modelContext;
    if (!modelContext || typeof modelContext.registerTool !== 'function') return;
    var lifecycle = new AbortController();
    try {
      Promise.resolve(modelContext.registerTool({
        name: 'select_radio_track',
        title: 'Select radio track',
        description: 'Select a track in Monika’s local radio and begin playback.',
        inputSchema: {
          type: 'object',
          properties: { trackId: { type: 'string', description: 'The track id shown in the playlist.' } },
          required: ['trackId'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: function (input) {
          var id = String(input && input.trackId || '');
          var nextIndex = state.tracks.findIndex(function (track) { return track.id === id; });
          if (nextIndex < 0) throw new Error('track_not_found');
          state.trackIndex = nextIndex;
          localStorage.setItem(STORAGE.currentTrack, String(nextIndex));
          renderTrack();
          playAudio();
          return { trackId: id, title: currentTrack().title, status: 'playing' };
        }
      }, { signal: lifecycle.signal })).catch(function () {});
      Promise.resolve(modelContext.registerTool({
        name: 'get_friend_links',
        title: 'Read friend links',
        description: 'Return the friend links currently visible in Monika’s friend space.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: function () { return state.friends.map(function (friend) { return { id: friend.id, name: friend.name, intro: friend.intro, url: friend.url }; }); }
      }, { signal: lifecycle.signal })).catch(function () {});
    } catch (error) {}
  }

  setupMascotImage();
  renderTrack();
  renderFriends();
  applyTheme(state.themeMode, { persist: false });
  updateDateTime();
  setInterval(updateDateTime, 30000);
  bindEvents();
  registerWebMCP();
  loadRemoteData();
}());
