/* =============================================================================
   Banner sticky "Mettez ce site en ligne" — script standalone
   Comportement :
     - INVISIBLE tant que le user n'a pas atteint le bloc .intro ("Notre Histoire")
     - Trigger : mouseenter (desktop) OU IntersectionObserver ≥ 30% (mobile + fallback)
     - Si l'onboarding était actif au moment du trigger, on attend sa fermeture
     - Closeable. Re-apparaît après 5s.
     - N'apparaît PAS si :
         - URL contient ?nocapture=1 (Puppeteer screenshots)
         - URL contient ?banner=off (dev)
         - localStorage 'mqs-banner-permadismissed' = '1' (V2)
     - Click sur CTA → ouvre modal pricing (modal.js)
   ============================================================================= */

(function () {
  'use strict';

  // === Détection contexte : ne pas afficher pendant les screenshots ou debug ===
  const params = new URLSearchParams(window.location.search);
  if (params.has('nocapture') || params.get('banner') === 'off') {
    return;
  }
  if (window.location.pathname.indexOf('/preview/') !== 0) {
    // On affiche le banner uniquement sur les pages /preview/{slug}
    return;
  }
  try {
    if (localStorage.getItem('mqs-banner-permadismissed') === '1') return;
  } catch (_) { /* pas de localStorage : on continue */ }

  const REAPPEAR_AFTER_MS = 5000;    // 5s après close (demande Johann)

  let appeared = false;

  function buildBanner() {
    const div = document.createElement('div');
    div.id = 'mqs-banner';
    div.setAttribute('role', 'complementary');
    div.setAttribute('aria-label', 'Proposition commerciale');
    div.innerHTML = `
      <div id="mqs-banner-inner">
        <div id="mqs-banner-text">
          <p id="mqs-banner-text-line1">Vous aimez ce site&nbsp;? Mettez-le en ligne en 5 minutes.</p>
          <p id="mqs-banner-text-line2">À partir de 9,90&nbsp;€/mois — sans frais de mise en place, ou 29&nbsp;€/mois sans engagement.</p>
        </div>
        <button id="mqs-banner-cta" type="button">Choisir mon offre →</button>
        <button id="mqs-banner-close" type="button" aria-label="Fermer">
          <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `;
    return div;
  }

  function showBanner() {
    if (appeared) return;
    appeared = true;

    const banner = buildBanner();
    document.body.appendChild(banner);

    // Délai d'1 frame avant d'ajouter la classe pour déclencher la transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('mqs-show'));
    });

    // Click sur le CTA → ouvrir la modal pricing
    document.getElementById('mqs-banner-cta').addEventListener('click', () => {
      if (typeof window.MqsPricingModal === 'object' && window.MqsPricingModal.open) {
        window.MqsPricingModal.open();
      } else {
        // Fallback si modal pas encore chargée (cas réel : modal.js charge async)
        console.warn('[mqs-banner] MqsPricingModal not loaded');
      }
    });

    // Close → cache le banner et re-affiche après REAPPEAR_AFTER_MS
    document.getElementById('mqs-banner-close').addEventListener('click', () => {
      banner.classList.remove('mqs-show');
      setTimeout(() => banner.remove(), 500);
      appeared = false;
      // Réapparition garantie après 5s, peu importe le scroll
      setTimeout(showBanner, REAPPEAR_AFTER_MS);
    });
  }

  // Trigger : 1ère interaction avec le bloc .intro ("Notre Histoire" — premier
  // bloc après le hero). Marche en desktop (mouseenter) ET mobile/desktop
  // (IntersectionObserver quand le bloc entre dans la viewport).
  function isOnboardingActive() {
    return !!document.querySelector('.mqs-pre-overlay, .mqs-onb-overlay');
  }

  function tryShow() {
    if (appeared) return;
    if (isOnboardingActive()) return;
    showBanner();
  }

  function scheduleAppear() {
    if (appeared) return;

    // L'élément .intro peut ne pas être encore en DOM si le content est rendu async.
    // On retry avec un petit polling jusqu'à 5s.
    let attempts = 0;
    const tryAttach = () => {
      const intro = document.querySelector('.intro');
      if (!intro) {
        if (attempts++ < 50) return setTimeout(tryAttach, 100);
        return; // élément jamais trouvé, abandon silencieux
      }

      // Desktop : 1er survol du bloc
      intro.addEventListener('mouseenter', tryShow, { once: true });

      // Mobile + fallback desktop : 1er fois que le bloc devient visible
      // (au moins 30% dans la viewport).
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

    // Si l'onboarding cachait l'événement, on re-check à sa fermeture
    window.addEventListener('mqs-onboarding-closed', () => {
      // Si .intro est déjà visible quand l'onboarding ferme → afficher
      const intro = document.querySelector('.intro');
      if (!intro) return;
      const rect = intro.getBoundingClientRect();
      const visibleRatio = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) / Math.max(1, rect.height);
      if (visibleRatio >= 0.3) tryShow();
    });
  }

  // === Boot ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAppear, { once: true });
  } else {
    scheduleAppear();
  }
})();
