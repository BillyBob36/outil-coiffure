import { t, setLang, applyTranslations, getCurrentLang } from '/admin/i18n.js';

const state = {
  page: 0,
  pageSize: 50,
  search: '',
  csvSource: '',
  groupId: '',     // '' = tous les salons, 'none' = sans groupe, '<id>' = groupe specifique
  groups: [],
  orphanCount: 0,
  total: 0
};

// Persistance du groupe actif (utile pour reprendre apres reload)
const ACTIVE_GROUP_KEY = 'outil-coiffure-active-group';
state.groupId = localStorage.getItem(ACTIVE_GROUP_KEY) || '';

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

function statsParams() {
  if (state.groupId) return '?group_id=' + encodeURIComponent(state.groupId);
  return '';
}

async function loadStats() {
  const stats = await api('/api/stats' + statsParams());
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
  if (state.groupId) params.set('group_id', state.groupId);
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

// SVG copy icon (cleaner than emoji)
const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function urlCell(displayUrl, fullUrl) {
  if (!displayUrl) return '<span class="no-screenshot">—</span>';
  return `<div class="url-with-copy">
    <a href="${displayUrl}" target="_blank" rel="noopener" class="url-link" title="${escapeHtml(fullUrl)}">${escapeHtml(displayUrl)}</a>
    <button class="btn-icon copy-btn" data-copy="${escapeHtml(fullUrl)}" title="${escapeHtml(t('cell.copy_tooltip'))}" aria-label="${escapeHtml(t('cell.copy_tooltip'))}">${COPY_ICON_SVG}</button>
  </div>`;
}

function salonRow(r) {
  const landingUrl = `/${r.slug}`;
  const editUrl = r.edit_token ? `/edit/${r.slug}?token=${r.edit_token}` : null;
  const fullLanding = window.location.origin + landingUrl;
  const fullEdit = editUrl ? window.location.origin + editUrl : null;

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

  return `<tr data-slug="${escapeHtml(r.slug)}">
    <td>${nomScrappeCell}</td>
    <td>${nomFinalCell}</td>
    <td>${escapeHtml(r.ville || '')}</td>
    <td>${r.note_avis ? `<span class="badge-rating">${r.note_avis}/5${r.nb_avis ? ` · ${r.nb_avis}` : ''}</span>` : '—'}</td>
    <td class="url-cell">${urlCell(landingUrl, fullLanding)}</td>
    <td class="url-cell">${editUrl ? urlCell(editUrl, fullEdit) : '<span class="no-screenshot">—</span>'}</td>
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

// File picker custom (translatable)
const csvFileInput = $('csv-file-input');
const csvFilePickerBtn = $('csv-file-picker-btn');
const csvFilePickerName = $('csv-file-picker-name');
if (csvFilePickerBtn && csvFileInput) {
  csvFilePickerBtn.addEventListener('click', () => csvFileInput.click());
  csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      csvFilePickerName.textContent = file.name;
      csvFilePickerName.removeAttribute('data-i18n');
      csvFilePickerName.parentElement.classList.add('has-file');
    } else {
      csvFilePickerName.dataset.i18n = 'csv.no_file';
      csvFilePickerName.textContent = t('csv.no_file');
      csvFilePickerName.parentElement.classList.remove('has-file');
    }
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
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('err.generic'));
    result.textContent = JSON.stringify(data, null, 2);
    e.target.reset();
    if (csvFilePickerName) {
      csvFilePickerName.dataset.i18n = 'csv.no_file';
      csvFilePickerName.textContent = t('csv.no_file');
      csvFilePickerName.parentElement.classList.remove('has-file');
    }
    await loadGroups();
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
      body: JSON.stringify({ csv_source: csvSource, group_id: state.groupId || null, only_missing: true })
    });
    pollJob(res.jobId);
  } catch (e) {
    alert(e.message);
  }
});

async function pollJob(jobId, expectedTotal) {
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
      if (job.total > 0) {
        const lastName = job.last && job.last.slug ? job.last.slug : (job.last || '');
        updateProgressBar(job.done, job.total, lastName);
      }
      if (job.status === 'finished' || job.status === 'error') {
        clearInterval(interval);
        if (job.total > 0) updateProgressBar(job.done, job.total, '');
        hideProgressBar();
        await loadSalons();
        await loadStats();
        setTimeout(() => { status.textContent = ''; }, 5000);
      }
    } catch {
      clearInterval(interval);
      hideProgressBar();
    }
  }, 1200);
}

$('export-csv-btn').addEventListener('click', () => {
  const params = new URLSearchParams();
  if (state.csvSource) params.set('csv_source', state.csvSource);
  if (state.groupId) params.set('group_id', state.groupId);
  params.set('format', 'smartlead');
  location.href = '/admin/export-csv?' + params;
});

$('clean-names-btn').addEventListener('click', async () => {
  const csvSource = state.csvSource || null;
  const msg = csvSource
    ? t('confirm.clean_names_source', { source: csvSource })
    : t('confirm.clean_names_all');
  if (!confirm(msg + t('confirm.clean_names_note'))) return;
  await runCleanNames({ csv_source: csvSource, force: false });
});

async function runCleanNames({ csv_source, force }) {
  const btn = $('clean-names-btn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await api('/admin/clean-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv_source, group_id: state.groupId || null, force })
    });
    if (res.total === 0) {
      // Tout est deja a jour : proposer de forcer
      const total = parseInt($('stat-total').textContent) || 0;
      const ok = confirm(t('msg.all_clean_already', { total }) + '\n\n' + t('msg.force_clean_question'));
      if (ok) {
        btn.disabled = false; btn.textContent = original;
        return runCleanNames({ csv_source, force: true });
      }
      return;
    }
    showProgressBar(res.total);
    pollJob(res.jobId, res.total);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function showProgressBar(total) {
  let bar = $('clean-progress-bar');
  if (!bar) {
    const html = `
      <div id="clean-progress-bar" class="clean-progress">
        <div class="clean-progress-info">
          <span class="clean-progress-label" id="clean-progress-label">0 / ${total}</span>
          <span class="clean-progress-last" id="clean-progress-last"></span>
        </div>
        <div class="clean-progress-track"><div class="clean-progress-fill" id="clean-progress-fill" style="width: 0%"></div></div>
      </div>`;
    document.querySelector('.batch-actions').insertAdjacentHTML('afterend', html);
  } else {
    $('clean-progress-label').textContent = `0 / ${total}`;
    $('clean-progress-fill').style.width = '0%';
    $('clean-progress-last').textContent = '';
    bar.style.display = '';
  }
}

function updateProgressBar(done, total, last) {
  const fill = $('clean-progress-fill');
  const label = $('clean-progress-label');
  const lastEl = $('clean-progress-last');
  if (!fill) return;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  fill.style.width = pct + '%';
  if (label) label.textContent = `${done} / ${total} (${pct}%)`;
  if (lastEl && last) lastEl.textContent = String(last).slice(0, 60);
}

function hideProgressBar() {
  const bar = $('clean-progress-bar');
  if (bar) setTimeout(() => bar.remove(), 2500);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ==============================
// GROUPES
// ==============================
async function loadGroups() {
  const data = await api('/admin/groups');
  state.groups = data.groups || [];
  state.orphanCount = data.orphan_count || 0;
  renderGroupsSelect();
  renderUploadGroupSelect();
  updateGroupActions();
  renderGroupInfo();
}

function renderGroupsSelect() {
  const sel = $('active-group-select');
  if (!sel) return;
  const total = state.groups.reduce((sum, g) => sum + g.salons_count, 0) + state.orphanCount;
  const opts = [
    `<option value="">${escapeHtml(t('groups.all_salons'))} (${total})</option>`
  ];
  if (state.orphanCount > 0) {
    opts.push(`<option value="none">${escapeHtml(t('groups.without_group'))} (${state.orphanCount})</option>`);
  }
  for (const g of state.groups) {
    opts.push(`<option value="${g.id}">${escapeHtml(g.name)} (${g.salons_count})</option>`);
  }
  sel.innerHTML = opts.join('');
  sel.value = state.groupId || '';
}

function renderUploadGroupSelect() {
  const sel = $('upload-group-select');
  if (!sel) return;
  const opts = [
    `<option value="">${escapeHtml(t('groups.import_no_group'))}</option>`
  ];
  for (const g of state.groups) {
    opts.push(`<option value="${g.id}">${escapeHtml(g.name)}</option>`);
  }
  sel.innerHTML = opts.join('');
  // Pre-selectionner le groupe actif si on en a un
  if (state.groupId && state.groupId !== 'none') sel.value = state.groupId;
}

function updateGroupActions() {
  const isSpecificGroup = state.groupId && state.groupId !== 'none';
  $('btn-rename-group').disabled = !isSpecificGroup;
  $('btn-delete-group').disabled = !isSpecificGroup;
}

function renderGroupInfo() {
  const info = $('groups-info');
  if (!info) return;
  if (!state.groupId) { info.classList.remove('visible'); info.innerHTML = ''; return; }
  if (state.groupId === 'none') {
    info.innerHTML = `<strong>${escapeHtml(t('groups.without_group'))}</strong> — ${escapeHtml(t('groups.orphan_help'))}`;
    info.classList.add('visible');
    return;
  }
  const g = state.groups.find(x => String(x.id) === String(state.groupId));
  if (!g) { info.classList.remove('visible'); return; }
  const desc = g.description ? ` · ${escapeHtml(g.description)}` : '';
  info.innerHTML = `<strong>${escapeHtml(g.name)}</strong> — ${g.salons_count} ${escapeHtml(t('groups.salons_label'))}, ${g.csv_sources_count} ${escapeHtml(t('groups.sources_label'))}${desc}`;
  info.classList.add('visible');
}

$('active-group-select').addEventListener('change', () => {
  state.groupId = $('active-group-select').value;
  if (state.groupId) localStorage.setItem(ACTIVE_GROUP_KEY, state.groupId);
  else localStorage.removeItem(ACTIVE_GROUP_KEY);
  state.page = 0;
  state.csvSource = '';
  $('csv-source-filter').value = '';
  updateGroupActions();
  renderGroupInfo();
  renderUploadGroupSelect();
  loadStats();
  loadSalons();
});

$('btn-new-group').addEventListener('click', async () => {
  const name = prompt(t('groups.prompt_new_name'));
  if (!name || !name.trim()) return;
  const description = prompt(t('groups.prompt_new_description')) || '';
  try {
    const res = await api('/admin/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description.trim() })
    });
    await loadGroups();
    state.groupId = String(res.id);
    localStorage.setItem(ACTIVE_GROUP_KEY, state.groupId);
    $('active-group-select').value = state.groupId;
    $('active-group-select').dispatchEvent(new Event('change'));
  } catch (e) { alert(e.message); }
});

$('btn-rename-group').addEventListener('click', async () => {
  const g = state.groups.find(x => String(x.id) === String(state.groupId));
  if (!g) return;
  const name = prompt(t('groups.prompt_rename'), g.name);
  if (!name || !name.trim() || name.trim() === g.name) return;
  try {
    await api('/admin/groups/' + g.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: g.description || '' })
    });
    await loadGroups();
    renderGroupInfo();
  } catch (e) { alert(e.message); }
});

$('btn-delete-group').addEventListener('click', async () => {
  const g = state.groups.find(x => String(x.id) === String(state.groupId));
  if (!g) return;
  const ok = confirm(t('groups.confirm_delete', { name: g.name, count: g.salons_count }));
  if (!ok) return;
  try {
    await api('/admin/groups/' + g.id, { method: 'DELETE' });
    state.groupId = '';
    localStorage.removeItem(ACTIVE_GROUP_KEY);
    await loadGroups();
    await loadStats();
    await loadSalons();
  } catch (e) { alert(e.message); }
});

// Language switcher
applyTranslations();
document.querySelectorAll('.lang-btn').forEach(b => {
  b.addEventListener('click', () => setLang(b.dataset.lang));
});
// Re-render dynamic content (table + select) when language changes
window.onLangChange = () => {
  loadGroups();
  loadStats();
  loadSalons();
};

(async () => {
  try {
    await refreshAuth();
    await loadGroups();
    await loadStats();
    await loadSalons();
  } catch (e) {
    console.error(e);
  }
})();
