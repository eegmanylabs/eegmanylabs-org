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

    ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough'].forEach((eventName) => {
      heroVideo.addEventListener(eventName, playHeroVideo);
    });
    heroVideo.addEventListener('ended', () => {
      heroVideo.currentTime = 0;
      playHeroVideo();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) playHeroVideo();
    });
    window.addEventListener('pageshow', playHeroVideo);
    window.addEventListener('focus', playHeroVideo);
    window.setTimeout(playHeroVideo, 250);
    window.setTimeout(playHeroVideo, 1200);
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
    const target = filterRoot.dataset.filterTarget || '[data-filter-card]';
    const cards = [...document.querySelectorAll(target)];
    const status = document.createElement('p');
    status.className = 'sr-only';
    status.setAttribute('aria-live', 'polite');
    filterRoot.append(status);
    const activeFilters = {};
    const filterKeys = [...new Set([...filterRoot.querySelectorAll('[data-filter-key]')].map((chip) => chip.dataset.filterKey))];

    filterKeys.forEach((key) => { activeFilters[key] = ''; });

    const getCardValues = (card, key) => (card.dataset[key] || '').split(/\s+/).filter(Boolean);

    const updateDisplay = () => {
      cards.forEach((card) => {
        const matches = filterKeys.every((key) => {
          const selected = activeFilters[key];
          return !selected || getCardValues(card, key).includes(selected);
        });
        card.classList.toggle('is-filtered-out', !matches);
        card.hidden = !matches;
        card.setAttribute('aria-hidden', String(!matches));
      });
      const visibleCount = cards.filter((card) => !card.hidden).length;
      status.textContent = `${visibleCount} ${visibleCount === 1 ? 'item is' : 'items are'} shown.`;
    };

    filterRoot.querySelectorAll('[data-filter-key]').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.classList.contains('is-active')));
      chip.addEventListener('click', () => {
        const key = chip.dataset.filterKey;
        const value = chip.dataset.filterValue || '';
        activeFilters[key] = value;
        filterRoot.querySelectorAll(`[data-filter-key="${key}"]`).forEach((control) => {
          const isActive = control === chip;
          control.classList.toggle('is-active', isActive);
          control.setAttribute('aria-pressed', String(isActive));
        });
        updateDisplay();
      });
    });

    updateDisplay();
  });

  const menu = document.querySelector('[data-mobile-menu]');
  const toggle = document.querySelector('[data-menu-toggle]');
  const closeButton = document.querySelector('[data-menu-close]');

  if (menu && toggle && closeButton) {
    let previouslyFocused = null;
    const getFocusableControls = () => [...menu.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden);
    const setMenuState = (open) => {
      if (open) {
        previouslyFocused = document.activeElement;
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        document.body.classList.add('menu-open');
        closeButton.focus();
        return;
      }
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('menu-open');
      (previouslyFocused || toggle).focus();
      previouslyFocused = null;
    };
    toggle.addEventListener('click', () => setMenuState(menu.hidden));
    closeButton.addEventListener('click', () => setMenuState(false));
    menu.addEventListener('click', (event) => { if (event.target === menu) setMenuState(false); });
    document.addEventListener('keydown', (event) => {
      if (menu.hidden) return;
      if (event.key === 'Escape') {
        setMenuState(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusableControls = getFocusableControls();
      const firstControl = focusableControls[0];
      const lastControl = focusableControls[focusableControls.length - 1];
      if (!firstControl || !lastControl) return;
      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    });
  }
})();
