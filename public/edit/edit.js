// ====================================================================
// PAGE EDITION COIFFEUR — /edit/{slug}?token=xxx
// ====================================================================

const DAY_LABELS = {
  monday: 'Lundi', tuesday: 'Mardi', wednesday: 'Mercredi',
  thursday: 'Jeudi', friday: 'Vendredi', saturday: 'Samedi', sunday: 'Dimanche'
};

const $ = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// --- Etat applicatif ---
const state = {
  slug: '',
  token: '',
  view: null,         // reponse complete de l'API (defaults + overrides merges)
  draft: null,        // copie locale modifiable (= content)
  noteAvis: null,     // note Google brute du salon
  hasGoogleNote: false
};

// --- Routing : extraire slug + token de l'URL ---
function parseUrl() {
  // Pattern : /admin/{slug}?token=xxx (nouveau, monsitehq.com)
  // ou      : /edit/{slug}?token=xxx (ancien, conserve pour les liens deja envoyes)
  const path = window.location.pathname;
  const m = path.match(/^\/(?:admin|edit)\/([^/]+)/);
  if (!m) return null;
  const params = new URLSearchParams(window.location.search);
  return { slug: m[1], token: params.get('token') || '' };
}

// --- Toast ---
let toastTimer = null;
function toast(message, type = 'success') {
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast visible ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}

// --- API helpers ---
async function apiGet() {
  const res = await fetch(`/api/edit/${encodeURIComponent(state.slug)}?token=${encodeURIComponent(state.token)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erreur' }));
    throw new Error(err.error || 'Erreur ' + res.status);
  }
  return res.json();
}

async function apiPut(overrides) {
  const res = await fetch(`/api/edit/${encodeURIComponent(state.slug)}?token=${encodeURIComponent(state.token)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ overrides })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erreur' }));
    throw new Error(err.error || 'Erreur sauvegarde');
  }
  return res.json();
}

async function apiResetOverrides() {
  const res = await fetch(`/api/edit/${encodeURIComponent(state.slug)}/overrides?token=${encodeURIComponent(state.token)}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Erreur reset');
  return res.json();
}

async function apiUploadImage(blob, kind) {
  const fd = new FormData();
  fd.append('image', blob, `${kind}.jpg`);
  fd.append('kind', kind);
  const res = await fetch(`/api/edit/${encodeURIComponent(state.slug)}/upload-image?token=${encodeURIComponent(state.token)}`, {
    method: 'POST',
    body: fd
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erreur upload' }));
    throw new Error(err.error || 'Erreur upload');
  }
  return res.json();
}

// ===========================================================
// CROP IMAGE (Cropper.js + compression canvas)
// ===========================================================
let cropper = null;
let cropResolve = null;

function openCropModal(imageSrc, aspectRatio = 16/9) {
  return new Promise((resolve) => {
    cropResolve = resolve;
    const modal = $('crop-modal');
    const img = $('cropper-image');
    img.src = imageSrc;
    modal.hidden = false;

    if (cropper) cropper.destroy();
    cropper = new Cropper(img, {
      aspectRatio,
      viewMode: 1,
      autoCropArea: 1,
      background: false,
      guides: true,
      movable: true,
      zoomable: true,
      rotatable: false,
      scalable: false
    });
  });
}

function closeCropModal(result) {
  $('crop-modal').hidden = true;
  if (cropper) { cropper.destroy(); cropper = null; }
  if (cropResolve) { cropResolve(result); cropResolve = null; }
}

$('btn-crop-cancel').onclick = () => closeCropModal(null);
$('btn-crop-confirm').onclick = async () => {
  if (!cropper) return closeCropModal(null);
  // Recuperer le canvas crope, puis re-compresser via toBlob JPEG
  const canvas = cropper.getCroppedCanvas({
    maxWidth: 1920,
    maxHeight: 1920,
    imageSmoothingQuality: 'high'
  });
  canvas.toBlob((blob) => closeCropModal(blob), 'image/jpeg', 0.85);
};

// ===========================================================
// CONFIRM MODAL
// ===========================================================
function confirmDialog(title, message) {
  return new Promise((resolve) => {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-modal').hidden = false;
    const cleanup = (val) => {
      $('confirm-modal').hidden = true;
      $('btn-confirm-ok').onclick = null;
      $('btn-confirm-cancel').onclick = null;
      resolve(val);
    };
    $('btn-confirm-ok').onclick = () => cleanup(true);
    $('btn-confirm-cancel').onclick = () => cleanup(false);
  });
}

// ===========================================================
// CLIENT-SIDE COMPRESSION (galerie : pas de crop, juste resize)
// ===========================================================
async function compressImageFile(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width / img.height;
        let w = img.width, h = img.height;
        if (Math.max(w, h) > maxDim) {
          if (w >= h) { w = maxDim; h = Math.round(maxDim / ratio); }
          else { h = maxDim; w = Math.round(maxDim * ratio); }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Image invalide'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Lecture impossible'));
    reader.readAsDataURL(file);
  });
}

// ===========================================================
// RENDU INITIAL
// ===========================================================
function renderAll() {
  const c = state.draft;
  $('edit-brand-name').textContent = state.view.nom || c.hero.title || 'Mon salon';
  $('preview-link').href = `${getPublicBaseUrl()}/preview/${state.slug}`;

  renderHero(c.hero);
  renderIntro(c.intro);
  renderServices(c.services);
  renderGallery(c.gallery);
  renderTestimonials(c.testimonials);
  renderContact(c.contact, c.socials);
}

function getPublicBaseUrl() {
  // En prod, public et admin coiffeur sont sur le meme host (monsitehq.com)
  // L'agency admin est sur outil.monsitehq.com — dans ce cas, on revient sur monsitehq.com
  const host = window.location.host;
  if (host.startsWith('outil.')) {
    return window.location.protocol + '//' + host.slice('outil.'.length);
  }
  return window.location.origin;
}

// ----- HERO -----
function renderHero(hero) {
  $('hero-tagline').value = hero.tagline || '';
  $('hero-title').value = hero.title || '';
  $('hero-subtitle').value = hero.subtitle || '';
  $('hero-image-preview').src = hero.backgroundImage || '';
}

$('btn-hero-image').onclick = () => $('hero-file-input').click();
$('hero-file-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const blob = await openCropModal(ev.target.result, 16/9);
    if (!blob) return;
    try {
      toast('Envoi de l\'image…', 'success');
      const result = await apiUploadImage(blob, 'hero');
      $('hero-image-preview').src = result.url;
      state.draft.hero.backgroundImage = result.url;
      toast(`Image envoyée (${result.sizeKb} Ko)`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

function collectHero() {
  return {
    tagline: $('hero-tagline').value.trim(),
    title: $('hero-title').value.trim(),
    subtitle: $('hero-subtitle').value.trim(),
    backgroundImage: state.draft.hero.backgroundImage
  };
}

// ----- INTRO -----
function renderIntro(intro) {
  $('intro-title').value = intro.title || '';
  $('intro-description').value = intro.description || '';
  $('intro-show-rating').checked = intro.showRating !== false;
  $('intro-fallback').value = intro.ratingFallback || '';

  const note = state.noteAvis;
  const hasNote = note != null && Number.isFinite(note);
  state.hasGoogleNote = hasNote;

  const status = $('intro-rating-status');
  if (!hasNote) {
    status.textContent = 'Vous n\'avez pas de note Google enregistrée. La phrase ci-dessous s\'affichera à la place.';
    $('intro-show-rating').checked = false;
    $('intro-show-rating').disabled = true;
  } else if (note < 4) {
    status.textContent = `Votre note Google actuelle (${note}/5) est inférieure à 4. Pour valoriser votre salon, nous recommandons de masquer la note et d'afficher une phrase commerciale.`;
    $('intro-show-rating').disabled = true;
    $('intro-show-rating').checked = false;
  } else {
    status.textContent = `Votre note Google actuelle : ${note}/5. Vous pouvez choisir de l'afficher ou de la remplacer par une phrase commerciale.`;
    $('intro-show-rating').disabled = false;
  }

  toggleIntroFallback();
  $('intro-show-rating').onchange = toggleIntroFallback;
}

function toggleIntroFallback() {
  const showRating = $('intro-show-rating').checked;
  $('intro-fallback-block').style.display = showRating ? 'none' : 'block';
}

function collectIntro() {
  return {
    title: $('intro-title').value.trim(),
    description: $('intro-description').value.trim(),
    showRating: $('intro-show-rating').checked && state.hasGoogleNote && state.noteAvis >= 4,
    ratingFallback: $('intro-fallback').value.trim()
  };
}

// ----- SERVICES -----
function renderServices(services) {
  const list = $('services-list');
  list.innerHTML = '';
  state.servicesArr = (services.items || []).slice();
  state.servicesArr.forEach((s, i) => list.appendChild(buildServiceRow(s, i)));
  updateServicesCount();
}

function buildServiceRow(s, idx) {
  const row = document.createElement('div');
  row.className = 'service-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <input type="text" placeholder="Nom du service" value="${escapeAttr(s.name || '')}" data-field="name">
    <input type="text" placeholder="Description (optionnelle)" value="${escapeAttr(s.description || '')}" data-field="description">
    <input type="text" placeholder="Tarif" value="${escapeAttr(s.price || '')}" data-field="price">
    <div class="service-actions">
      <button class="btn-icon btn-icon-danger" title="Supprimer ce service" type="button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
  `;
  row.querySelector('.btn-icon-danger').onclick = () => {
    state.servicesArr.splice(idx, 1);
    renderServices({ items: state.servicesArr });
  };
  return row;
}

function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

function updateServicesCount() {
  const n = state.servicesArr.length;
  const el = $('services-count');
  if (n >= 20) el.textContent = `${n} services (maximum atteint)`;
  else el.textContent = `${n} service${n > 1 ? 's' : ''}`;
  $('btn-add-service').disabled = n >= 20;
}

$('btn-add-service').onclick = () => {
  if (state.servicesArr.length >= 20) return;
  state.servicesArr.push({ id: 's' + Date.now(), name: '', description: '', price: '' });
  renderServices({ items: state.servicesArr });
  // Focus le nouveau champ
  const last = $('services-list').lastElementChild;
  last.querySelector('input').focus();
};

function collectServices() {
  const rows = $$('#services-list .service-row');
  const items = rows.map((row, i) => {
    const name = row.querySelector('[data-field="name"]').value.trim();
    const description = row.querySelector('[data-field="description"]').value.trim();
    const price = row.querySelector('[data-field="price"]').value.trim();
    return { id: state.servicesArr[i]?.id || ('s' + Date.now() + i), name, description, price };
  }).filter(s => s.name);
  return { title: 'Nos Services', items };
}

// ----- GALLERY -----
function renderGallery(gallery) {
  // Layout
  $$('input[name="gallery-layout"]').forEach(r => r.checked = (r.value === (gallery.layout || 'grid')));
  state.galleryImages = (gallery.images || []).slice();
  rebuildGalleryTiles();
}

function rebuildGalleryTiles() {
  const list = $('gallery-images-list');
  list.innerHTML = '';
  state.galleryImages.forEach((url, i) => {
    const tile = document.createElement('div');
    tile.className = 'gallery-image-tile';
    tile.innerHTML = `
      <img src="${escapeAttr(url)}" alt="">
      <button class="tile-remove" title="Supprimer" type="button">×</button>
    `;
    tile.querySelector('.tile-remove').onclick = () => {
      state.galleryImages.splice(i, 1);
      rebuildGalleryTiles();
    };
    list.appendChild(tile);
  });

  const limit = 12;
  const reached = state.galleryImages.length >= limit;
  if (!reached) {
    const addTile = document.createElement('div');
    addTile.className = 'gallery-image-tile add-tile';
    addTile.innerHTML = '<span>+</span>';
    addTile.onclick = () => $('gallery-file-input').click();
    list.appendChild(addTile);
  }
  $('gallery-limit-warning').hidden = !reached;
}

$('gallery-file-input').onchange = async (e) => {
  const files = Array.from(e.target.files);
  e.target.value = '';
  if (!files.length) return;

  const limit = 12;
  const remaining = limit - state.galleryImages.length;
  if (remaining <= 0) {
    toast('Limite de 12 photos atteinte.', 'error');
    return;
  }
  const toUpload = files.slice(0, remaining);
  if (files.length > remaining) {
    toast(`Seulement ${remaining} photo(s) ajoutées (limite atteinte).`, 'error');
  } else {
    toast(`Envoi de ${toUpload.length} photo(s)…`, 'success');
  }

  for (const file of toUpload) {
    try {
      const blob = await compressImageFile(file, 1600, 0.82);
      const result = await apiUploadImage(blob, 'gallery');
      state.galleryImages.push(result.url);
      rebuildGalleryTiles();
    } catch (err) {
      toast(`Erreur sur "${file.name}" : ${err.message}`, 'error');
    }
  }
  toast('Photos ajoutées.', 'success');
};

function collectGallery() {
  const layout = $$('input[name="gallery-layout"]').find(r => r.checked)?.value || 'grid';
  return { layout, images: state.galleryImages.slice(), title: 'Galerie' };
}

// ----- TESTIMONIALS -----
function renderTestimonials(testimonials) {
  const list = $('testimonials-list');
  const items = (testimonials.items || []).slice(0, 3);
  while (items.length < 3) items.push({ id: 't' + (items.length+1), text: '', author: '', date: '' });

  list.innerHTML = '';
  items.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'testimonial-row';
    row.innerHTML = `
      <span class="ti-num">${i+1}</span>
      <strong>Avis n°${i+1}</strong>
      <textarea placeholder="Ex : Une expérience top, équipe adorable, je recommande !" data-field="text">${escapeAttr(t.text || '')}</textarea>
      <div class="testimonial-meta">
        <input type="text" placeholder="Prénom + initiale (ex : Marie L.)" data-field="author" value="${escapeAttr(t.author || '')}">
        <input type="text" placeholder="Date (ex : Il y a 2 semaines)" data-field="date" value="${escapeAttr(t.date || '')}">
      </div>
    `;
    list.appendChild(row);
  });
}

function collectTestimonials() {
  const rows = $$('#testimonials-list .testimonial-row');
  const items = rows.map((row, i) => ({
    id: 't' + (i+1),
    text: row.querySelector('[data-field="text"]').value.trim(),
    author: row.querySelector('[data-field="author"]').value.trim(),
    date: row.querySelector('[data-field="date"]').value.trim()
  })).filter(t => t.text);
  return { title: 'Avis Clients', items };
}

// ----- CONTACT + SOCIALS -----
function renderContact(contact, socials) {
  $('contact-address').value = contact.address || '';
  $('contact-address2').value = contact.addressLine2 || '';
  $('contact-phone').value = contact.phone || '';
  $('contact-email').value = contact.email || '';
  if ($('contact-booking-url')) $('contact-booking-url').value = contact.bookingUrl || '';

  const hours = contact.hours || {};
  const hg = $('hours-grid');
  hg.innerHTML = '';
  for (const [k, label] of Object.entries(DAY_LABELS)) {
    const v = hours[k];
    let display = '';
    if (!v || v === 'closed' || v === null) display = 'Fermé';
    else display = String(v).replace(/-am-/g, ':00 - ').replace(/-am$/g, ':00').replace(/-pm-/g, ':00 - ').replace(/-pm$/g, ':00').replace(/^(\d+)(\d{2})/, '$1h$2').replace(/(\d+):00/g, '$1h').replace(/-/g, ' à ');
    const row = document.createElement('label');
    row.innerHTML = `<span class="day">${label}</span><input type="text" data-day="${k}" value="${escapeAttr(display)}" placeholder="Ex : 9h - 18h">`;
    hg.appendChild(row);
  }

  $$('.social-row').forEach(r => {
    const k = r.dataset.social;
    const s = socials[k] || {};
    r.querySelector('input[type="url"]').value = s.url || '';
    r.querySelector('.edit-toggle input').checked = s.enabled !== false && !!s.url;
  });
}

function collectContact() {
  const hours = {};
  $$('.hours-grid input').forEach(inp => {
    const v = inp.value.trim();
    hours[inp.dataset.day] = v && v.toLowerCase() !== 'fermé' && v.toLowerCase() !== 'ferme' ? v : 'closed';
  });
  return {
    address: $('contact-address').value.trim(),
    addressLine2: $('contact-address2').value.trim(),
    phone: $('contact-phone').value.trim(),
    email: $('contact-email').value.trim(),
    bookingUrl: ($('contact-booking-url')?.value || '').trim(),
    hours,
    title: 'Venez nous rendre visite',
    description: state.draft.contact.description,
    latitude: state.draft.contact.latitude,
    longitude: state.draft.contact.longitude
  };
}

function collectSocials() {
  const out = {};
  $$('.social-row').forEach(r => {
    const k = r.dataset.social;
    const url = r.querySelector('input[type="url"]').value.trim();
    const enabled = r.querySelector('.edit-toggle input').checked;
    out[k] = { url, enabled: enabled && !!url };
  });
  return out;
}

// ===========================================================
// SAVE PER SECTION
// ===========================================================
async function save(section) {
  const overrides = {};
  if (section === 'hero') overrides.hero = collectHero();
  if (section === 'intro') overrides.intro = collectIntro();
  if (section === 'services') overrides.services = collectServices();
  if (section === 'gallery') overrides.gallery = collectGallery();
  if (section === 'testimonials') overrides.testimonials = collectTestimonials();
  if (section === 'contact') {
    overrides.contact = collectContact();
    overrides.socials = collectSocials();
  }

  // Merge avec les overrides existants pour ne pas perdre les autres sections
  const existing = state.view.has_overrides ? extractCurrentOverrides() : {};
  const merged = { ...existing, ...overrides };

  const btn = document.querySelector(`.btn-save[data-section="${section}"]`);
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';

  try {
    const res = await apiPut(merged);
    state.view = res.view;
    state.draft = state.view.content;
    toast('Modifications enregistrées ✓', 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// On reconstruit les overrides actuels en re-collectant chaque section depuis l'UI
// (simple et evite de stocker un etat overrides partout)
function extractCurrentOverrides() {
  return {
    hero: collectHero(),
    intro: collectIntro(),
    services: collectServices(),
    gallery: collectGallery(),
    testimonials: collectTestimonials(),
    contact: collectContact(),
    socials: collectSocials()
  };
}

$$('.btn-save').forEach(b => b.onclick = () => save(b.dataset.section));

// ===========================================================
// RESET
// ===========================================================
$('btn-reset').onclick = async () => {
  const ok = await confirmDialog(
    'Tout réinitialiser ?',
    'Toutes vos modifications seront perdues et le site reviendra aux valeurs d\'origine. Continuer ?'
  );
  if (!ok) return;
  try {
    await apiResetOverrides();
    await load();
    toast('Site réinitialisé.', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
};

// ===========================================================
// TABS
// ===========================================================
$$('.edit-tab').forEach(tab => {
  tab.onclick = () => {
    $$('.edit-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    $$('.edit-section').forEach(s => s.classList.toggle('active', s.dataset.section === target));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
});

// ===========================================================
// LOAD
// ===========================================================
async function load() {
  try {
    const view = await apiGet();
    state.view = view;
    state.draft = view.content;
    state.noteAvis = view.note_avis;
    renderAll();
    $('edit-loader').classList.add('fade');
    setTimeout(() => $('edit-loader').remove(), 400);
  } catch (e) {
    document.body.innerHTML = `
      <div style="max-width:480px;margin:80px auto;padding:32px;background:white;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.1);font-family:sans-serif;text-align:center;">
        <h1 style="font-family:'Cormorant Garamond',serif;color:#cf222e;font-size:2rem;margin-bottom:16px;">Accès refusé</h1>
        <p style="color:#6b6b6b;line-height:1.5;">${escapeAttr(e.message)}</p>
        <p style="color:#6b6b6b;font-size:0.9rem;margin-top:16px;">Vérifiez le lien d'édition que vous avez reçu, ou contactez-nous pour en obtenir un nouveau.</p>
      </div>
    `;
  }
}

// ===========================================================
// INIT
// ===========================================================
const parsed = parseUrl();
if (!parsed || !parsed.token) {
  document.body.innerHTML = `<div style="max-width:480px;margin:80px auto;padding:32px;background:white;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.1);font-family:sans-serif;text-align:center;"><h1 style="font-family:'Cormorant Garamond',serif;color:#cf222e;font-size:2rem;">Lien invalide</h1><p style="color:#6b6b6b;">Le token d'édition est manquant. Utilisez le lien fourni dans votre email.</p></div>`;
} else {
  state.slug = parsed.slug;
  state.token = parsed.token;
  load();
}
