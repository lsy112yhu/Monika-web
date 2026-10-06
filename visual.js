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
})();
