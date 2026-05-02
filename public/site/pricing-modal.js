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
      label: '2 ans',
      engagement: 'Engagement 24 mois',
      monthlyPriceTtc: 9.90,
      savings: 'Économisez 66 % vs sans engagement',
      isPopular: true,
      features: [
        'Site 100 % personnalisable',
        'Domaine inclus 1ère année',
        'Hébergement haute performance',
        'Support email prioritaire',
        'Mises à jour à volonté',
      ],
    },
    {
      key: 'ONE_YEAR',
      label: '1 an',
      engagement: 'Engagement 12 mois',
      monthlyPriceTtc: 17.90,
      savings: 'Économisez 38 %',
      isPopular: false,
      features: [
        'Site 100 % personnalisable',
        'Domaine inclus 1ère année',
        'Hébergement haute performance',
        'Support email',
        'Mises à jour à volonté',
      ],
    },
    {
      key: 'FLEX',
      label: 'Flex',
      engagement: 'Sans engagement',
      monthlyPriceTtc: 29.00,
      savings: 'Résiliable à tout moment',
      isPopular: false,
      isFlex: true,
      features: [
        'Site 100 % personnalisable',
        'Domaine inclus 1ère année',
        'Hébergement haute performance',
        'Support email',
        'Liberté totale, aucun engagement',
      ],
    },
  ];

  // État interne
  let modalEl = null;
  let selectedPlanKey = 'TWO_YEAR'; // Default sélectionné = le plus populaire

  function formatEur(amount) {
    // 9.9 -> "9,90 €"
    return amount.toFixed(2).replace('.', ',') + ' €';
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
            Tous nos plans incluent le site, le domaine 1<sup>ère</sup> année,
            l'hébergement et le support. Sans frais de mise en place.
          </p>
        </div>

        <div class="mqs-plans" id="mqs-plans">${plansHtml}</div>

        <div class="mqs-modal-footer">
          <button id="mqs-cta-continue" type="button" class="mqs-cta-primary">
            Continuer →
          </button>
          <p class="mqs-trust">
            <strong>Sans frais de mise en place</strong> · Site en ligne sous 15 minutes ·
            Hébergé en Europe (Cloudflare + Hetzner)
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

    const isSelected = plan.key === selectedPlanKey;
    const classes = ['mqs-plan'];
    if (plan.isPopular) classes.push('mqs-plan-popular');
    if (isSelected) classes.push('mqs-plan-selected');

    const badgeHtml = plan.isPopular
      ? `<span class="mqs-plan-badge">Le plus choisi</span>`
      : '';

    const savingsClass = plan.isFlex ? 'mqs-plan-savings mqs-savings-flex' : 'mqs-plan-savings';

    return `
      <div class="${classes.join(' ')}" data-plan="${plan.key}" role="button" tabindex="0" aria-pressed="${isSelected}">
        ${badgeHtml}
        <span class="mqs-plan-engagement">${escapeHtml(plan.engagement)}</span>
        <div class="mqs-plan-price-line">
          <span class="mqs-plan-price">${formatEur(plan.monthlyPriceTtc)}</span>
          <span class="mqs-plan-period">/mois TTC</span>
        </div>
        <span class="${savingsClass}">${escapeHtml(plan.savings)}</span>
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
      card.setAttribute('aria-pressed', String(isSelected));
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

    // Click sur une card → sélectionne
    modalEl.querySelectorAll('.mqs-plan').forEach(card => {
      card.addEventListener('click', () => selectPlan(card.dataset.plan));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectPlan(card.dataset.plan);
        }
      });
    });

    // CTA "Continuer →"
    modalEl.querySelector('#mqs-cta-continue').addEventListener('click', () => {
      onContinue();
    });
  }

  function onEscapeKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  function onContinue() {
    // V1 : Step B et C pas encore codés. On affiche un placeholder en console + alert.
    // En V1.5 : transition vers Step B (recherche de domaine).
    const plan = PLANS.find(p => p.key === selectedPlanKey);
    console.log('[mqs-modal] Plan choisi :', plan);
    alert(
      `Plan sélectionné : ${plan.engagement} (${formatEur(plan.monthlyPriceTtc)}/mois TTC)\n\n` +
      `Étape suivante : choix du domaine + paiement Stripe.\n` +
      `(en cours de développement)`
    );
  }

  function openModal() {
    if (modalEl) return; // déjà ouvert
    modalEl = buildModal();
    document.body.appendChild(modalEl);
    bindModalEvents();
    document.body.style.overflow = 'hidden'; // bloque le scroll en arrière

    // Focus pour accessibilité
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
    }, 300);
  }

  // === API publique exposée à window pour le banner.js ===
  window.MqsPricingModal = {
    open: openModal,
    close: closeModal,
  };
})();
