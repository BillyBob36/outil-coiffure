/* =============================================================================
   home.js — Logique de la landing MONSITEHQ.

   - Tous les boutons "Voir si mon salon..." ouvrent la même modale
   - Modale en 3 étapes : input → loading → résultat (found / notfound)
   - POST /api/landing/check avec google_maps_url + email
   ============================================================================= */
(function () {
  'use strict';

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
