(function () {
  'use strict';

  var STORAGE = {
    volume: 'monika-desk-volume',
    currentTrack: 'monika-desk-current-track',
    enabledTracks: 'monika-desk-enabled-tracks',
    friends: 'monika-desk-friends',
    localRequests: 'monika-desk-friend-requests',
    admin: 'monika-desk-admin',
    theme: 'monika-desk-theme'
  };

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
    friendApi: null,
    musicApi: false,
    admin: null,
    currentLyric: -1,
    localTracks: []
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
  }

  function applyTheme(theme) {
    var nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    try { localStorage.setItem(STORAGE.theme, nextTheme); } catch (error) {}
    var icon = $('themeIcon');
    var label = $('themeLabel');
    var toggle = $('themeToggle');
    if (icon) icon.textContent = nextTheme === 'dark' ? '☀' : '☾';
    if (label) label.textContent = nextTheme === 'dark' ? 'light' : 'dark';
    if (toggle) {
      toggle.setAttribute('aria-pressed', nextTheme === 'dark' ? 'true' : 'false');
      toggle.setAttribute('aria-label', nextTheme === 'dark' ? '切换到浅色模式' : '切换到暗色模式');
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
      if (Array.isArray(music.tracks) && music.tracks.length) {
        state.tracks = music.tracks.map(function (track) {
          return Object.assign({}, track, { src: track.stream || track.src, lyrics: track.lyrics || [] });
        });
        state.enabledTrackIds = state.tracks.map(function (track) { return track.id; });
        state.trackIndex = 0;
        state.musicApi = true;
        renderTrack();
      }
    } catch (error) {}
  }

  function openDialog(id) {
    var dialog = $(id);
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
        showToast('申请已提交，欢迎来坐一会儿。');
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
      closeDialog('friendDialog');
      showToast('后端未连接，申请已暂存于本机。');
    }
  }

  async function openAdmin() {
    openDialog('adminDialog');
    if (state.admin) { renderAdminPanel(); return; }
    try {
      var session = await apiRequest('/api/friends/session', { headers: {} });
      if (session.authenticated) {
        state.admin = { user: session.user || 'admin' };
        saveJSON(STORAGE.admin, state.admin);
        renderAdminPanel();
      }
    } catch (error) {}
  }

  function renderAdminPanel() {
    var remoteStatus = state.friendApi ? '已连接友链 API' : '本地预览模式';
    var pending = readJSON(STORAGE.localRequests, []);
    var pendingMarkup = pending.length ? '<div class="admin-summary-card"><b>本地待审核申请</b><div class="admin-list">' + pending.map(function (request) { return '<div class="friend-card"><span class="friend-avatar">' + escapeHTML((request.name || '?').slice(0, 1)) + '</span><span class="friend-copy"><strong>' + escapeHTML(request.name) + '</strong><small>' + escapeHTML(request.url) + '</small></span><div class="admin-actions"><button type="button" data-approve-request="' + escapeHTML(request.id) + '">通过</button><button type="button" data-reject-request="' + escapeHTML(request.id) + '">拒绝</button></div></div>'; }).join('') + '</div></div>' : '';
    $('adminContent').innerHTML = '<div class="admin-summary"><div class="admin-summary-card">当前状态：<b>' + escapeHTML(remoteStatus) + '</b></div><div class="admin-summary-card">友链数量：<b>' + state.friends.length + '</b>　音乐：<b>' + (state.musicApi ? '云端歌单' : '本地歌单') + '</b><button type="button" class="admin-open-playlist" id="adminOpenPlaylist">管理播放列表 →</button></div>' + pendingMarkup + '</div><div class="admin-list">' + state.friends.map(function (friend) { return '<div class="friend-card"><span class="friend-avatar">' + escapeHTML((friend.name || '?').slice(0, 1)) + '</span><span class="friend-copy"><strong>' + escapeHTML(friend.name) + '</strong><small>' + escapeHTML(friend.url) + '</small></span><button class="friend-open" type="button" data-admin-edit="' + escapeHTML(friend.id) + '">✎</button></div>'; }).join('') + '</div><button class="admin-logout" type="button" id="adminLogout">退出管理台</button>';
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

  async function handleAdminLogin(event) {
    event.preventDefault();
    var box = $('adminFormError');
    box.textContent = '';
    try {
      var result = await apiRequest('/api/friends/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ username: $('adminUsername').value.trim(), password: $('adminPassword').value }) });
      state.admin = { user: result.user || $('adminUsername').value.trim() };
      saveJSON(STORAGE.admin, state.admin);
      renderAdminPanel();
      showToast('欢迎回来，站长。');
    } catch (error) {
      box.textContent = state.friendApi === false ? '本地预览没有可用的管理员 API。' : (error.message || '登录失败。');
    }
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

  function bindEvents() {
    $('themeToggle').addEventListener('click', function () {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
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
    $('mascotButton').addEventListener('click', function () {
      var messages = ['你来啦。', '今天也辛苦了。', '要不要听首歌？', '这里留给你。'];
      var bubble = $('mascotBubble');
      bubble.textContent = messages[Math.floor(Math.random() * messages.length)];
      this.classList.remove('mascot-bounce');
      void this.offsetWidth;
      this.classList.add('mascot-bounce');
    });
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
      if (event.target.id === 'adminLogout') { state.admin = null; localStorage.removeItem(STORAGE.admin); renderFriends(); openAdmin(); }
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

  renderTrack();
  renderFriends();
  applyTheme(document.documentElement.dataset.theme || 'light');
  updateDateTime();
  setInterval(updateDateTime, 30000);
  bindEvents();
  registerWebMCP();
  loadRemoteData();
}());
