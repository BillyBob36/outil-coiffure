import { t, setLang, applyTranslations, getCurrentLang } from '/admin/i18n.js';

const state = {
  page: 0,
  pageSize: 50,
  search: '',
  csvSource: '',
  groupId: '',     // '' = tous les salons, 'none' = sans groupe, '<id>' = groupe specifique
  groups: [],
  orphanCount: 0,
  total: 0,
  selectedSlugs: new Set()  // slugs des lignes cochees (persiste entre pages)
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
  updateBulkActionsBar();
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// SVG copy icon (cleaner than emoji)
const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function urlCell(displayText, fullUrl, hrefUrl) {
  if (!displayText) return '<span class="no-screenshot">—</span>';
  // hrefUrl par defaut = fullUrl (pour clic), displayText = text affiche
  const href = hrefUrl || fullUrl;
  return `<div class="url-with-copy">
    <a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="url-link" title="${escapeHtml(fullUrl)}">${escapeHtml(displayText)}</a>
    <button class="btn-icon copy-btn" data-copy="${escapeHtml(fullUrl)}" title="${escapeHtml(t('cell.copy_tooltip'))}" aria-label="${escapeHtml(t('cell.copy_tooltip'))}">${COPY_ICON_SVG}</button>
  </div>`;
}

function publicBaseFromHost() {
  // Sur outil.monsitehq.com (agency admin), le public est sur monsitehq.com
  const host = window.location.host;
  if (host.startsWith('outil.')) {
    return window.location.protocol + '//' + host.slice('outil.'.length);
  }
  return window.location.origin;
}

function salonRow(r) {
  const publicBase = publicBaseFromHost();
  const landingUrl = `${publicBase}/preview/${r.slug}`;
  const editUrl = r.edit_token ? `${publicBase}/admin/${r.slug}?token=${r.edit_token}` : null;
  const fullLanding = landingUrl;
  const fullEdit = editUrl;

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

  // URLs compactes : on affiche un texte court, le full URL est dans le hover/title
  const landingDisplay = '/preview/…';
  const editDisplay = editUrl ? '/admin/…' : null;

  // Presentations : clickables (ouvrent une modale)
  const presScrappee = r.presentation_scrappee || '';
  const presCorrigee = r.presentation_corrigee || '';
  const presScrappeeShort = presScrappee.length > 50 ? presScrappee.slice(0, 50) + '…' : presScrappee;
  const presCorrigeeShort = presCorrigee.length > 50 ? presCorrigee.slice(0, 50) + '…' : presCorrigee;
  const presScrappeeCell = presScrappee
    ? `<span class="presentation-cell" title="${escapeHtml(presScrappee)}">${escapeHtml(presScrappeeShort)}</span>`
    : `<span class="presentation-cell empty">—</span>`;
  const presCorrigeeCell = presCorrigee
    ? `<span class="presentation-cell modified" title="${escapeHtml(presCorrigee)}">${escapeHtml(presCorrigeeShort)}</span>`
    : `<span class="presentation-cell empty">${escapeHtml(t('cell.click_to_edit'))}</span>`;

  const checked = state.selectedSlugs.has(r.slug) ? 'checked' : '';

  return `<tr data-slug="${escapeHtml(r.slug)}" class="${checked ? 'row-selected' : ''}">
    <td class="col-checkbox">
      <input type="checkbox" class="row-checkbox" ${checked} aria-label="Sélectionner ${escapeHtml(r.slug)}">
    </td>
    <td>${nomScrappeCell}</td>
    <td>${nomFinalCell}</td>
    <td class="col-presentation"><div class="open-presentation" data-slug="${escapeHtml(r.slug)}">${presScrappeeCell}</div></td>
    <td class="col-presentation"><div class="open-presentation" data-slug="${escapeHtml(r.slug)}">${presCorrigeeCell}</div></td>
    <td>${escapeHtml(r.ville || '')}</td>
    <td class="url-cell col-url-compact">${urlCell(landingDisplay, fullLanding, landingUrl)}</td>
    <td class="url-cell col-url-compact">${editDisplay ? urlCell(editDisplay, fullEdit, editUrl) : '<span class="no-screenshot">—</span>'}</td>
    <td>${screenshotCell}</td>
  </tr>`;
}

function bindRowActions() {
  // Selection : checkbox par ligne
  document.querySelectorAll('.row-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const tr = cb.closest('tr');
      const slug = tr.dataset.slug;
      if (cb.checked) {
        state.selectedSlugs.add(slug);
        tr.classList.add('row-selected');
      } else {
        state.selectedSlugs.delete(slug);
        tr.classList.remove('row-selected');
      }
      updateSelectionUI();
    });
  });

  // Click sur une cellule presentation : ouvre la modale
  document.querySelectorAll('.open-presentation').forEach(el => {
    el.addEventListener('click', () => {
      const slug = el.dataset.slug;
      openPresentationModal(slug);
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

// File picker custom (translatable) — supporte multi-fichiers
const csvFileInput = $('csv-file-input');
const csvFilePickerBtn = $('csv-file-picker-btn');
const csvFilePickerName = $('csv-file-picker-name');
const sourceNameInput = $('source-name-input');
const csvImportHint = $('csv-import-hint');

// Derivation cote client (miroir du backend) : "coiffeur-france-...-cantal.csv" -> "cantal"
function deriveSourceFromFilename(filename) {
  if (!filename) return '';
  const noExt = String(filename).replace(/\.(csv|tsv|txt)$/i, '');
  const parts = noExt.split(/[-_./\\\s]+/).filter(Boolean);
  return parts[parts.length - 1] || noExt || '';
}

function updateFilePickerUI() {
  const files = csvFileInput?.files;
  if (!files || files.length === 0) {
    if (csvFilePickerName) {
      csvFilePickerName.dataset.i18n = 'csv.no_file';
      csvFilePickerName.textContent = t('csv.no_file');
      csvFilePickerName.parentElement.classList.remove('has-file');
    }
    if (sourceNameInput) {
      sourceNameInput.disabled = false;
      sourceNameInput.placeholder = t('csv.source_name_placeholder_optional');
    }
    if (csvImportHint) csvImportHint.innerHTML = t('csv.hint_default');
    return;
  }

  if (files.length === 1) {
    const file = files[0];
    if (csvFilePickerName) {
      csvFilePickerName.removeAttribute('data-i18n');
      csvFilePickerName.textContent = file.name;
      csvFilePickerName.parentElement.classList.add('has-file');
    }
    if (sourceNameInput) {
      sourceNameInput.disabled = false;
      const auto = deriveSourceFromFilename(file.name);
      sourceNameInput.placeholder = t('csv.source_auto_placeholder', { name: auto });
    }
    if (csvImportHint) {
      const auto = deriveSourceFromFilename(file.name);
      csvImportHint.innerHTML = t('csv.hint_single', { name: auto });
    }
  } else {
    // Multi-fichiers : nom auto force, input source desactive
    const names = Array.from(files).map(f => deriveSourceFromFilename(f.name));
    if (csvFilePickerName) {
      csvFilePickerName.removeAttribute('data-i18n');
      csvFilePickerName.textContent = t('csv.files_selected', { count: files.length });
      csvFilePickerName.parentElement.classList.add('has-file');
    }
    if (sourceNameInput) {
      sourceNameInput.value = '';
      sourceNameInput.disabled = true;
      sourceNameInput.placeholder = t('csv.source_auto_multi');
    }
    if (csvImportHint) {
      csvImportHint.innerHTML = t('csv.hint_multi', { count: files.length, names: names.join(', ') });
    }
  }
}

if (csvFilePickerBtn && csvFileInput) {
  csvFilePickerBtn.addEventListener('click', () => csvFileInput.click());
  csvFileInput.addEventListener('change', updateFilePickerUI);
}

async function uploadOneCsv(file, sourceName, groupId) {
  const fd = new FormData();
  fd.append('csv', file);
  if (sourceName) fd.append('source_name', sourceName);
  if (groupId) fd.append('group_id', groupId);
  const res = await fetch('/admin/upload-csv', {
    method: 'POST',
    body: fd,
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || t('err.generic'));
  return data;
}

$('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const files = Array.from(csvFileInput?.files || []);
  if (!files.length) return;

  const result = $('upload-result');
  result.classList.add('visible');
  result.textContent = t('csv.importing');
  const groupId = ($('upload-group-select')?.value || '') || null;
  const manualSource = (sourceNameInput?.value || '').trim();

  const summary = [];
  try {
    if (files.length === 1) {
      // Source name : manuel si fourni, sinon auto-derive cote backend
      const data = await uploadOneCsv(files[0], manualSource, groupId);
      summary.push(`✓ ${data.source_name}: ${data.imported} importes (${data.skipped} ignores)`);
    } else {
      // Multi : pas de source manuelle, chacun a son nom auto
      for (let i = 0; i < files.length; i++) {
        result.textContent = t('csv.importing_progress', { current: i + 1, total: files.length, name: files[i].name });
        try {
          const data = await uploadOneCsv(files[i], '', groupId);
          summary.push(`✓ ${data.source_name}: ${data.imported} importes (${data.skipped} ignores)`);
        } catch (err) {
          summary.push(`✗ ${files[i].name}: ${err.message}`);
        }
      }
    }
    result.textContent = summary.join('\n');
    e.target.reset();
    updateFilePickerUI();
    await loadGroups();
    await loadStats();
    await loadSalons();
  } catch (err) {
    result.textContent = t('err.generic') + ': ' + err.message;
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

// Le handler du bouton "Generer les captures" est maintenant base sur la selection :
// voir runCaptureSelection() plus bas dans la section "SELECTION".

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

// ==============================
// SELECTION (cases a cocher) + actions sur la selection
// ==============================
function updateBulkActionsBar() {
  // Compatibilite : cette fonction etait appelee dans loadSalons, on garde son nom
  // mais elle gere maintenant la selection.
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selectedSlugs.size;
  const info = $('selection-info');
  const span = info?.querySelector('span');

  if (count === 0) {
    if (info) info.hidden = true;
  } else {
    if (info) {
      info.hidden = false;
      if (span) span.innerHTML = t('table.selection_count', { count });
    }
  }

  // Boutons qui dependent de la selection
  const deleteBtn = $('bulk-delete-selection-btn');
  if (deleteBtn) deleteBtn.disabled = count === 0;
  updateRunButtonState();

  // Master checkbox : etat (checked / unchecked / indeterminate)
  const master = $('select-all-checkbox');
  if (master) {
    const visibleSlugs = Array.from(document.querySelectorAll('.row-checkbox')).map(cb => cb.closest('tr').dataset.slug);
    if (visibleSlugs.length === 0) {
      master.checked = false;
      master.indeterminate = false;
    } else {
      const allSelected = visibleSlugs.every(s => state.selectedSlugs.has(s));
      const noneSelected = visibleSlugs.every(s => !state.selectedSlugs.has(s));
      master.checked = allSelected;
      master.indeterminate = !allSelected && !noneSelected;
    }
  }
}

function clearSelection() {
  state.selectedSlugs.clear();
  document.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('tr.row-selected').forEach(tr => tr.classList.remove('row-selected'));
  updateSelectionUI();
}

// Master checkbox
if ($('select-all-checkbox')) {
  $('select-all-checkbox').addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('.row-checkbox').forEach(cb => {
      const slug = cb.closest('tr').dataset.slug;
      cb.checked = checked;
      if (checked) {
        state.selectedSlugs.add(slug);
        cb.closest('tr').classList.add('row-selected');
      } else {
        state.selectedSlugs.delete(slug);
        cb.closest('tr').classList.remove('row-selected');
      }
    });
    updateSelectionUI();
  });
}

if ($('clear-selection-btn')) {
  $('clear-selection-btn').addEventListener('click', clearSelection);
}

// Etat des cases a cocher d'actions (capture, clean_names, correct_presentation)
function getCheckedActions() {
  const actions = {};
  document.querySelectorAll('.action-checkbox input[type="checkbox"]').forEach(cb => {
    actions[cb.dataset.action] = cb.checked;
  });
  return actions;
}

function anyActionChecked() {
  return Object.values(getCheckedActions()).some(Boolean);
}

function updateRunButtonState() {
  const btn = $('run-actions-btn');
  if (!btn) return;
  btn.disabled = state.selectedSlugs.size === 0 || !anyActionChecked();
}

document.querySelectorAll('.action-checkbox input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', updateRunButtonState);
});

// Action: Run les actions cochees sur la selection
async function runActions() {
  const slugs = Array.from(state.selectedSlugs);
  if (slugs.length === 0) return;
  const actions = getCheckedActions();
  const enabled = Object.entries(actions).filter(([_, v]) => v).map(([k]) => k);
  if (enabled.length === 0) return;

  // Construire le message de confirmation
  const labelsByKey = {
    capture: t('table.batch_screenshots'),
    clean_names: t('table.clean_names'),
    correct_presentation: t('table.correct_presentation')
  };
  const labels = enabled.map(k => labelsByKey[k]).join(', ');
  if (!confirm(t('run.confirm', { count: slugs.length, actions: labels }))) return;

  try {
    const res = await api('/admin/run-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs, actions })
    });
    showProgressBar(res.total);
    pollRunJob(res.jobId, res.total);
  } catch (e) {
    alert(t('err.generic') + ': ' + e.message);
  }
}

async function pollRunJob(jobId, expectedTotal) {
  const status = $('job-status');
  const interval = setInterval(async () => {
    try {
      const job = await api(`/admin/run-job/${jobId}`);
      const phase = job.phase ? ` [${job.phase}]` : '';
      status.textContent = t('job.status_label', {
        status: job.status + phase,
        done: job.done,
        total: job.total,
        errors: job.errors
      });
      if (job.total > 0) {
        updateProgressBar(job.done, job.total, job.last || '');
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
  }, 1000);
}

// Action: Supprimer la selection
async function runDeleteSelection() {
  const slugs = Array.from(state.selectedSlugs);
  if (slugs.length === 0) return;
  if (!confirm(t('confirm.delete_selection_1', { count: slugs.length }))) return;
  if (!confirm(t('confirm.delete_selection_2'))) return;
  try {
    const res = await api('/admin/salons/bulk', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, slugs })
    });
    clearSelection();
    await loadGroups();
    await loadStats();
    await loadSalons();
    alert(t('bulk.deleted_success', { count: res.deleted }));
  } catch (e) {
    alert(t('err.generic') + ': ' + e.message);
  }
}

if ($('run-actions-btn')) $('run-actions-btn').addEventListener('click', runActions);
if ($('bulk-delete-selection-btn')) $('bulk-delete-selection-btn').addEventListener('click', runDeleteSelection);

// =================================================================
// MODALE PRESENTATION : afficher + editer la presentation corrigee
// =================================================================
let currentPresentationSlug = null;

async function openPresentationModal(slug) {
  currentPresentationSlug = slug;
  const modal = $('presentation-modal');
  const status = $('presentation-modal-status');
  status.textContent = '';

  // Recuperer les donnees a jour
  try {
    const data = await api(`/api/salons?limit=1&search=${encodeURIComponent(slug)}`);
    const row = (data.rows || []).find(r => r.slug === slug);
    if (!row) throw new Error('Salon introuvable');

    $('presentation-modal-title').textContent = row.nom_clean || row.nom;
    $('presentation-modal-scrappee').textContent = row.presentation_scrappee || '(vide — pas de meta description dans le CSV)';
    $('presentation-modal-corrigee').value = row.presentation_corrigee || '';
    modal.hidden = false;
  } catch (e) {
    alert(t('err.generic') + ': ' + e.message);
  }
}

async function savePresentationModal() {
  if (!currentPresentationSlug) return;
  const value = $('presentation-modal-corrigee').value.trim();
  const status = $('presentation-modal-status');
  status.textContent = '…';
  status.className = 'modal-presentation-status saving';
  try {
    await api(`/admin/salon/${encodeURIComponent(currentPresentationSlug)}/presentation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presentation: value })
    });
    status.textContent = '✓ ' + t('modal.saved');
    status.className = 'modal-presentation-status saved';
    await loadSalons();
    setTimeout(() => { $('presentation-modal').hidden = true; }, 800);
  } catch (e) {
    status.textContent = '✗ ' + e.message;
    status.className = 'modal-presentation-status error';
  }
}

if ($('presentation-modal-close')) {
  $('presentation-modal-close').addEventListener('click', () => { $('presentation-modal').hidden = true; });
}
if ($('presentation-modal-save')) {
  $('presentation-modal-save').addEventListener('click', savePresentationModal);
}
if ($('presentation-modal-reset')) {
  $('presentation-modal-reset').addEventListener('click', () => {
    $('presentation-modal-corrigee').value = '';
  });
}
if ($('presentation-modal')) {
  $('presentation-modal').addEventListener('click', (e) => {
    if (e.target === $('presentation-modal')) $('presentation-modal').hidden = true;
  });
}

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
