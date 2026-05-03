/* =============================================================================
   Onboarding visite guidée — site preview public

   3 bulles concises, ordre = donner envie de visiter d'abord, modifier ensuite :
   1. "C'est votre site de démo, pas encore en ligne pour le grand public"
      → contexte rassurant
   2. "Visitez-le librement, descendez la page" → invite à explorer
   3. "Tout est personnalisable depuis votre espace gérant"
      → CTA finale, dévoile le picto persistant
   ============================================================================= */
(function () {
  'use strict';

  const LS_KEY = 'mqs_preview_onb_v1_done';

  const STEPS = [
    {
      id: 'welcome',
      target: null,
      title: 'Bienvenue 👋',
      text: "Voici votre site de démo, pas encore visible par le grand public. Vous êtes seul à pouvoir le voir pour l'instant.",
      next: 'Suivant →',
    },
    {
      id: 'explore',
      target: null,
      title: 'Faites le tour',
      text: 'Descendez la page pour découvrir comment vos clients verront votre salon : services, photos, avis, contact…',
      next: 'Suivant →',
    },
    {
      id: 'customize',
      target: '.mqs-pre-help-btn',
      title: 'Tout est modifiable',
      text: "Dès maintenant ou après votre achat, vous pouvez personnaliser chaque élément depuis votre espace gérant. Cliquez sur le bouton en bas à droite pour relancer cette visite.",
      next: 'Compris ✓',
      placement: 'top',
    },
  ];

  let state = {
    overlay: null,
    spotlight: null,
    popup: null,
    helpBtn: null,
    currentStep: 0,
    onResize: null,
    onScroll: null,
  };

  function isDone() {
    return localStorage.getItem(LS_KEY) === '1';
  }
  function markDone() {
    localStorage.setItem(LS_KEY, '1');
  }
  function clearDone() {
    localStorage.removeItem(LS_KEY);
  }

  function injectHelpButton() {
    if (document.querySelector('.mqs-pre-help-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'mqs-pre-help-btn';
    btn.type = 'button';
    btn.title = 'Cliquez pour comprendre cette page de démo';
    btn.setAttribute('aria-label', 'Démo — Lancer la visite');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 16v-4"></path>
        <path d="M12 8h.01"></path>
      </svg>
    `;
    btn.addEventListener('click', () => {
      clearDone();
      start();
    });
    document.body.appendChild(btn);
    state.helpBtn = btn;
  }

  function start() {
    if (state.overlay) return;

    state.overlay = document.createElement('div');
    state.overlay.className = 'mqs-pre-overlay';
    state.overlay.setAttribute('role', 'dialog');
    state.overlay.setAttribute('aria-modal', 'true');

    state.spotlight = document.createElement('div');
    state.spotlight.className = 'mqs-pre-spotlight';
    state.overlay.appendChild(state.spotlight);

    state.popup = document.createElement('div');
    state.popup.className = 'mqs-pre-popup';
    state.overlay.appendChild(state.popup);

    document.body.appendChild(state.overlay);
    document.body.style.overflow = 'hidden';

    state.currentStep = 0;
    renderStep();

    state.onResize = () => positionStep();
    state.onScroll = () => positionStep();
    window.addEventListener('resize', state.onResize);
    window.addEventListener('scroll', state.onScroll, true);
  }

  function close() {
    if (state.overlay) state.overlay.remove();
    state.overlay = null;
    state.spotlight = null;
    state.popup = null;
    document.body.style.overflow = '';
    if (state.onResize) window.removeEventListener('resize', state.onResize);
    if (state.onScroll) window.removeEventListener('scroll', state.onScroll, true);
  }

  function finish() {
    markDone();
    close();
  }

  function renderStep() {
    const s = STEPS[state.currentStep];
    if (!s) return finish();

    const total = STEPS.length;
    const stepNum = state.currentStep + 1;

    state.popup.innerHTML = `
      <p class="mqs-pre-popup-step">Étape ${stepNum} / ${total}</p>
      <h3 class="mqs-pre-popup-title">${escapeHtml(s.title)}</h3>
      <p class="mqs-pre-popup-text">${escapeHtml(s.text)}</p>
      <div class="mqs-pre-popup-actions">
        <button type="button" class="mqs-pre-skip">Passer</button>
        <button type="button" class="mqs-pre-next">${escapeHtml(s.next)}</button>
      </div>
    `;
    state.popup.querySelector('.mqs-pre-skip').addEventListener('click', finish);
    state.popup.querySelector('.mqs-pre-next').addEventListener('click', () => {
      state.currentStep++;
      if (state.currentStep >= STEPS.length) finish();
      else renderStep();
    });

    positionStep();
  }

  function positionStep() {
    const s = STEPS[state.currentStep];
    if (!s || !state.spotlight || !state.popup) return;

    if (!s.target) {
      state.spotlight.classList.add('mqs-pre-center');
      state.spotlight.style.left = '50%';
      state.spotlight.style.top = '50%';
      state.spotlight.style.width = '0px';
      state.spotlight.style.height = '0px';
      const pw = state.popup.offsetWidth;
      const ph = state.popup.offsetHeight;
      state.popup.style.left = `${(window.innerWidth - pw) / 2}px`;
      state.popup.style.top = `${(window.innerHeight - ph) / 2}px`;
      return;
    }

    state.spotlight.classList.remove('mqs-pre-center');
    const el = document.querySelector(s.target);
    if (!el) {
      state.spotlight.classList.add('mqs-pre-center');
      const pw = state.popup.offsetWidth;
      const ph = state.popup.offsetHeight;
      state.popup.style.left = `${(window.innerWidth - pw) / 2}px`;
      state.popup.style.top = `${(window.innerHeight - ph) / 2}px`;
      return;
    }

    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const rect = el.getBoundingClientRect();
    const padding = 8;

    state.spotlight.style.left = `${rect.left - padding}px`;
    state.spotlight.style.top = `${rect.top - padding}px`;
    state.spotlight.style.width = `${rect.width + padding * 2}px`;
    state.spotlight.style.height = `${rect.height + padding * 2}px`;

    const pw = state.popup.offsetWidth || 340;
    const ph = state.popup.offsetHeight || 180;
    const margin = 20;
    const isNarrow = window.innerWidth < 1024;
    const placement = (isNarrow && s.placementMobile) ? s.placementMobile : (s.placement || 'bottom');
    let popupLeft, popupTop;

    switch (placement) {
      case 'right':
        popupLeft = rect.right + margin;
        popupTop = rect.top + rect.height / 2 - ph / 2;
        if (popupLeft + pw > window.innerWidth - 16) popupLeft = rect.left - pw - margin;
        break;
      case 'top':
        popupLeft = rect.left + rect.width / 2 - pw / 2;
        popupTop = rect.top - ph - margin;
        if (popupTop < 16) popupTop = rect.bottom + margin;
        break;
      case 'bottom':
      default:
        popupLeft = rect.left + rect.width / 2 - pw / 2;
        popupTop = rect.bottom + margin;
        if (popupTop + ph > window.innerHeight - 16) popupTop = rect.top - ph - margin;
        break;
    }

    popupLeft = Math.max(16, Math.min(popupLeft, window.innerWidth - pw - 16));
    popupTop = Math.max(16, Math.min(popupTop, window.innerHeight - ph - 16));

    state.popup.style.left = `${popupLeft}px`;
    state.popup.style.top = `${popupTop}px`;
  }

  function escapeHtml(s) {
    return s == null ? '' : String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function init() {
    // On n'affiche le tour QUE sur les pages /preview/{slug} (pas la home, pas /admin etc.)
    if (!/^\/preview\//.test(window.location.pathname)) return;
    injectHelpButton();
    if (!isDone()) {
      setTimeout(start, 800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.mqsPreviewOnboarding = { start, finish, clearDone };
})();
