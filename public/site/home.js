/* =============================================================================
   home.js — Logique de la landing MONSITEHQ.

   - Tous les boutons "Voir si mon salon..." ouvrent la même modale
   - Modale en 3 étapes : input → loading → résultat (found / notfound)
   - POST /api/landing/check avec google_maps_url + email
   - Animation scroll-driven dans le hero (10 frames jouées 1→10→1 selon scroll)
   ============================================================================= */
(function () {
  'use strict';

  // ===========================================================================
  // ANIMATION SCROLL-DRIVEN (hero)
  // 10 frames préchargées, jouées en triangle wave selon la position de scroll
  // dans le hero : 0%→50% du hero = frame 1→10, 50%→100% = frame 10→1.
  // Respecte prefers-reduced-motion (frame 1 statique).
  // Désactivée sur mobile (image cachée par le CSS).
  // ===========================================================================
  (function setupHeroAnime() {
    const animeImg = document.getElementById('hp-anime-img');
    if (!animeImg) return;

    // Liste des frames disponibles (numéros impairs : 001, 003, …, 019)
    const FRAME_NAMES = ['001','003','005','007','009','011','013','015','017','019'];
    const FRAMES_COUNT = FRAME_NAMES.length;

    // Si l'utilisateur a activé "Reduce motion" système, on garde la frame 1
    // statique et on n'active pas l'effet scroll-driven (WCAG 2.1).
    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    // Désactivée si CSS cache l'image (mobile <900px) — on évite d'utiliser des
    // ressources réseau et des cycles CPU pour rien.
    const isHidden = () => getComputedStyle(animeImg.parentElement).display === 'none';

    // Préchargement : on télécharge les 10 frames immédiatement (≈235 KB total
    // en WebP). Les URLs résolues sont conservées pour pouvoir swap instantanément.
    const frameUrls = FRAME_NAMES.map(n => `/_assets/landing/anime/logo-${n}.webp`);
    const preloaded = frameUrls.map(url => {
      const img = new Image();
      img.src = url;
      return img;
    });

    let currentFrame = 0;
    let rafScheduled = false;

    function setFrame(idx) {
      if (idx === currentFrame) return;
      currentFrame = idx;
      animeImg.src = frameUrls[idx];
    }

    function update() {
      rafScheduled = false;
      if (isHidden()) return;

      const hero = document.querySelector('.hp-hero');
      if (!hero) return;
      const heroH = hero.offsetHeight;
      if (heroH <= 0) return;

      // Progress 0 → 1 sur la hauteur du hero (clampé)
      const scrollY = window.scrollY || window.pageYOffset || 0;
      const progress = Math.max(0, Math.min(1, scrollY / heroH));

      // Triangle wave : 0→0.5 = aller (0→1), 0.5→1 = retour (1→0)
      const triangle = progress < 0.5 ? progress * 2 : (1 - progress) * 2;

      // Map vers index frame [0, FRAMES_COUNT-1]
      const idx = Math.round(triangle * (FRAMES_COUNT - 1));
      setFrame(idx);
    }

    function onScroll() {
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(update);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Initial render après load (ensure hero height is known)
    if (document.readyState === 'complete') update();
    else window.addEventListener('load', update, { once: true });
  })();


  const $ = (id) => document.getElementById(id);

  // === État ===
  let opened = false;

  // === Refs ===
  const modal = $('hp-modal');
  const modalClose = $('hp-modal-close');
  const form = $('hp-form');
  const inputUrl = $('hp-input-url');
  const inputEmail = $('hp-input-email');
  const submitBtn = $('hp-submit');
  const formError = $('hp-form-error');
  const stepInput = modal.querySelector('[data-step="input"]');
  const stepLoading = modal.querySelector('[data-step="loading"]');
  const stepFound = modal.querySelector('[data-step="found"]');
  const stepNotFound = modal.querySelector('[data-step="notfound"]');
  const foundTitle = $('hp-found-title');
  const foundMsg = $('hp-found-msg');
  const foundLink = $('hp-found-link');
  const notFoundClose = $('hp-notfound-close');

  // === Open / Close ===
  function openModal() {
    if (opened) return;
    opened = true;
    modal.hidden = false;
    showStep('input');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add('hp-modal-open'));
    });
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onEsc);
    setTimeout(() => inputUrl?.focus(), 250);
  }

  function closeModal() {
    if (!opened) return;
    opened = false;
    modal.classList.remove('hp-modal-open');
    document.removeEventListener('keydown', onEsc);
    document.body.style.overflow = '';
    setTimeout(() => {
      modal.hidden = true;
      // Reset form
      form.reset();
      formError.hidden = true;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Rechercher mon salon';
      showStep('input');
    }, 280);
  }

  function onEsc(e) { if (e.key === 'Escape') closeModal(); }

  // === Step navigation ===
  function showStep(name) {
    [stepInput, stepLoading, stepFound, stepNotFound].forEach(el => {
      el.hidden = el.dataset.step !== name;
    });
  }

  // === Form submit ===
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const googleUrl = (inputUrl.value || '').trim();
    const email = (inputEmail.value || '').trim().toLowerCase();

    // Validation client-side basique (server-side fait le vrai check)
    if (!googleUrl) {
      return showError('Collez le lien Google Maps de votre salon.');
    }
    if (!/google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs/i.test(googleUrl)) {
      return showError('Ce lien ne semble pas venir de Google Maps. Suivez le mini-tuto ci-dessus.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return showError('Entrez une adresse e-mail valide.');
    }

    formError.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '…';
    showStep('loading');

    try {
      const res = await fetch('/api/landing/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_maps_url: googleUrl, email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showStep('input');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Rechercher mon salon';
        return showError(data.error || 'Une erreur est survenue. Réessayez dans quelques minutes.');
      }

      if (data.found) {
        // Salon trouvé : affiche le bouton Visiter
        const ville = data.ville ? ` à ${data.ville}` : '';
        foundTitle.textContent = `${data.salon_name || 'Votre salon'}${ville}`;
        foundMsg.textContent = data.message || 'Votre site démo est prêt.';
        foundLink.href = data.demo_url;
        showStep('found');
      } else {
        // Pas trouvé : ajout à la waitlist
        showStep('notfound');
      }
    } catch (err) {
      console.error(err);
      showStep('input');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Rechercher mon salon';
      showError('Erreur réseau. Vérifiez votre connexion et réessayez.');
    }
  });

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  // === Wire-up des CTAs ===
  ['hp-cta-nav', 'hp-cta-hero', 'hp-cta-coverage', 'hp-cta-pricing'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('click', openModal);
  });

  modalClose.addEventListener('click', closeModal);
  notFoundClose.addEventListener('click', closeModal);

  // Backdrop click
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // Auto-focus input lorsqu'on ouvre les 4 CTAs
})();
