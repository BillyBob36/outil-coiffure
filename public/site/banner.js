/* =============================================================================
   Banner MaQuickPage — TOP RIBBON + BOTTOM BAR + PILL collapsed
   Design adapté de "Sitely CTA combo" → vanilla JS.

   Comportement :
     - Sur /preview/{slug} :
         INVISIBLE tant que le user n'a pas scrollé jusqu'à .intro
         Trigger : mouseenter desktop OU IntersectionObserver ≥ 30% mobile
         Attend la fermeture de l'onboarding si actif
     - Sur /admin/{slug} :
         VISIBLE immédiatement
     - Closeable (bottom bar) → collapse en pill. Click pill → ré-ouvre.
     - N'apparaît PAS si :
         - URL ?nocapture=1 (Puppeteer screenshots)
         - URL ?banner=off (dev)
         - Host = custom (= site coiffeur payé, Falkenstein)
     - CTA → ouvre la modal pricing via window.MqsPricingModal.open()
   ============================================================================= */

(function () {
  'use strict';

  // === Détection contexte ===
  const params = new URLSearchParams(window.location.search);
  if (params.has('nocapture') || params.get('banner') === 'off') return;

  const path = window.location.pathname;
  const isPreview = path.indexOf('/preview/') === 0;
  const isAdmin = path.indexOf('/admin/') === 0;
  if (!isPreview && !isAdmin) return;

  const host = window.location.hostname;
  const isDemoHost = host === 'maquickpage.fr' || host === 'localhost' || host === '127.0.0.1';
  if (!isDemoHost) return;

  const REAPPEAR_AFTER_MS = 5000;

  let mounted = false;
  let collapsed = false;

  // Helpers
  function openPricingModal() {
    if (typeof window.MqsPricingModal === 'object' && window.MqsPricingModal.open) {
      window.MqsPricingModal.open();
    } else {
      console.warn('[mqs-banner] MqsPricingModal not loaded');
    }
  }

  // Récupère le nom du salon depuis le DOM (id="hero-title") pour personnaliser
  // le texte secondaire du ribbon.
  function getSalonName() {
    const el = document.getElementById('hero-title');
    return (el && el.textContent && el.textContent.trim()) || 'votre site';
  }

  function buildRibbon() {
    const r = document.createElement('div');
    r.id = 'mqs-ribbon';
    r.setAttribute('role', 'complementary');
    r.innerHTML = `
      <div class="mqs-ribbon-inner">
        <div class="mqs-ribbon-left">
          <span class="mqs-ribbon-chip">
            <span class="mqs-ribbon-dot"></span>
            DÉMO
          </span>
          <span class="mqs-ribbon-text">
            Ce site a été créé avec <b>MaQuickPage</b>. Pas encore en ligne.
          </span>
          <span class="mqs-ribbon-text mqs-ribbon-text--sm">
            Site de démonstration · ${getSalonName().replace(/[<>]/g, '')}
          </span>
        </div>
        <button class="mqs-ribbon-cta" type="button" aria-label="Créer le mien">
          Créer le mien
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2.5 6h7M6 2.5L9.5 6 6 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;
    r.querySelector('.mqs-ribbon-cta').addEventListener('click', openPricingModal);
    return r;
  }

  function buildBar() {
    const b = document.createElement('div');
    b.id = 'mqs-bar-wrap';
    b.innerHTML = `
      <div class="mqs-bar" id="mqs-bar">
        <button class="mqs-bar-min" type="button" aria-label="Réduire">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 6.5h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="mqs-bar-inner">
          <div class="mqs-bar-avatars" aria-hidden="true">
            <div class="mqs-ava mqs-ava--1"></div>
            <div class="mqs-ava mqs-ava--2"></div>
            <div class="mqs-ava mqs-ava--3"></div>
            <div class="mqs-ava mqs-ava--n">+2K</div>
          </div>
          <div class="mqs-bar-copy">
            <div class="mqs-bar-copy-1"><b>2 847 sites</b> publiés ce mois sur MaQuickPage</div>
            <div class="mqs-bar-copy-2">
              <span class="mqs-price-chip">9,90 €/mois</span>
              <span class="mqs-bar-sub">zero frais cachés · domaine inclus</span>
            </div>
          </div>
          <button class="mqs-bar-cta" type="button">Publier mon site →</button>
        </div>
      </div>
    `;
    b.querySelector('.mqs-bar-cta').addEventListener('click', openPricingModal);
    b.querySelector('.mqs-bar-min').addEventListener('click', () => {
      collapsed = true;
      b.remove();
      mountPill();
    });
    return b;
  }

  function buildPill() {
    const p = document.createElement('div');
    p.id = 'mqs-pill-wrap';
    p.innerHTML = `
      <button class="mqs-pill" type="button" aria-label="Publier mon site">
        <span class="mqs-pill-price">9,90 €/mo</span>
        <span class="mqs-pill-label">Publier mon site →</span>
        <span class="mqs-pill-expand" role="presentation" aria-label="Agrandir">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M2 6.5L5.5 3 9 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </button>
    `;
    const pillBtn = p.querySelector('.mqs-pill');
    const expandIcon = p.querySelector('.mqs-pill-expand');
    // Click sur la flèche d'expand → ré-ouvre la bar
    expandIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      collapsed = false;
      p.remove();
      mountBar(true);
    });
    // Click sur le reste du pill → ouvre la modal pricing
    pillBtn.addEventListener('click', openPricingModal);
    return p;
  }

  function mountBar(pulse) {
    const existing = document.getElementById('mqs-bar-wrap');
    if (existing) existing.remove();
    const bar = buildBar();
    document.body.appendChild(bar);
    if (pulse) {
      const inner = bar.querySelector('.mqs-bar');
      inner.classList.add('mqs-bar--pulse');
      setTimeout(() => inner.classList.remove('mqs-bar--pulse'), 1200);
    }
  }

  function mountPill() {
    const existing = document.getElementById('mqs-pill-wrap');
    if (existing) existing.remove();
    const pill = buildPill();
    document.body.appendChild(pill);
    // Réapparition garantie de la bar après 5s
    setTimeout(() => {
      const stillPill = document.getElementById('mqs-pill-wrap');
      if (stillPill && collapsed) {
        collapsed = false;
        stillPill.remove();
        mountBar(true);
      }
    }, REAPPEAR_AFTER_MS);
  }

  function showAll() {
    if (mounted) return;
    mounted = true;

    if (!document.getElementById('mqs-ribbon')) {
      document.body.appendChild(buildRibbon());
    }
    mountBar(false);
  }

  // === Triggers (identiques à l'ancien banner) ===
  function isOnboardingActive() {
    return !!document.querySelector('.mqs-pre-overlay, .mqs-onb-overlay');
  }

  function tryShow() {
    if (mounted) return;
    if (isOnboardingActive()) return;
    showAll();
  }

  function scheduleAppear() {
    if (mounted) return;

    if (isAdmin) {
      setTimeout(tryShow, 300);
      return;
    }

    let attempts = 0;
    const tryAttach = () => {
      const intro = document.querySelector('.intro');
      if (!intro) {
        if (attempts++ < 50) return setTimeout(tryAttach, 100);
        return;
      }
      intro.addEventListener('mouseenter', tryShow, { once: true });
      if (typeof IntersectionObserver === 'function') {
        const obs = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
              obs.disconnect();
              tryShow();
              break;
            }
          }
        }, { threshold: [0, 0.3, 0.5, 1] });
        obs.observe(intro);
      }
    };
    tryAttach();

    window.addEventListener('mqs-onboarding-closed', () => {
      const intro = document.querySelector('.intro');
      if (!intro) return;
      const rect = intro.getBoundingClientRect();
      const visibleRatio = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) / Math.max(1, rect.height);
      if (visibleRatio >= 0.3) tryShow();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAppear, { once: true });
  } else {
    scheduleAppear();
  }
})();
