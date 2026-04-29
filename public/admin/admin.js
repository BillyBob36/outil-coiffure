import { t, setLang, applyTranslations, getCurrentLang } from '/admin/i18n.js';

const state = {
  page: 0,
  pageSize: 50,
  search: '',
  csvSource: '',
  total: 0
};

const $ = id => document.getElementById(id);

async function api(path, opts = {}) {
  // Ajoute toujours Accept: application/json pour eviter une redirection HTML
  // quand la session a expire (cas typique apres redeploy)
  const headers = { 'Accept': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
  if (res.status === 401) {
    location.href = '/admin/login';
    return;
  }
  // Si la reponse n'est pas du JSON (redirect rate, page d'erreur), gerer proprement
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (res.status === 0 || res.redirected) location.href = '/admin/login';
    throw new Error('Reponse inattendue (' + res.status + '). Reconnectez-vous.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Erreur');
  }
  return res.json();
}

async function refreshAuth() {
  const me = await api('/admin/me');
  if (me && me.email) $('user-email').textContent = me.email;
}

async function loadStats() {
  const stats = await api('/api/stats');
  $('stat-total').textContent = stats.total;
  $('stat-with-screenshot').textContent = stats.withScreenshot;
  $('stat-without-screenshot').textContent = stats.withoutScreenshot;
  $('stat-csv-sources').textContent = stats.csvSources.length;
  if ($('stat-clean-names')) $('stat-clean-names').textContent = stats.withCleanName ?? '—';

  const select = $('csv-source-filter');
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(t('table.all_sources'))}</option>` +
    stats.csvSources.map(c => `<option value="${escapeHtml(c.csv_source)}">${escapeHtml(c.csv_source)} (${c.n})</option>`).join('');
  select.value = current;
}

async function loadSalons() {
  const params = new URLSearchParams({
    limit: state.pageSize,
    offset: state.page * state.pageSize,
    search: state.search,
    csv_source: state.csvSource
  });
  const data = await api('/api/salons?' + params);
  state.total = data.total;
  const tbody = $('salons-tbody');
  tbody.innerHTML = data.rows.map(salonRow).join('');
  bindRowActions();
  $('page-info').textContent = `${data.offset + 1}-${Math.min(data.offset + data.rows.length, data.total)} / ${data.total}`;
  $('prev-page').disabled = state.page === 0;
  $('next-page').disabled = (state.page + 1) * state.pageSize >= state.total;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function salonRow(r) {
  const landingUrl = `/${r.slug}`;
  const editUrl = r.edit_token ? `/edit/${r.slug}?token=${r.edit_token}` : null;
  const screenshotCell = r.screenshot_path
    ? `<img class="screenshot-thumb" src="${r.screenshot_path}" alt="capture" data-full="${r.screenshot_path}">`
    : `<span class="no-screenshot">${t('cell.no_screenshot')}</span>`;

  const nomScrappe = r.nom || '';
  const nomFinal = (r.nom_clean && r.nom_clean.trim()) || r.nom || '';
  const wasModified = nomFinal !== nomScrappe;

  const nomScrappeCell = `<span class="nom-scrappe" title="${escapeHtml(nomScrappe)}">${escapeHtml(nomScrappe)}</span>`;
  const nomFinalCell = `
    <div class="nom-final-wrap ${wasModified ? 'modified' : ''}">
      <input type="text" class="nom-final-input" value="${escapeHtml(nomFinal)}" data-slug="${escapeHtml(r.slug)}" data-original="${escapeHtml(nomFinal)}" maxlength="200">
      <span class="nom-final-status"></span>
    </div>
  `;

  const editCell = editUrl
    ? `<a href="${editUrl}" target="_blank" class="edit-link" title="${escapeHtml(t('cell.edit_link_tooltip'))}"><span class="edit-icon">✏️</span> ${escapeHtml(t('cell.edit_link'))}</a> <button class="btn-icon copy-btn" data-copy="${escapeHtml(window.location.origin + editUrl)}" title="${escapeHtml(t('cell.copy_tooltip'))}">📋</button>`
    : `<span class="no-screenshot">—</span>`;
  return `<tr data-slug="${escapeHtml(r.slug)}">
    <td>${nomScrappeCell}</td>
    <td>${nomFinalCell}</td>
    <td>${escapeHtml(r.ville || '')}</td>
    <td>${r.note_avis ? `<span class="badge-rating">${r.note_avis}/5${r.nb_avis ? ` · ${r.nb_avis}` : ''}</span>` : '—'}</td>
    <td class="url-cell"><a href="${landingUrl}" target="_blank">${landingUrl}</a></td>
    <td class="url-cell">${editCell}</td>
    <td>${screenshotCell}</td>
    <td class="actions">
      <button class="btn-small btn-primary action-screenshot">${escapeHtml(t('action.capture'))}</button>
      <button class="btn-small btn-danger action-delete" title="${escapeHtml(t('action.delete'))}">×</button>
    </td>
  </tr>`;
}

function bindRowActions() {
  document.querySelectorAll('.action-screenshot').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const slug = tr.dataset.slug;
      btn.disabled = true;
      btn.textContent = t('action.deleting');
      try {
        await api(`/admin/screenshot/${encodeURIComponent(slug)}`, { method: 'POST' });
        await loadSalons();
        await loadStats();
      } catch (e) {
        alert(t('err.generic') + ': ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = t('action.capture');
      }
    });
  });

  document.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const slug = tr.dataset.slug;
      if (!confirm(t('confirm.delete_salon', { slug }))) return;
      try {
        await api(`/admin/salon/${encodeURIComponent(slug)}`, { method: 'DELETE' });
        await loadSalons();
        await loadStats();
      } catch (e) {
        alert(e.message);
      }
    });
  });

  document.querySelectorAll('.screenshot-thumb').forEach(img => {
    img.addEventListener('click', () => {
      $('modal-image').src = img.dataset.full;
      $('screenshot-modal').hidden = false;
    });
  });

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const text = btn.dataset.copy;
      navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = original; }, 1200);
      }).catch(() => {
        prompt('Copier ce lien :', text);
      });
    });
  });

  // Edition inline du Nom final
  document.querySelectorAll('.nom-final-input').forEach(input => {
    let saving = false;
    const wrap = input.closest('.nom-final-wrap');
    const status = wrap.querySelector('.nom-final-status');

    const save = async () => {
      if (saving) return;
      const slug = input.dataset.slug;
      const original = input.dataset.original;
      const current = input.value.trim();
      if (current === original) { status.textContent = ''; return; }
      if (!current) {
        status.textContent = t('err.empty_field') + ' ✗';
        status.className = 'nom-final-status error';
        input.value = original;
        return;
      }
      saving = true;
      status.textContent = t('err.saving');
      status.className = 'nom-final-status saving';
      try {
        const res = await fetch(`/admin/salon/${encodeURIComponent(slug)}/nom-final`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ nom_final: current })
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || 'Erreur');
        }
        input.dataset.original = current;
        // Vérifier si différent du nom scrappé pour la classe modified
        const tr = input.closest('tr');
        const scrappe = tr.querySelector('.nom-scrappe').textContent;
        wrap.classList.toggle('modified', current !== scrappe);
        status.textContent = '✓';
        status.className = 'nom-final-status saved';
        setTimeout(() => { status.textContent = ''; }, 1500);
      } catch (e) {
        status.textContent = '✗ ' + e.message;
        status.className = 'nom-final-status error';
      } finally {
        saving = false;
      }
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        input.value = input.dataset.original;
        input.blur();
        status.textContent = '';
      }
    });
  });
}

$('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const result = $('upload-result');
  result.classList.add('visible');
  result.textContent = t('csv.importing');
  try {
    const res = await fetch('/admin/upload-csv', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('err.generic'));
    result.textContent = JSON.stringify(data, null, 2);
    e.target.reset();
    await loadStats();
    await loadSalons();
  } catch (e) {
    result.textContent = t('err.generic') + ': ' + e.message;
  }
});

$('search-input').addEventListener('input', debounce(() => {
  state.search = $('search-input').value;
  state.page = 0;
  loadSalons();
}, 250));

$('csv-source-filter').addEventListener('change', () => {
  state.csvSource = $('csv-source-filter').value;
  state.page = 0;
  loadSalons();
});

$('refresh-btn').addEventListener('click', () => {
  loadStats();
  loadSalons();
});

$('prev-page').addEventListener('click', () => { state.page = Math.max(0, state.page - 1); loadSalons(); });
$('next-page').addEventListener('click', () => { state.page++; loadSalons(); });

$('logout-btn').addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' });
  location.href = '/admin/login';
});

$('modal-close').addEventListener('click', () => { $('screenshot-modal').hidden = true; });
$('screenshot-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) $('screenshot-modal').hidden = true;
});

$('batch-screenshots-btn').addEventListener('click', async () => {
  const csvSource = state.csvSource || null;
  const suffix = csvSource ? t('confirm.batch_screenshots_source', { source: csvSource }) : t('confirm.batch_screenshots_all');
  if (!confirm(t('confirm.batch_screenshots') + suffix)) return;
  try {
    const res = await api('/admin/screenshot-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv_source: csvSource, only_missing: true })
    });
    pollJob(res.jobId);
  } catch (e) {
    alert(e.message);
  }
});

async function pollJob(jobId) {
  const status = $('job-status');
  const interval = setInterval(async () => {
    try {
      const job = await api(`/admin/job/${jobId}`);
      status.textContent = t('job.status_label', {
        status: job.status,
        done: job.done,
        total: job.total,
        errors: job.errors
      });
      if (job.status === 'finished' || job.status === 'error') {
        clearInterval(interval);
        await loadSalons();
        await loadStats();
        setTimeout(() => { status.textContent = ''; }, 5000);
      }
    } catch {
      clearInterval(interval);
    }
  }, 1500);
}

$('export-csv-btn').addEventListener('click', () => {
  const params = new URLSearchParams();
  if (state.csvSource) params.set('csv_source', state.csvSource);
  location.href = '/admin/export-csv?' + params;
});

$('clean-names-btn').addEventListener('click', async () => {
  const csvSource = state.csvSource || null;
  const msg = csvSource
    ? t('confirm.clean_names_source', { source: csvSource })
    : t('confirm.clean_names_all');
  if (!confirm(msg + t('confirm.clean_names_note'))) return;
  try {
    const res = await api('/admin/clean-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv_source: csvSource })
    });
    if (res.total === 0) {
      $('job-status').textContent = t('msg.no_names_to_clean');
      setTimeout(() => { $('job-status').textContent = ''; }, 3000);
      return;
    }
    pollJob(res.jobId);
  } catch (e) {
    alert(e.message);
  }
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Language switcher
applyTranslations();
document.querySelectorAll('.lang-btn').forEach(b => {
  b.addEventListener('click', () => setLang(b.dataset.lang));
});
// Re-render dynamic content (table + select) when language changes
window.onLangChange = () => {
  loadStats();
  loadSalons();
};

(async () => {
  try {
    await refreshAuth();
    await loadStats();
    await loadSalons();
  } catch (e) {
    console.error(e);
  }
})();
