(() => {
  const navLinks = [...document.querySelectorAll('.topnav a[href^="#"]')];
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const setActiveNav = (id) => {
    navLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };

  if (sections.length && 'IntersectionObserver' in window) {
    const navObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveNav(visible.target.id);
    }, { rootMargin: '-18% 0px -58% 0px', threshold: [0.08, 0.2, 0.45] });
    sections.forEach((section) => navObserver.observe(section));
  } else if (sections[0]) {
    setActiveNav(sections[0].id);
  }

  const revealItems = document.querySelectorAll('.page-grid > .card, .quick-strip, .toolbox-card');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealItems.forEach((item) => item.classList.add('reveal-ready'));
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealItems.forEach((item) => revealObserver.observe(item));
  }

  const audio = document.getElementById('audioElement');
  const radio = document.getElementById('radio');
  if (audio && radio) {
    const syncPlaybackVisual = () => radio.classList.toggle('is-playing', !audio.paused && !audio.ended);
    ['play', 'playing', 'pause', 'ended', 'emptied'].forEach((eventName) => {
      audio.addEventListener(eventName, syncPlaybackVisual);
    });
    syncPlaybackVisual();
  }

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = './enhancements.css';
  document.head.appendChild(styleLink);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  // Issue #7: dark-mode desk lamp glow. The layer never intercepts pointer events,
  // updates at most once per animation frame, and is disabled for touch/reduced motion.
  const lampGlow = document.createElement('div');
  lampGlow.className = 'desk-lamp-glow';
  lampGlow.setAttribute('aria-hidden', 'true');
  document.body.appendChild(lampGlow);

  let lampFrame = 0;
  let pointerX = window.innerWidth * 0.7;
  let pointerY = window.innerHeight * 0.25;

  const lampEnabled = () =>
    document.documentElement.dataset.theme === 'dark' &&
    finePointer.matches &&
    !reducedMotion.matches;

  const syncLampState = () => {
    lampGlow.hidden = !lampEnabled();
  };

  const paintLamp = () => {
    lampFrame = 0;
    lampGlow.style.setProperty('--lamp-x', `${pointerX}px`);
    lampGlow.style.setProperty('--lamp-y', `${pointerY}px`);
  };

  document.addEventListener('pointermove', (event) => {
    if (!lampEnabled() || event.pointerType === 'touch') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!lampFrame) lampFrame = requestAnimationFrame(paintLamp);
  }, { passive: true });

  new MutationObserver(syncLampState).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
  [reducedMotion, finePointer].forEach((query) => {
    if (typeof query.addEventListener === 'function') query.addEventListener('change', syncLampState);
    else if (typeof query.addListener === 'function') query.addListener(syncLampState);
  });
  paintLamp();
  syncLampState();

  // Issue #8: shared whisper board beside the friend space.
  const WHISPER_KEY = 'monika-desk-whispers';
  const WHISPER_ENDPOINT = '/api/whispers';
  const MAX_WHISPERS = 24;
  let whisperApiAvailable = null;
  let whisperItems = [];

  const isValidWhisper = (item) =>
    Boolean(item) &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.nickname === 'string' &&
    item.nickname.trim().length > 0 &&
    typeof item.message === 'string' &&
    item.message.trim().length > 0;

  const normalizeWhispers = (items) =>
    (Array.isArray(items) ? items : []).filter(isValidWhisper).slice(0, MAX_WHISPERS);

  const readLocalWhispers = () => {
    try {
      return normalizeWhispers(JSON.parse(localStorage.getItem(WHISPER_KEY) || '[]'));
    } catch (error) {
      return [];
    }
  };

  const writeLocalWhispers = (items) => {
    try {
      localStorage.setItem(WHISPER_KEY, JSON.stringify(normalizeWhispers(items)));
      return true;
    } catch (error) {
      return false;
    }
  };

  const hasVerifiedAdminSession = () => Boolean(document.getElementById('adminLogout'));

  const board = document.createElement('section');
  board.className = 'whisper-board';
  board.setAttribute('aria-labelledby', 'whisperTitle');

  const boardHead = document.createElement('div');
  boardHead.className = 'whisper-head';

  const boardHeading = document.createElement('div');
  const boardKicker = document.createElement('span');
  boardKicker.className = 'whisper-kicker';
  boardKicker.textContent = 'WHISPER NOTES';
  const boardTitle = document.createElement('h2');
  boardTitle.id = 'whisperTitle';
  boardTitle.textContent = '给桌边留一句悄悄话';
  const boardHint = document.createElement('p');
  boardHint.textContent = '正在读取云端留言……';
  boardHeading.append(boardKicker, boardTitle, boardHint);

  const boardBadge = document.createElement('span');
  boardBadge.className = 'whisper-local-badge is-syncing';
  boardBadge.textContent = 'syncing';
  boardHead.append(boardHeading, boardBadge);

  const whisperForm = document.createElement('form');
  whisperForm.className = 'whisper-form';
  whisperForm.noValidate = true;

  const nicknameLabel = document.createElement('label');
  nicknameLabel.textContent = '昵称';
  const nicknameInput = document.createElement('input');
  nicknameInput.name = 'nickname';
  nicknameInput.maxLength = 18;
  nicknameInput.required = true;
  nicknameInput.autocomplete = 'nickname';
  nicknameInput.placeholder = '怎么称呼你？';
  nicknameLabel.appendChild(nicknameInput);

  const messageLabel = document.createElement('label');
  messageLabel.textContent = '一句话';
  const messageInput = document.createElement('input');
  messageInput.name = 'message';
  messageInput.maxLength = 80;
  messageInput.required = true;
  messageInput.placeholder = '今天想在这里留下什么？';
  messageLabel.appendChild(messageInput);

  const submitWhisper = document.createElement('button');
  submitWhisper.type = 'submit';
  submitWhisper.className = 'whisper-submit';
  submitWhisper.textContent = '贴上纸条 ↗';

  const whisperStatus = document.createElement('p');
  whisperStatus.className = 'whisper-status';
  whisperStatus.setAttribute('role', 'status');
  whisperStatus.setAttribute('aria-live', 'polite');

  whisperForm.append(nicknameLabel, messageLabel, submitWhisper);

  const whisperList = document.createElement('div');
  whisperList.className = 'whisper-list';
  whisperList.setAttribute('aria-live', 'polite');

  board.append(boardHead, whisperForm, whisperStatus, whisperList);

  const friendsSection = document.getElementById('friends');
  if (friendsSection && friendsSection.parentNode) {
    const notebookSection = friendsSection.parentNode.querySelector('.notebook-card');
    if (notebookSection) notebookSection.insertAdjacentElement('afterend', board);
    else friendsSection.insertAdjacentElement('afterend', board);
  }

  const setWhisperConnectionState = (mode) => {
    const shared = mode === 'shared';
    const local = mode === 'local';
    boardBadge.textContent = shared ? 'shared' : local ? 'local preview' : 'syncing';
    boardBadge.classList.toggle('is-shared', shared);
    boardBadge.classList.toggle('is-syncing', mode === 'syncing');
    boardHint.textContent = shared
      ? '留言会保存到云端，所有访客都能看到。'
      : local
        ? '当前未连接后端，留言只会保存在这台设备。'
        : '正在读取云端留言……';
  };

  const requestWhispers = async (options = {}) => {
    const response = await fetch(WHISPER_ENDPOINT, {
      credentials: 'include',
      ...options,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...(options.headers || {})
      }
    });
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok) {
      const failure = new Error(data.message || data.error || ('HTTP ' + response.status));
      failure.status = response.status;
      throw failure;
    }
    return data;
  };

  const whisperDate = (timestamp) => {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  };

  const formatWhisperDate = (timestamp) => {
    try {
      return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(whisperDate(timestamp));
    } catch (error) {
      return '';
    }
  };

  const renderWhispers = () => {
    if (!whisperList) return;
    whisperList.replaceChildren();
    const items = normalizeWhispers(whisperItems);
    const admin = hasVerifiedAdminSession();

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'whisper-empty';
      empty.textContent = whisperApiAvailable === false
        ? '后端暂时不可用；连接后，第一句云端留言可以从这里开始。'
        : '还没有纸条。第一句悄悄话可以从这里开始。';
      whisperList.appendChild(empty);
      return;
    }

    items.forEach((item, index) => {
      const note = document.createElement('article');
      note.className = 'whisper-note whisper-note-' + ((index % 3) + 1);

      const meta = document.createElement('div');
      meta.className = 'whisper-note-meta';
      const author = document.createElement('strong');
      author.textContent = item.nickname.slice(0, 18);
      const dateValue = whisperDate(item.createdAt || Date.now());
      const date = document.createElement('time');
      date.dateTime = dateValue.toISOString();
      date.textContent = formatWhisperDate(dateValue);
      meta.append(author, date);

      const text = document.createElement('p');
      text.textContent = item.message.slice(0, 80);
      note.append(meta, text);

      if (admin) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'whisper-delete';
        remove.dataset.whisperDelete = item.id;
        remove.setAttribute('aria-label', '删除 ' + author.textContent + ' 的留言');
        remove.textContent = '×';
        note.appendChild(remove);
      }

      whisperList.appendChild(note);
    });
  };

  const refreshWhispers = async ({ silent = false } = {}) => {
    setWhisperConnectionState('syncing');
    try {
      const data = await requestWhispers();
      whisperItems = normalizeWhispers(data.whispers);
      whisperApiAvailable = true;
      setWhisperConnectionState('shared');
      renderWhispers();
      return true;
    } catch (error) {
      whisperApiAvailable = false;
      whisperItems = readLocalWhispers();
      setWhisperConnectionState('local');
      renderWhispers();
      if (!silent) whisperStatus.textContent = '当前使用本地预览，留言不会同步给其他访客。';
      return false;
    }
  };

  whisperForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nickname = nicknameInput.value.trim();
    const message = messageInput.value.trim();
    if (!nickname || !message) {
      whisperStatus.textContent = '昵称和悄悄话都要写一点哦。';
      return;
    }

    const payload = {
      nickname: nickname.slice(0, 18),
      message: message.slice(0, 80)
    };
    submitWhisper.disabled = true;
    whisperStatus.textContent = '正在贴到留言板……';

    try {
      const data = await requestWhispers({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      whisperItems = normalizeWhispers(data.whispers || (data.whisper ? [data.whisper, ...whisperItems] : whisperItems));
      whisperApiAvailable = true;
      setWhisperConnectionState('shared');
      whisperForm.reset();
      whisperStatus.textContent = '纸条已贴好，所有访客都能看到。';
      renderWhispers();
    } catch (error) {
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 404) {
        whisperApiAvailable = true;
        setWhisperConnectionState('shared');
        whisperStatus.textContent = error.message || '留言没有提交成功，请稍后再试。';
      } else {
        const localItem = {
          id: 'whisper-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8),
          nickname: payload.nickname,
          message: payload.message,
          createdAt: Date.now()
        };
        const localItems = [localItem, ...readLocalWhispers()];
        whisperApiAvailable = false;
        whisperItems = localItems;
        setWhisperConnectionState('local');
        whisperStatus.textContent = writeLocalWhispers(localItems)
          ? '后端暂时不可用，纸条只保存在这台设备。'
          : '这台设备暂时无法保存纸条。';
        renderWhispers();
      }
    } finally {
      submitWhisper.disabled = false;
    }
  });

  whisperList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-whisper-delete]');
    if (!button || !hasVerifiedAdminSession()) return;
    const id = button.dataset.whisperDelete;

    if (whisperApiAvailable) {
      try {
        const response = await fetch(WHISPER_ENDPOINT + '/' + encodeURIComponent(id), {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        let data = {};
        try {
          data = await response.json();
        } catch (error) {
          data = {};
        }
        if (!response.ok) {
          const failure = new Error(data.message || data.error || ('HTTP ' + response.status));
          failure.status = response.status;
          throw failure;
        }
        whisperItems = normalizeWhispers(data.whispers);
        whisperStatus.textContent = '云端留言已移除。';
        renderWhispers();
        return;
      } catch (error) {
        if (error.status && error.status !== 404 && error.status !== 405) {
          whisperStatus.textContent = error.message || '留言删除失败。';
          return;
        }
        whisperApiAvailable = false;
        setWhisperConnectionState('local');
      }
    }

    const nextItems = readLocalWhispers().filter((item) => item.id !== id);
    if (writeLocalWhispers(nextItems)) {
      whisperItems = nextItems;
      whisperStatus.textContent = '这张本地纸条已移除。';
      renderWhispers();
    }
  });

  const adminContent = document.getElementById('adminContent');
  if (adminContent) {
    new MutationObserver(renderWhispers).observe(adminContent, { childList: true, subtree: true });
  }
  window.addEventListener('storage', (event) => {
    if (event.key === WHISPER_KEY && whisperApiAvailable !== true) {
      whisperItems = readLocalWhispers();
      renderWhispers();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshWhispers({ silent: true });
  });
  window.setInterval(() => refreshWhispers({ silent: true }), 60_000);

  renderWhispers();
  refreshWhispers({ silent: true });
})();
