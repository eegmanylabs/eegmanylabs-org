(() => {
  const heroVideo = document.querySelector('.home-hero__media video');

  if (heroVideo) {
    const playHeroVideo = () => {
      heroVideo.controls = false;
      heroVideo.removeAttribute('controls');
      heroVideo.autoplay = true;
      heroVideo.loop = true;
      heroVideo.defaultMuted = true;
      heroVideo.muted = true;
      heroVideo.setAttribute('muted', '');
      heroVideo.playsInline = true;
      heroVideo.setAttribute('playsinline', '');
      heroVideo.setAttribute('webkit-playsinline', '');
      const playback = heroVideo.play();
      if (playback) playback.catch(() => {});
    };

    heroVideo.addEventListener('canplay', playHeroVideo);
    heroVideo.addEventListener('loadedmetadata', playHeroVideo);
    heroVideo.addEventListener('ended', () => {
      heroVideo.currentTime = 0;
      playHeroVideo();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) playHeroVideo();
    });
    window.addEventListener('pageshow', playHeroVideo);
    window.setInterval(() => {
      if (!document.hidden && heroVideo.paused) playHeroVideo();
    }, 1500);
    playHeroVideo();
  }

  const contactForm = document.querySelector('[data-contact-form]');
  if (contactForm) {
    const contactStatus = contactForm.querySelector('[data-contact-status]');
    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = new FormData(contactForm);
      const subject = values.get('subject').trim();
      const body = `Name: ${values.get('name').trim()}\nEmail: ${values.get('email').trim()}\n\n${values.get('message').trim()}`;
      if (contactStatus) contactStatus.textContent = 'Opening your email application…';
      window.location.href = `mailto:contact@eegmanylabs.org?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }

  document.querySelectorAll('[data-chip-filters]').forEach((filterRoot) => {
    const cards = [...document.querySelectorAll(filterRoot.dataset.filterTarget)];
    const selected = {};
    const applyFilters = () => {
      cards.forEach((card) => {
        const matches = Object.values(selected).every((term) => !term || card.classList.contains(term));
        card.hidden = !matches;
      });
    };
    filterRoot.querySelectorAll('[data-filter-key]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.filterKey;
        const value = chip.dataset.filterValue;
        selected[key] = value;
        filterRoot.querySelectorAll(`[data-filter-key="${key}"]`).forEach((control) => {
          control.classList.toggle('is-active', control === chip);
        });
        applyFilters();
      });
    });
  });

  const menu = document.querySelector('[data-mobile-menu]');
  const toggle = document.querySelector('[data-menu-toggle]');
  const closeButton = document.querySelector('[data-menu-close]');

  if (menu && toggle && closeButton) {
    const setMenuState = (open) => {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('menu-open', open);
      if (open) closeButton.focus(); else toggle.focus();
    };
    toggle.addEventListener('click', () => setMenuState(menu.hidden));
    closeButton.addEventListener('click', () => setMenuState(false));
    menu.addEventListener('click', (event) => { if (event.target === menu) setMenuState(false); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) setMenuState(false); });
  }
})();
