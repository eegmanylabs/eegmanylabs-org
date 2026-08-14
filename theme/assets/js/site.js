(() => {
  const heroVideo = document.querySelector('.home-hero__media video');

  if (heroVideo) {
    const playHeroVideo = () => {
      heroVideo.muted = true;
      heroVideo.playsInline = true;
      heroVideo.play().catch(() => {});
    };

    if (heroVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      playHeroVideo();
    } else {
      heroVideo.addEventListener('loadeddata', playHeroVideo, { once: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) playHeroVideo();
    });
  }

  const menu = document.querySelector('[data-mobile-menu]');
  const toggle = document.querySelector('[data-menu-toggle]');
  const closeButton = document.querySelector('[data-menu-close]');

  if (!menu || !toggle || !closeButton) return;

  const setMenuState = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    if (open) {
      closeButton.focus();
    } else {
      toggle.focus();
    }
  };

  toggle.addEventListener('click', () => setMenuState(menu.hidden));
  closeButton.addEventListener('click', () => setMenuState(false));

  menu.addEventListener('click', (event) => {
    if (event.target === menu) setMenuState(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) setMenuState(false);
  });
})();
