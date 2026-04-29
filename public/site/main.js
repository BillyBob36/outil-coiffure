const DEFAULT_GALLERY = [
  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&q=80',
  'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&q=80',
  'https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=600&q=80',
  'https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?w=600&q=80',
  'https://images.unsplash.com/photo-1634449571010-02389ed0f9b0?w=600&q=80',
  'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=600&q=80'
];

const DAY_LABELS = {
  monday: 'Lundi', tuesday: 'Mardi', wednesday: 'Mercredi',
  thursday: 'Jeudi', friday: 'Vendredi', saturday: 'Samedi', sunday: 'Dimanche'
};

function getSlugFromUrl() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!path || path === 'index.html') return null;
  return path.split('/')[0];
}

async function fetchSalon(slug) {
  const res = await fetch(`/api/salon/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error('Salon introuvable');
  return res.json();
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el && text != null) el.textContent = text;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el && html != null) el.innerHTML = html;
}

function buildShortName(nom) {
  if (!nom) return { main: 'Salon', sub: 'Coiffure' };
  const cleaned = nom.replace(/\s*-\s*(coiffeur|coiffure|salon de coiffure|hairdresser|barber).*/i, '').trim();
  const words = cleaned.split(/\s+/);
  if (words.length === 1) return { main: words[0], sub: 'Coiffure' };
  if (words.length === 2) return { main: words[0], sub: words[1] };
  const mid = Math.ceil(words.length / 2);
  return { main: words.slice(0, mid).join(' '), sub: words.slice(mid).join(' ') };
}

function formatHours(json) {
  if (!json) return '<p>Sur rendez-vous</p>';
  const rows = [];
  for (const [k, label] of Object.entries(DAY_LABELS)) {
    const v = json[k];
    if (!v || v === 'closed' || v === null) {
      rows.push(`<div class="day">${label}</div><div class="hours closed">Fermé</div>`);
    } else {
      const human = String(v)
        .replace(/-am-/g, ':00 - ')
        .replace(/-am$/g, ':00')
        .replace(/-pm-/g, ':00 - ')
        .replace(/-pm$/g, ':00')
        .replace(/^(\d+)(\d{2})/, '$1h$2')
        .replace(/(\d+):00/g, '$1h')
        .replace(/-/g, ' à ');
      rows.push(`<div class="day">${label}</div><div class="hours">${human}</div>`);
    }
  }
  return `<div class="opening-hours-table">${rows.join('')}</div>`;
}

function buildSocialIcons(salon) {
  const links = [];
  if (salon.lien_facebook) links.push({ url: salon.lien_facebook, name: 'Facebook', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>' });
  if (salon.lien_instagram) links.push({ url: salon.lien_instagram, name: 'Instagram', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.5" y2="6.51"/></svg>' });
  if (salon.lien_tiktok) links.push({ url: salon.lien_tiktok, name: 'TikTok', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.16a8.16 8.16 0 0 0 4.77 1.52V6.23a4.85 4.85 0 0 1-1.84-.54z"/></svg>' });
  if (salon.lien_youtube) links.push({ url: salon.lien_youtube, name: 'YouTube', svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.6-.46-5.32a2.78 2.78 0 0 0-2-2C18.84 4.27 12 4.27 12 4.27s-6.84 0-8.54.46a2.78 2.78 0 0 0-2 2A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.33 2.78 2.78 0 0 0 2 1.95c1.7.47 8.54.47 8.54.47s6.84 0 8.54-.47a2.78 2.78 0 0 0 2-1.95C23 15.6 23 12 23 12z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="#fff"/></svg>' });
  return links.map(l => `<a href="${l.url}" target="_blank" rel="noopener" aria-label="${l.name}">${l.svg}</a>`).join('');
}

function googleRatingHtml(salon) {
  if (!salon.note_avis) return '';
  const stars = '★'.repeat(Math.round(salon.note_avis)) + '☆'.repeat(5 - Math.round(salon.note_avis));
  const count = salon.nb_avis || '';
  return `<div class="google-rating"><span class="stars">${stars}</span><span class="score">${salon.note_avis}/5</span>${count ? `<span class="count">sur ${count} avis Google</span>` : ''}</div>`;
}

function buildTestimonialsFromGoogle(salon) {
  const slider = document.getElementById('testimonials-slider');
  if (!slider) return;
  if (salon.note_avis) {
    const stars = Math.round(salon.note_avis);
    slider.innerHTML = `
      <div class="testimonial-card">
        <div class="testimonial-stars">
          ${'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'.repeat(stars)}
        </div>
        <p class="testimonial-text">"${salon.note_avis}/5 sur Google${salon.nb_avis ? ` — ${salon.nb_avis} avis` : ''}. Découvrez l'avis de nos clients sur notre fiche Google."</p>
        <div class="testimonial-author">
          <span class="author-name">Note Google</span>
          <span class="author-date">Aujourd'hui</span>
        </div>
      </div>`;
  } else {
    slider.innerHTML = `
      <div class="testimonial-card">
        <p class="testimonial-text">"Notre équipe est à votre écoute pour vous offrir le meilleur service. N'hésitez pas à nous contacter."</p>
        <div class="testimonial-author"><span class="author-name">L'équipe</span></div>
      </div>`;
  }
}

function buildGallery(salon) {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  const images = [...DEFAULT_GALLERY];
  if (salon.meta_image) images.unshift(salon.meta_image);
  grid.innerHTML = images.slice(0, 6).map((img, i) => `
    <div class="gallery-item" data-index="${i}">
      <img src="${img}" alt="Réalisation ${i+1}" loading="lazy">
      <div class="gallery-overlay"><span style="color: white; font-size: 0.8rem; letter-spacing: 1px;">AGRANDIR</span></div>
    </div>
  `).join('');
}

function renderSalon(salon) {
  const shortName = buildShortName(salon.nom);
  const ville = salon.ville || '';

  document.title = `${salon.nom}${ville ? ` — ${ville}` : ''}`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    metaDesc.content = salon.meta_description || `${salon.nom}${ville ? ` à ${ville}` : ''}. Salon de coiffure, prenez rendez-vous facilement.`;
  }

  setText('logo-text', shortName.main);
  setText('logo-sub', shortName.sub);
  setText('footer-logo-text', shortName.main);
  setText('footer-logo-sub', shortName.sub);
  setText('footer-name', salon.nom);
  setText('footer-tagline', `Votre salon de coiffure${ville ? ` à ${ville}` : ''}`);
  setText('footer-year', new Date().getFullYear());

  setText('hero-tagline', `Bienvenue chez`);
  setText('hero-title', salon.nom);
  setText('hero-subtitle', ville ? `Salon de coiffure à ${ville}` : 'Votre coiffeur de proximité');

  setHtml('google-rating-container', googleRatingHtml(salon));

  setText('intro-title', `Bienvenue ${ville ? `à ${ville}` : ''}`);
  setText('intro-description', salon.meta_description || `Notre équipe vous accueille ${ville ? `à ${ville} ` : ''}pour vous offrir des prestations de coiffure soignées dans une ambiance chaleureuse. Nous mettons notre savoir-faire au service de votre style.`);
  setText('stat-rating', salon.note_avis ? `${salon.note_avis}/5` : '—');
  setText('stat-reviews', salon.nb_avis || '—');

  buildGallery(salon);
  buildTestimonialsFromGoogle(salon);

  const reviewsLink = document.getElementById('google-reviews-link');
  if (reviewsLink && salon.lien_google_maps) reviewsLink.href = salon.lien_google_maps;

  const addressParts = [salon.adresse, salon.code_postal && salon.ville ? `${salon.code_postal} ${salon.ville}` : (salon.code_postal || salon.ville)].filter(Boolean);
  setHtml('contact-address', addressParts.join('<br>') || 'Adresse non renseignée');

  if (salon.telephone) {
    const phoneEl = document.getElementById('contact-phone');
    phoneEl.textContent = salon.telephone;
    phoneEl.href = `tel:${salon.telephone.replace(/\s/g, '')}`;
    const navCta = document.getElementById('nav-cta');
    if (navCta) navCta.href = `tel:${salon.telephone.replace(/\s/g, '')}`;
  } else {
    document.getElementById('contact-phone-block').style.display = 'none';
  }

  if (salon.email) {
    const emailEl = document.getElementById('contact-email');
    emailEl.textContent = salon.email;
    emailEl.href = `mailto:${salon.email}`;
  } else {
    document.getElementById('contact-email-block').style.display = 'none';
  }

  setHtml('contact-hours', formatHours(salon.heures_ouverture));

  const socials = buildSocialIcons(salon);
  setHtml('social-icons', socials);
  setHtml('footer-social', socials);

  const mapIframe = document.getElementById('map-iframe');
  if (mapIframe) {
    if (salon.latitude && salon.longitude) {
      mapIframe.src = `https://maps.google.com/maps?q=${salon.latitude},${salon.longitude}&z=15&output=embed`;
    } else if (addressParts.length) {
      mapIframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(addressParts.join(', '))}&z=15&output=embed`;
    }
  }
}

function setupNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;
  window.addEventListener('scroll', () => {
    if (window.pageYOffset > 50) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  });
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        window.scrollTo({ top: target.getBoundingClientRect().top + window.pageYOffset - 80, behavior: 'smooth' });
      }
    });
  });
}

(async () => {
  setupNavbar();
  const slug = getSlugFromUrl();
  if (!slug) return;
  try {
    const salon = await fetchSalon(slug);
    renderSalon(salon);
  } catch (e) {
    console.error('Erreur chargement salon:', e);
  } finally {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      setTimeout(() => overlay.classList.add('fade'), 100);
      setTimeout(() => overlay.remove(), 500);
    }
  }
})();
