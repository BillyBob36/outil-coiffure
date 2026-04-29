const state = {
  page: 0,
  pageSize: 50,
  search: '',
  csvSource: '',
  total: 0
};

const $ = id => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  if (res.status === 401) {
    location.href = '/admin/login';
    return;
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

  const select = $('csv-source-filter');
  const current = select.value;
  select.innerHTML = '<option value="">Toutes les sources</option>' +
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
  const url = `/${r.slug}`;
  const screenshotCell = r.screenshot_path
    ? `<img class="screenshot-thumb" src="${r.screenshot_path}" alt="capture" data-full="${r.screenshot_path}">`
    : `<span class="no-screenshot">non</span>`;
  return `<tr data-slug="${escapeHtml(r.slug)}">
    <td><strong>${escapeHtml(r.nom)}</strong></td>
    <td>${escapeHtml(r.ville || '')}</td>
    <td>${r.note_avis ? `<span class="badge-rating">${r.note_avis}/5${r.nb_avis ? ` · ${r.nb_avis}` : ''}</span>` : '—'}</td>
    <td><code>${escapeHtml(r.slug)}</code></td>
    <td class="url-cell"><a href="${url}" target="_blank">${url}</a></td>
    <td>${screenshotCell}</td>
    <td class="actions">
      <button class="btn-small btn-primary action-screenshot">Capture</button>
      <button class="btn-small btn-danger action-delete">×</button>
    </td>
  </tr>`;
}

function bindRowActions() {
  document.querySelectorAll('.action-screenshot').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const slug = tr.dataset.slug;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await api(`/admin/screenshot/${encodeURIComponent(slug)}`, { method: 'POST' });
        await loadSalons();
        await loadStats();
      } catch (e) {
        alert('Erreur: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Capture';
      }
    });
  });

  document.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const slug = tr.dataset.slug;
      if (!confirm(`Supprimer ${slug} ?`)) return;
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
}

$('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const result = $('upload-result');
  result.classList.add('visible');
  result.textContent = 'Import en cours…';
  try {
    const res = await fetch('/admin/upload-csv', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    result.textContent = JSON.stringify(data, null, 2);
    e.target.reset();
    await loadStats();
    await loadSalons();
  } catch (e) {
    result.textContent = 'Erreur: ' + e.message;
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
  if (!confirm('Lancer la génération des captures manquantes ?' + (csvSource ? ` (source: ${csvSource})` : ' (toutes sources)'))) return;
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
      status.textContent = `[${job.status}] ${job.done}/${job.total} (${job.errors} erreurs)`;
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

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

(async () => {
  try {
    await refreshAuth();
    await loadStats();
    await loadSalons();
  } catch (e) {
    console.error(e);
  }
})();
