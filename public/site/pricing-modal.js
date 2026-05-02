/* =============================================================================
   Modal pricing — script standalone exposant window.MqsPricingModal
   Step A : choix d'un des 3 plans (TWO_YEAR / ONE_YEAR / FLEX).
   Step B (V1.5) : recherche domaine + email.
   Step C (V1.5) : redirection vers Stripe Checkout.
   ============================================================================= */

(function () {
  'use strict';

  // === Configuration des plans (synchronisée avec Stripe price metadata) ===
  const PLANS = [
    {
      key: 'TWO_YEAR',
      eyebrow: 'Engagement 2 ans',
      monthlyPriceTtc: 9.90,
      description: 'Le meilleur tarif. Site, domaine et hébergement inclus pendant 24 mois.',
      cta: 'Choisir ce plan',
      isPopular: false,
      features: [
        'Site 100 % personnalisable',
        'Domaine .fr ou .com inclus',
        'Hébergement haute performance',
        'Support email prioritaire',
      ],
    },
    {
      key: 'ONE_YEAR',
      eyebrow: 'Le plus choisi',
      monthlyPriceTtc: 17.90,
      description: 'Engagement 12 mois. Le compromis idéal entre prix et flexibilité.',
      cta: 'Choisir ce plan',
      isPopular: true,
      features: [
        'Site 100 % personnalisable',
        'Domaine .fr ou .com inclus',
        'Hébergement haute performance',
        'Support email',
      ],
    },
    {
      key: 'FLEX',
      eyebrow: 'Sans engagement',
      monthlyPriceTtc: 29.00,
      description: 'Liberté totale. Résiliable à tout moment, sans pénalité.',
      cta: 'Choisir ce plan',
      isPopular: false,
      features: [
        'Site 100 % personnalisable',
        'Domaine .fr ou .com inclus',
        'Hébergement haute performance',
        'Aucun engagement',
      ],
    },
  ];

  // État interne
  let modalEl = null;
  let selectedPlanKey = null;

  function formatEur(amount) {
    return amount.toFixed(2).replace('.', ',') + ' €';
  }

  function buildModal() {
    const div = document.createElement('div');
    div.id = 'mqs-modal-backdrop';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-modal', 'true');
    div.setAttribute('aria-label', 'Choix de votre formule');

    const plansHtml = PLANS.map(p => buildPlanCardHtml(p)).join('');

    div.innerHTML = `
      <div id="mqs-modal" tabindex="-1">
        <button id="mqs-modal-close" type="button" aria-label="Fermer">
          <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>

        <div class="mqs-step-header">
          <span class="mqs-step-eyebrow">Étape 1 / 3</span>
          <h2 class="mqs-step-title">Choisissez votre formule</h2>
          <p class="mqs-step-sub">
            Tous les plans incluent le site, le domaine 1<sup>ère</sup> année,
            l'hébergement et le support — sans frais de mise en place.
          </p>
        </div>

        <div class="mqs-plans" id="mqs-plans">${plansHtml}</div>

        <div class="mqs-modal-footer">
          <p class="mqs-trust">
            <strong>Sans frais de mise en place</strong> · Site en ligne sous 15 minutes ·
            Hébergé en Europe
          </p>
        </div>
      </div>
    `;
    return div;
  }

  function buildPlanCardHtml(plan) {
    const featuresHtml = plan.features.map(f => `
      <li>
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${escapeHtml(f)}</span>
      </li>
    `).join('');

    const classes = ['mqs-plan'];
    if (plan.isPopular) classes.push('mqs-plan-popular');

    return `
      <div class="${classes.join(' ')}" data-plan="${plan.key}" role="button" tabindex="0" aria-label="Sélectionner le plan ${escapeHtml(plan.eyebrow)}">
        <span class="mqs-plan-eyebrow">${escapeHtml(plan.eyebrow)}</span>
        <div class="mqs-plan-price-line">
          <span class="mqs-plan-price">${formatEur(plan.monthlyPriceTtc)}</span>
          <span class="mqs-plan-period">/mois</span>
        </div>
        <p class="mqs-plan-description">${escapeHtml(plan.description)}</p>
        <button class="mqs-plan-cta" type="button" data-plan-cta="${plan.key}">
          ${escapeHtml(plan.cta)}
        </button>
        <ul class="mqs-plan-features">${featuresHtml}</ul>
      </div>
    `;
  }

  function escapeHtml(s) {
    return s == null ? '' : String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function selectPlan(planKey) {
    selectedPlanKey = planKey;
    if (!modalEl) return;
    const cards = modalEl.querySelectorAll('.mqs-plan');
    cards.forEach(card => {
      const isSelected = card.dataset.plan === planKey;
      card.classList.toggle('mqs-plan-selected', isSelected);
    });
  }

  function bindModalEvents() {
    if (!modalEl) return;

    // Close (X button)
    modalEl.querySelector('#mqs-modal-close').addEventListener('click', closeModal);

    // Click sur backdrop (en dehors du modal-content) ferme
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });

    // ESC ferme
    document.addEventListener('keydown', onEscapeKey);

    // Click sur une card → sélectionne (sans déclencher la transition)
    modalEl.querySelectorAll('.mqs-plan').forEach(card => {
      card.addEventListener('click', (e) => {
        // Si on a cliqué sur le bouton CTA dans la card, ne pas faire la sélection
        // (le bouton gère déjà cela + déclenche Continue).
        if (e.target.closest('.mqs-plan-cta')) return;
        selectPlan(card.dataset.plan);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectPlan(card.dataset.plan);
        }
      });
    });

    // Click sur un bouton "Choisir ce plan" → sélectionne + transition vers Step B
    modalEl.querySelectorAll('.mqs-plan-cta').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectPlan(btn.dataset.planCta);
        onContinue();
      });
    });
  }

  function onEscapeKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  function onContinue() {
    // V1 : Step B et C pas encore codés. On affiche un placeholder.
    const plan = PLANS.find(p => p.key === selectedPlanKey);
    if (!plan) return;
    console.log('[mqs-modal] Plan choisi :', plan);
    alert(
      `Plan sélectionné : ${plan.eyebrow} (${formatEur(plan.monthlyPriceTtc)}/mois TTC)\n\n` +
      `Étape suivante : choix du domaine + paiement Stripe.\n` +
      `(en cours de développement)`
    );
  }

  function openModal() {
    if (modalEl) return;
    modalEl = buildModal();
    document.body.appendChild(modalEl);
    bindModalEvents();
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modalEl.classList.add('mqs-modal-open');
        const focusTarget = modalEl.querySelector('#mqs-modal');
        if (focusTarget) focusTarget.focus();
      });
    });
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove('mqs-modal-open');
    document.removeEventListener('keydown', onEscapeKey);
    document.body.style.overflow = '';
    setTimeout(() => {
      if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
      modalEl = null;
      selectedPlanKey = null;
    }, 300);
  }

  // === API publique exposée à window pour le banner.js ===
  window.MqsPricingModal = {
    open: openModal,
    close: closeModal,
  };
})();
