/* =============================================================================
   Banner sticky "Mettez ce site en ligne" — script standalone
   Comportement :
     - INVISIBLE tant que le coiffeur n'a pas scrollé d'au moins SCROLL_TRIGGER_PX
       (= il a vraiment regardé le site, pas juste atterri)
     - PAS de timer auto : le scroll déclenche, sinon rien
     - Les scrolls déclenchés par l'onboarding (scrollIntoView en programmatique)
       sont ignorés : on ne compte que les scrolls réels du user
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

  const SCROLL_TRIGGER_PX = 600;     // scroll utilisateur de 600px (~ 1 viewport mobile)
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
      setTimeout(() => banner.remove(), 500);
      appeared = false;
      // Réapparition garantie après 5s, peu importe le scroll
      setTimeout(showBanner, REAPPEAR_AFTER_MS);
    });
  }

  // Trigger : scroll utilisateur > SCROLL_TRIGGER_PX.
  // Pour ignorer les scrolls programmatiques de l'onboarding (scrollIntoView),
  // on regarde si l'overlay onboarding est présent dans le DOM. Tant qu'il
  // est là, body est en overflow:hidden donc même les scrolls programmatiques
  // sont bloqués → mais on garde la garde par sécurité.
  function isOnboardingActive() {
    return !!document.querySelector('.mqs-pre-overlay, .mqs-onb-overlay');
  }

  function scheduleAppear() {
    if (appeared) return;
    const tryShow = () => {
      if (appeared) return;
      if (isOnboardingActive()) return;
      if (window.scrollY > SCROLL_TRIGGER_PX) {
        window.removeEventListener('scroll', tryShow);
        window.removeEventListener('mqs-onboarding-closed', tryShow);
        showBanner();
      }
    };
    window.addEventListener('scroll', tryShow, { passive: true });
    // Si l'utilisateur a scrollé pendant l'onboarding, le scroll event a été
    // ignoré. Quand l'onboarding ferme, on re-check les conditions.
    window.addEventListener('mqs-onboarding-closed', tryShow);
  }

  // === Boot ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAppear, { once: true });
  } else {
    scheduleAppear();
  }
})();
