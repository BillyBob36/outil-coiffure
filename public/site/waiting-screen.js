/* =============================================================================
   Waiting screen post-paiement Stripe
   - Détecte ?signup=success sur l'URL au chargement
   - Affiche un overlay avec checklist animée
   - Poll /api/signup/status toutes les 3s
   - Quand status=live, redirige vers le live_hostname
   ============================================================================= */

(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  if (!params.has('signup')) return;
  const signupResult = params.get('signup'); // 'success' | 'cancelled'
  const sessionId = params.get('session_id');

  const STEPS = [
    { id: 'paid',         label: 'Paiement confirmé' },
    { id: 'domain',       label: 'Achat de votre domaine' },
    { id: 'dns',          label: 'Configuration DNS' },
    { id: 'ssl',          label: 'Génération du certificat HTTPS' },
    { id: 'live',         label: 'Mise en ligne' },
  ];

  function getSlugFromUrl() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    const parts = path.split('/');
    if (parts[0] === 'preview' && parts[1]) return parts[1];
    return null;
  }

  function buildOverlay() {
    const div = document.createElement('div');
    div.id = 'mqs-waiting-overlay';
    div.innerHTML = `
      <div class="mqs-waiting-card">
        ${signupResult === 'cancelled' ? renderCancelled() : renderProvisioning()}
      </div>
    `;
    return div;
  }

  function renderCancelled() {
    return `
      <h2 class="mqs-waiting-title">Paiement annulé</h2>
      <p class="mqs-waiting-sub">
        Aucun débit n'a été effectué. Vous pouvez retenter à tout moment.
      </p>
      <button id="mqs-waiting-close" class="mqs-waiting-cta" type="button">Fermer</button>
    `;
  }

  function renderProvisioning() {
    const stepsHtml = STEPS.map((s, i) => `
      <li class="mqs-waiting-step" data-step="${s.id}">
        <span class="mqs-step-icon"><span class="mqs-spinner"></span></span>
        <span class="mqs-step-label">${s.label}</span>
      </li>
    `).join('');

    return `
      <span class="mqs-waiting-eyebrow">Configuration en cours</span>
      <h2 class="mqs-waiting-title">Votre site arrive…</h2>
      <p class="mqs-waiting-sub">
        Nous configurons votre domaine et votre site.
        Cela prend généralement <strong>moins de 5 minutes</strong>.
      </p>
      <ul class="mqs-waiting-steps">${stepsHtml}</ul>
      <p class="mqs-waiting-note">
        Vous pouvez fermer cette fenêtre — nous vous enverrons un email à la fin.
      </p>
    `;
  }

  function setStepDone(id) {
    const el = document.querySelector(`.mqs-waiting-step[data-step="${id}"]`);
    if (!el) return;
    el.classList.add('mqs-step-done');
    const icon = el.querySelector('.mqs-step-icon');
    if (icon) icon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="#10B981" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function setAllStepsDone() {
    STEPS.forEach(s => setStepDone(s.id));
  }

  function showFinalSuccess(liveHostname) {
    const card = document.querySelector('.mqs-waiting-card');
    if (!card) return;
    card.innerHTML = `
      <div class="mqs-success-icon">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="#10B981" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h2 class="mqs-waiting-title">Votre site est en ligne 🎉</h2>
      <p class="mqs-waiting-sub">
        Votre site est accessible à : <strong>${escapeHtml('https://' + liveHostname)}</strong>
      </p>
      <a href="https://${escapeHtml(liveHostname)}" class="mqs-waiting-cta">Voir mon site →</a>
      <p class="mqs-waiting-note">
        Un email récapitulatif vient de vous être envoyé.
      </p>
    `;
  }

  function showError(msg) {
    const card = document.querySelector('.mqs-waiting-card');
    if (!card) return;
    card.innerHTML = `
      <h2 class="mqs-waiting-title">Configuration en cours</h2>
      <p class="mqs-waiting-sub">
        Nous rencontrons un délai inhabituel. Pas d'inquiétude — un humain prend
        le relais et vous serez contacté(e) par email dans l'heure.
      </p>
      <p class="mqs-waiting-note">${escapeHtml(msg || '')}</p>
      <button id="mqs-waiting-close" class="mqs-waiting-cta" type="button">Fermer</button>
    `;
    document.getElementById('mqs-waiting-close')?.addEventListener('click', closeOverlay);
  }

  function escapeHtml(s) {
    return s == null ? '' : String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  let pollInterval = null;
  let elapsedSec = 0;
  const TIMEOUT_SEC = 600; // 10 min max

  async function pollStatus() {
    elapsedSec += 4;
    if (elapsedSec > TIMEOUT_SEC) {
      clearInterval(pollInterval);
      showError('Délai de configuration dépassé.');
      return;
    }

    const slug = getSlugFromUrl();
    let url = '/api/signup/status?';
    if (sessionId) url += 'session_id=' + encodeURIComponent(sessionId);
    else if (slug) url += 'slug=' + encodeURIComponent(slug);
    else { showError('Slug introuvable.'); clearInterval(pollInterval); return; }

    try {
      const res = await fetch(url);
      if (!res.ok) return; // retry au prochain tick
      const data = await res.json();
      // Update visual progress according to status
      // status: 'pending' | 'provisioning' | 'live' | 'error'
      setStepDone('paid');
      if (data.status === 'provisioning') {
        // On simule la progression visuelle (les vraies étapes sont async côté serveur)
        // Au moins on coche 'paid' visuellement.
        if (elapsedSec > 12) setStepDone('domain');
        if (elapsedSec > 60) setStepDone('dns');
        if (elapsedSec > 120) setStepDone('ssl');
      }
      if (data.status === 'live') {
        clearInterval(pollInterval);
        setAllStepsDone();
        setTimeout(() => showFinalSuccess(data.liveHostname), 800);
      }
      if (data.status === 'error') {
        clearInterval(pollInterval);
        showError('Erreur de configuration côté serveur.');
      }
    } catch (err) {
      // Réseau : retry au prochain tick
    }
  }

  function closeOverlay() {
    const overlay = document.getElementById('mqs-waiting-overlay');
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    // Cleanup URL pour éviter de re-déclencher au refresh
    const url = new URL(window.location.href);
    url.searchParams.delete('signup');
    url.searchParams.delete('session_id');
    window.history.replaceState({}, document.title, url.toString());
  }

  function start() {
    const overlay = buildOverlay();
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    if (signupResult === 'cancelled') {
      document.getElementById('mqs-waiting-close')?.addEventListener('click', closeOverlay);
      return;
    }

    // Démarre le polling
    pollStatus();
    pollInterval = setInterval(pollStatus, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
