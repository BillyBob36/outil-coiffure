/* =============================================================================
   Banner sticky "Mettez ce site en ligne" — script standalone
   Comportement :
     - Apparaît après 10s ou au premier scroll de 200px (whichever first)
     - Closeable. Re-apparaît après 30s.
     - N'apparaît PAS si :
         - URL contient ?nocapture=1 (Puppeteer screenshots)
         - URL contient ?banner=off (dev)
         - localStorage 'mqs-banner-permadismissed' = '1' (dismissed for good — pas
           encore implémenté côté UI, garde l'option pour V2)
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
  // Permadismiss (rarement utilisé, prévu pour V2 si on offre un opt-out durable)
  try {
    if (localStorage.getItem('mqs-banner-permadismissed') === '1') return;
  } catch (_) { /* pas de localStorage : on continue */ }

  const APPEAR_DELAY_MS = 10000;     // 10s
  const SCROLL_TRIGGER_PX = 200;     // ou scroll > 200px (whichever first)
  const REAPPEAR_AFTER_MS = 30000;   // 30s après close

  let appeared = false;
  let timerAppear = null;

  function buildBanner() {
    const div = document.createElement('div');
    div.id = 'mqs-banner';
    div.setAttribute('role', 'complementary');
    div.setAttribute('aria-label', 'Proposition commerciale');
    div.innerHTML = `
      <div id="mqs-banner-inner">
        <div id="mqs-banner-text">
          <p id="mqs-banner-text-line1">✨ Vous aimez ce site&nbsp;? Mettez-le en ligne en 5 minutes.</p>
          <p id="mqs-banner-text-line2">À partir de 9,90&nbsp;€/mois (engagement 24 mois) — sans frais de mise en place, ou 29&nbsp;€/mois sans engagement.</p>
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
    if (timerAppear) { clearTimeout(timerAppear); timerAppear = null; }

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
      // Cleanup DOM après la transition
      setTimeout(() => banner.remove(), 500);
      appeared = false;
      // Programme la réapparition
      setTimeout(scheduleAppear, REAPPEAR_AFTER_MS);
    });
  }

  function scheduleAppear() {
    if (appeared) return;
    if (timerAppear) clearTimeout(timerAppear);
    // Timer de 10s
    timerAppear = setTimeout(showBanner, APPEAR_DELAY_MS);
    // OU scroll > 200px (whichever first)
    const onScroll = () => {
      if (window.scrollY > SCROLL_TRIGGER_PX) {
        window.removeEventListener('scroll', onScroll);
        showBanner();
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // === Boot : démarre la planification après que le DOM soit prêt ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAppear, { once: true });
  } else {
    scheduleAppear();
  }
})();
