/* =============================================================================
   Modal pricing — script standalone exposant window.MqsPricingModal
   Etat machine 3 steps :
     A : choix d'un des 3 plans (TWO_YEAR / ONE_YEAR / FLEX)
     B : choix du domaine (suggestions GPT pre-generees + check OVH temps reel)
     C : email + redirection Stripe Checkout
   ============================================================================= */

(function () {
  'use strict';

  // === Configuration des plans (synchronisee avec Stripe price metadata) ===
  const PLANS = [
    {
      key: 'TWO_YEAR',
      eyebrow: 'Engagement 2 ans',
      monthlyPriceTtc: 9.90,
      description: 'Le meilleur tarif sur 24 mois.',
      cta: 'Choisir',
      isPopular: false,
      domainYears: 2,
      features: [
        'Site 100 % personnalisable',
        'Domaine .fr ou .com inclus 2 ans',
        'Hebergement haute performance',
      ],
    },
    {
      key: 'ONE_YEAR',
      eyebrow: 'Le plus choisi',
      monthlyPriceTtc: 17.90,
      description: 'Engagement 12 mois, le bon compromis.',
      cta: 'Choisir',
      isPopular: true,
      domainYears: 1,
      features: [
        'Site 100 % personnalisable',
        'Domaine .fr ou .com inclus 1 an',
        'Hebergement haute performance',
      ],
    },
    {
      key: 'FLEX',
      eyebrow: 'Sans engagement',
      monthlyPriceTtc: 29.00,
      description: 'Resiliable a tout moment.',
      cta: 'Choisir',
      isPopular: false,
      domainYears: 1,
      features: [
        'Site 100 % personnalisable',
        'Domaine .fr ou .com inclus 1 an',
        'Hebergement haute performance',
      ],
    },
  ];

  // === Etat de la modal ===
  const state = {
    modalEl: null,
    step: 'A',                // 'A' | 'B' | 'C'
    selectedPlan: null,       // ex 'TWO_YEAR'
    selectedHostname: null,   // ex 'salonjean.fr'
    selectedHostnameInfo: null, // { hostname, priceEurTtc, isIncluded, supplementEurTtc }
    suggestions: [],          // resultats /api/domain/suggestions/:slug
    suggestionsExpanded: false,
    customResult: null,       // dernier resultat /api/domain/check-custom
    customError: null,
    loading: false,
    email: '',
    submitting: false,
    salonSlug: null,
  };

  // === Utils ===
  function formatEur(amount) {
    if (amount == null) return '?';
    return amount.toFixed(2).replace('.', ',') + ' €';
  }

  function escapeHtml(s) {
    return s == null ? '' : String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getSlugFromUrl() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return null;
    const parts = path.split('/');
    if (parts[0] === 'preview' && parts[1]) return parts[1];
    return null;
  }

  function planByKey(key) {
    return PLANS.find(p => p.key === key);
  }

  // ===========================================================================
  // RENDERING (re-render full modal content on step change)
  // ===========================================================================

  function renderModal() {
    if (!state.modalEl) return;
    const inner = state.modalEl.querySelector('#mqs-modal');
    if (!inner) return;
    inner.innerHTML = `
      <button id="mqs-modal-close" type="button" aria-label="Fermer">
        <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
      ${state.step === 'A' ? renderStepA() : ''}
      ${state.step === 'B' ? renderStepB() : ''}
      ${state.step === 'C' ? renderStepC() : ''}
    `;
    bindStepEvents();
  }

  // ---------- STEP A : choix du plan ----------
  function renderStepA() {
    const plansHtml = PLANS.map(p => renderPlanCardA(p)).join('');
    return `
      <div class="mqs-step-header">
        <span class="mqs-step-eyebrow">Étape 1 / 3</span>
        <h2 class="mqs-step-title">Choisissez votre formule</h2>
        <p class="mqs-step-sub">
          Tous les plans incluent le site, le domaine, l'hébergement
          et le support — sans frais de mise en place.
        </p>
      </div>
      <div class="mqs-plans">${plansHtml}</div>
      <div class="mqs-modal-footer">
        <p class="mqs-trust">
          <strong>Sans frais de mise en place</strong> · Site en ligne sous 15 minutes ·
          Hébergé en Europe
        </p>
      </div>
    `;
  }

  function renderPlanCardA(plan) {
    const featuresHtml = plan.features.map(f => `
      <li>
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${escapeHtml(f)}</span>
      </li>
    `).join('');
    const classes = ['mqs-plan'];
    if (plan.isPopular) classes.push('mqs-plan-popular');
    return `
      <div class="${classes.join(' ')}" data-plan="${plan.key}">
        <span class="mqs-plan-eyebrow">${escapeHtml(plan.eyebrow)}</span>
        <div class="mqs-plan-price-line">
          <span class="mqs-plan-price">${formatEur(plan.monthlyPriceTtc)}</span>
          <span class="mqs-plan-period">/mois</span>
        </div>
        <p class="mqs-plan-description">${escapeHtml(plan.description)}</p>
        <button class="mqs-plan-cta" type="button" data-plan-cta="${plan.key}">${escapeHtml(plan.cta)}</button>
        <ul class="mqs-plan-features">${featuresHtml}</ul>
      </div>
    `;
  }

  // ---------- STEP B : choix du domaine ----------
  function renderStepB() {
    const plan = planByKey(state.selectedPlan);
    if (!plan) return '<p>Erreur : plan non sélectionné.</p>';

    const visibleSuggestions = state.suggestionsExpanded
      ? state.suggestions
      : state.suggestions.slice(0, 6);
    const hiddenCount = Math.max(0, state.suggestions.length - 6);

    let suggestionsHtml = '';
    if (state.loading) {
      suggestionsHtml = renderSkeletonRows(6);
    } else if (state.suggestions.length === 0) {
      suggestionsHtml = `
        <p class="mqs-empty-state">
          Aucune suggestion disponible pour le moment. Tape ton propre nom ci-dessous.
        </p>`;
    } else {
      suggestionsHtml = visibleSuggestions.map(s => renderDomainRow(s, plan)).join('');
    }

    const expandBtn = (!state.suggestionsExpanded && hiddenCount > 0)
      ? `<button class="mqs-expand-btn" type="button" id="mqs-expand-btn">
           ▾ Voir ${hiddenCount} autres suggestions
         </button>` : '';

    const customRow = renderCustomRow(plan);
    const continueDisabled = state.selectedHostname ? '' : 'disabled';

    return `
      <div class="mqs-step-header">
        <span class="mqs-step-eyebrow">Étape 2 / 3</span>
        <h2 class="mqs-step-title">Comment vos clients vous trouveront</h2>
        <p class="mqs-step-sub">
          Choisissez votre adresse web — on s'occupe du reste.
        </p>
      </div>

      <div class="mqs-domain-list">
        ${suggestionsHtml}
        ${expandBtn}
      </div>

      <div class="mqs-domain-divider">ou</div>

      ${customRow}

      <div class="mqs-modal-footer mqs-footer-stepb">
        <button class="mqs-btn-back" type="button" id="mqs-back-btn">← Retour</button>
        <button class="mqs-btn-continue" type="button" id="mqs-continue-btn" ${continueDisabled}>
          Continuer →
        </button>
      </div>

      <p class="mqs-trust">
        🔒 ${plan.domainYears === 2 ? 'Domaine inclus 2 ans' : 'Domaine inclus 1 an'} · Renouvelable · Hébergé en Europe
      </p>
    `;
  }

  function renderSkeletonRows(n) {
    let html = '';
    for (let i = 0; i < n; i++) {
      html += `
        <div class="mqs-domain-row mqs-skeleton">
          <span class="mqs-skel-text"></span>
          <span class="mqs-skel-badge"></span>
        </div>`;
    }
    return html;
  }

  function renderDomainRow(s, plan) {
    const isSelected = state.selectedHostname === s.hostname;
    const badge = s.isIncluded
      ? `<span class="mqs-badge mqs-badge-offert">Offert</span>`
      : `<span class="mqs-badge mqs-badge-supplement">+${formatEur(s.supplementEurTtc)} une seule fois</span>`;
    return `
      <div class="mqs-domain-row ${isSelected ? 'mqs-domain-selected' : ''}" data-hostname="${escapeHtml(s.hostname)}" role="button" tabindex="0">
        <span class="mqs-domain-name">${escapeHtml(s.hostname)}</span>
        ${badge}
      </div>
    `;
  }

  function renderCustomRow(plan) {
    let resultHtml = '';
    if (state.customError) {
      resultHtml = `<p class="mqs-custom-error">${escapeHtml(state.customError)}</p>`;
    } else if (state.customResult) {
      const r = state.customResult;
      if (!r.available) {
        resultHtml = `<p class="mqs-custom-error">❌ Ce nom n'est pas disponible. Essayez-en un autre.</p>`;
      } else {
        const isSelected = state.selectedHostname === r.hostname;
        const badge = r.isIncluded
          ? `<span class="mqs-badge mqs-badge-offert">Offert</span>`
          : `<span class="mqs-badge mqs-badge-supplement">+${formatEur(r.supplementEurTtc)} une seule fois</span>`;
        resultHtml = `
          <div class="mqs-domain-row ${isSelected ? 'mqs-domain-selected' : ''}" data-hostname="${escapeHtml(r.hostname)}" role="button" tabindex="0">
            <span class="mqs-domain-name">${escapeHtml(r.hostname)}</span>
            ${badge}
          </div>
        `;
      }
    }

    return `
      <div class="mqs-custom-block">
        <label class="mqs-custom-label" for="mqs-custom-input">J'ai déjà une idée précise</label>
        <div class="mqs-custom-input-row">
          <input
            type="text"
            id="mqs-custom-input"
            class="mqs-custom-input"
            placeholder="monsalon"
            autocomplete="off"
            spellcheck="false"
          />
          <select id="mqs-custom-tld" class="mqs-custom-tld">
            <option value=".fr">.fr</option>
            <option value=".com">.com</option>
          </select>
          <button id="mqs-custom-check-btn" type="button" class="mqs-btn-check">Vérifier</button>
        </div>
        <div class="mqs-custom-result">${resultHtml}</div>
      </div>
    `;
  }

  // ---------- STEP C : email + paiement ----------
  function renderStepC() {
    const plan = planByKey(state.selectedPlan);
    const hostname = state.selectedHostname;
    const info = state.selectedHostnameInfo;
    const yearsLabel = plan.domainYears === 2 ? '2 ans' : '1 an';
    const supplementLabel = (info && !info.isIncluded)
      ? `+ ${formatEur(info.supplementEurTtc)} de supplément domaine premium (charge unique sur la 1ère facture)`
      : `Domaine inclus ${yearsLabel}`;

    const submitDisabled = (state.submitting || !state.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email)) ? 'disabled' : '';

    return `
      <div class="mqs-step-header">
        <span class="mqs-step-eyebrow">Étape 3 / 3</span>
        <h2 class="mqs-step-title">Dernière étape : votre email</h2>
        <p class="mqs-step-sub">
          On vous envoie le récapitulatif et l'accès à votre espace après paiement.
        </p>
      </div>

      <div class="mqs-summary">
        <div class="mqs-summary-row">
          <span class="mqs-summary-label">Formule</span>
          <span class="mqs-summary-value">${escapeHtml(plan.eyebrow)} · ${formatEur(plan.monthlyPriceTtc)}/mois</span>
        </div>
        <div class="mqs-summary-row">
          <span class="mqs-summary-label">Domaine</span>
          <span class="mqs-summary-value">${escapeHtml(hostname)}</span>
        </div>
        <div class="mqs-summary-row mqs-summary-note">
          <span class="mqs-summary-label">&nbsp;</span>
          <span class="mqs-summary-sub">${escapeHtml(supplementLabel)}</span>
        </div>
      </div>

      <div class="mqs-email-block">
        <label class="mqs-custom-label" for="mqs-email-input">Votre email</label>
        <input
          type="email"
          id="mqs-email-input"
          class="mqs-custom-input mqs-email-input"
          placeholder="vous@example.com"
          value="${escapeHtml(state.email)}"
          autocomplete="email"
          required
        />
      </div>

      <div class="mqs-modal-footer mqs-footer-stepc">
        <button class="mqs-btn-back" type="button" id="mqs-back-btn">← Retour</button>
        <button class="mqs-btn-continue" type="button" id="mqs-submit-btn" ${submitDisabled}>
          ${state.submitting ? '... Redirection vers le paiement' : 'Procéder au paiement →'}
        </button>
      </div>

      <p class="mqs-trust">
        🔒 Paiement sécurisé Stripe · TVA incluse · Annulable selon CGV
      </p>
    `;
  }

  // ===========================================================================
  // EVENT BINDING (re-bound on each renderModal call)
  // ===========================================================================

  function bindStepEvents() {
    const m = state.modalEl;
    if (!m) return;
    m.querySelector('#mqs-modal-close')?.addEventListener('click', closeModal);

    if (state.step === 'A') {
      m.querySelectorAll('.mqs-plan-cta').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectPlanAndAdvance(btn.dataset.planCta);
        });
      });
      m.querySelectorAll('.mqs-plan').forEach(card => {
        card.addEventListener('click', (e) => {
          // Click sur la card (hors bouton) sélectionne uniquement (pas avancer)
          if (e.target.closest('.mqs-plan-cta')) return;
          // Pour A on n'a pas de "select-only", on avance directement
          selectPlanAndAdvance(card.dataset.plan);
        });
      });
    }

    if (state.step === 'B') {
      m.querySelector('#mqs-back-btn')?.addEventListener('click', () => goToStep('A'));
      m.querySelector('#mqs-continue-btn')?.addEventListener('click', () => {
        if (state.selectedHostname) goToStep('C');
      });
      m.querySelectorAll('.mqs-domain-row[data-hostname]').forEach(row => {
        row.addEventListener('click', () => selectDomain(row.dataset.hostname));
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectDomain(row.dataset.hostname);
          }
        });
      });
      m.querySelector('#mqs-expand-btn')?.addEventListener('click', () => {
        state.suggestionsExpanded = true;
        renderModal();
      });
      m.querySelector('#mqs-custom-check-btn')?.addEventListener('click', onCustomCheck);
      m.querySelector('#mqs-custom-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCustomCheck();
        }
      });
    }

    if (state.step === 'C') {
      m.querySelector('#mqs-back-btn')?.addEventListener('click', () => goToStep('B'));
      const emailInput = m.querySelector('#mqs-email-input');
      if (emailInput) {
        emailInput.addEventListener('input', () => {
          state.email = emailInput.value;
          // Ne pas re-render à chaque keystroke (on garde le focus + cursor)
          // Juste activer/désactiver le bouton via class
          const btn = m.querySelector('#mqs-submit-btn');
          if (btn) {
            const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email);
            btn.disabled = !ok || state.submitting;
          }
        });
      }
      m.querySelector('#mqs-submit-btn')?.addEventListener('click', onSubmitCheckout);
    }

    // Backdrop click ferme la modale
    state.modalEl.addEventListener('click', (e) => {
      if (e.target === state.modalEl) closeModal();
    });
  }

  // ===========================================================================
  // ACTIONS
  // ===========================================================================

  async function selectPlanAndAdvance(planKey) {
    const plan = planByKey(planKey);
    if (!plan) return;
    state.selectedPlan = planKey;
    state.step = 'B';
    state.suggestions = [];
    state.selectedHostname = null;
    state.selectedHostnameInfo = null;
    state.suggestionsExpanded = false;
    state.customResult = null;
    state.customError = null;
    state.loading = true;
    renderModal();

    // Fetch /api/domain/suggestions/:slug?plan=KEY
    if (!state.salonSlug) {
      state.salonSlug = getSlugFromUrl();
    }
    if (!state.salonSlug) {
      state.loading = false;
      state.customError = 'Erreur : impossible de détecter le salon depuis l\'URL.';
      renderModal();
      return;
    }

    try {
      const res = await fetch(`/api/domain/suggestions/${encodeURIComponent(state.salonSlug)}?plan=${encodeURIComponent(planKey)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        state.loading = false;
        state.customError = err.error || `Erreur ${res.status}`;
        renderModal();
        return;
      }
      const data = await res.json();
      state.suggestions = data.suggestions || [];
      state.loading = false;

      // Pré-sélection du 1er .fr offert (= pattern UX best-practice)
      const firstFrIncluded = state.suggestions.find(s => s.tld === '.fr' && s.isIncluded);
      const firstAny = firstFrIncluded || state.suggestions[0];
      if (firstAny) {
        state.selectedHostname = firstAny.hostname;
        state.selectedHostnameInfo = firstAny;
      }
      renderModal();
    } catch (err) {
      state.loading = false;
      state.customError = 'Erreur réseau, réessayez dans 1 minute.';
      renderModal();
    }
  }

  function selectDomain(hostname) {
    state.selectedHostname = hostname;
    // Cherche les infos dans suggestions, sinon dans customResult
    let info = state.suggestions.find(s => s.hostname === hostname);
    if (!info && state.customResult && state.customResult.hostname === hostname) {
      info = state.customResult;
    }
    state.selectedHostnameInfo = info || null;
    renderModal();
  }

  async function onCustomCheck() {
    const m = state.modalEl;
    if (!m) return;
    const input = m.querySelector('#mqs-custom-input');
    const tld = m.querySelector('#mqs-custom-tld').value;
    const raw = (input?.value || '').trim().toLowerCase();
    if (!raw) {
      state.customError = 'Tapez un nom avant de vérifier.';
      renderModal();
      return;
    }
    // Concat nom + tld choisi
    const hostname = raw.includes('.') ? raw : `${raw}${tld}`;

    state.customError = null;
    state.customResult = null;
    state.loading = false;
    // Indique loading via le bouton "Vérifier"
    const btn = m.querySelector('#mqs-custom-check-btn');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    try {
      const res = await fetch('/api/domain/check-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: state.salonSlug,
          plan: state.selectedPlan,
          hostname,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        state.customError = data.error || `Erreur ${res.status}`;
        renderModal();
        return;
      }
      state.customResult = data;
      // Si dispo, on auto-sélectionne ce domaine
      if (data.available) {
        state.selectedHostname = data.hostname;
        state.selectedHostnameInfo = data;
      }
      renderModal();
    } catch (err) {
      state.customError = 'Erreur réseau, réessayez.';
      renderModal();
    }
  }

  async function onSubmitCheckout() {
    if (state.submitting) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email)) return;
    state.submitting = true;
    renderModal();

    try {
      const res = await fetch('/api/checkout/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: state.salonSlug,
          plan: state.selectedPlan,
          hostname: state.selectedHostname,
          email: state.email,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        state.submitting = false;
        state.customError = data.error || 'Erreur création de session de paiement';
        renderModal();
        return;
      }
      // Redirection vers Stripe Checkout
      window.location.href = data.url;
    } catch (err) {
      state.submitting = false;
      state.customError = 'Erreur réseau lors du paiement.';
      renderModal();
    }
  }

  function goToStep(stepKey) {
    state.step = stepKey;
    renderModal();
  }

  // ===========================================================================
  // OPEN/CLOSE
  // ===========================================================================

  function openModal() {
    if (state.modalEl) return;
    // Reset state à chaque ouverture
    state.step = 'A';
    state.selectedPlan = null;
    state.selectedHostname = null;
    state.selectedHostnameInfo = null;
    state.suggestions = [];
    state.suggestionsExpanded = false;
    state.customResult = null;
    state.customError = null;
    state.loading = false;
    state.email = '';
    state.submitting = false;
    state.salonSlug = getSlugFromUrl();

    const div = document.createElement('div');
    div.id = 'mqs-modal-backdrop';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-modal', 'true');
    div.innerHTML = `<div id="mqs-modal" tabindex="-1"></div>`;
    document.body.appendChild(div);
    state.modalEl = div;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onEscapeKey);

    renderModal();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => state.modalEl.classList.add('mqs-modal-open'));
    });
  }

  function closeModal() {
    if (!state.modalEl) return;
    state.modalEl.classList.remove('mqs-modal-open');
    document.removeEventListener('keydown', onEscapeKey);
    document.body.style.overflow = '';
    setTimeout(() => {
      if (state.modalEl && state.modalEl.parentNode) {
        state.modalEl.parentNode.removeChild(state.modalEl);
      }
      state.modalEl = null;
    }, 300);
  }

  function onEscapeKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  // === API publique ===
  window.MqsPricingModal = { open: openModal, close: closeModal };
})();
