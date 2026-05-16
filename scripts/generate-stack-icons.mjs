#!/usr/bin/env node
/**
 * Génère 4 pictogrammes 3D or pour la section "Notre stack technique" de la landing.
 *
 * Workflow :
 *   1) Récupère l'icône SVG depuis Iconify
 *   2) Convertit en PNG 1024x1024 (silhouette noire sur fond blanc — ce que Azure attend)
 *   3) Envoie à Azure OpenAI gpt-image-1.5 (deployment "gpt-image-1.5-app-Assets") avec
 *      le prompt "gold" du Asset Generator
 *   4) Sauve le PNG résultant (alpha transparente) dans public/site/landing/stack/
 *   5) Convertit en WebP haute qualité pour réduire la taille
 *
 * Usage :
 *   node scripts/generate-stack-icons.mjs
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'site', 'landing', 'stack');

// ===== Credentials (depuis Assets Générator/.env) =====
const AZURE_ENDPOINT   = 'https://infan-mnisj43h-swedencentral.cognitiveservices.azure.com';
const AZURE_DEPLOYMENT = 'gpt-image-1.5-app-Assets';
const AZURE_API_VERSION= '2025-04-01-preview';
const AZURE_API_KEY    = process.env.AZURE_OPENAI_API_KEY;
if (!AZURE_API_KEY) {
  console.error('Missing AZURE_OPENAI_API_KEY env var. Set it before running.');
  process.exit(1);
}

// ===== Prompt (copié de materials.py:build_prompt('gold')) =====
const GOLD_PROMPT = `Icon asset for a website UI — the output will be composited on any background color, so the icon must be perfectly cut out with NO shadow anywhere around it.
INPUT description: the input image is a black icon silhouette centered on a pure white background. Use the input strictly as the reference SHAPE — keep the same subject and the same silhouette. Do NOT replace the subject with anything else, do NOT invent a new subject, do NOT add extra objects, bubbles, frames, badges, or scenery.
Subject: Re-render that exact icon shape as a 3D object made of polished 24-karat solid gold. deep warm gold tone, mirror-like reflective surface, sharp specular highlights, subtle environmental reflections in warm amber, slight ambient occlusion at the edges, luxury jewelry finish.
Composition: Preserve the EXACT same shape, proportions, and silhouette as the input. The icon is isolated, centered, occupies about 80% of the frame. Head-on square framing, no perspective distortion, no tilt.
Lighting: Even diffuse studio lighting that reveals the material's surface from multiple sides. Form-revealing self-shading IS allowed on the icon itself (so the 3D volume reads). Specular highlights on the material surface are allowed.
Background — STRICTLY ENFORCED: the WHITE input background must be completely REMOVED and REPLACED by FULLY TRANSPARENT pixels (alpha = 0). There is no floor, no plane, no ground, no surface beneath, behind or around the icon. The icon floats in pure transparent space. Do NOT keep any white area, do NOT add any colored area around the icon.
Shadow constraints — STRICTLY ENFORCED:
  - NO drop shadow under or behind the icon.
  - NO cast shadow projected onto any surface.
  - NO contact shadow at the base of the icon.
  - NO soft halo, soft glow, or grey fade in the surrounding pixels.
  - NO ambient-occlusion on a surface below the icon — only on the icon's own internal contours.
  - Every pixel that is not part of the 3D icon material must be 100% transparent (alpha 0), not grey, not faded, not soft-shadowed, not tinted.
Other constraints: No text, no labels, no logos, no watermark, no extra decorative elements, no frames, no circles, no bubbles, no folders, no other shapes besides the icon itself. Sharp clean edges where the material meets fully transparent pixels. Keep the exact silhouette of the input — do not alter the geometry. Original, non-infringing rendering.`;

// ===== Icons à générer =====
// Mapping : section stack technique → icône Iconify cohérente avec le sujet
const ICONS = [
  {
    slug: 'cdn-globe',
    label: 'CDN global Cloudflare',
    iconify: 'tabler:world',            // globe planète avec méridiens
  },
  {
    slug: 'seo-chart',
    label: 'SEO premium intégré',
    iconify: 'tabler:chart-bar',        // chart bars (data / SEO)
  },
  {
    slug: 'eu-server',
    label: 'Hébergement Hetzner UE',
    iconify: 'tabler:server-2',         // serveur stack (hosting)
  },
  {
    slug: 'ssl-shield',
    label: 'SSL automatique + backups',
    iconify: 'tabler:shield-lock',      // bouclier avec cadenas
  },
];

async function fetchIconSvg(iconify) {
  const [prefix, name] = iconify.split(':');
  const url = `https://api.iconify.design/${prefix}/${name}.svg?color=%23000000`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Iconify fetch failed: ${iconify} → ${r.status}`);
  return r.text();
}

async function svgToPng(svg) {
  // Sharp rasterise le SVG en PNG. On va générer 1024x1024 noir sur fond blanc
  // (ce qu'Azure attend).
  // Astuce : on enveloppe le SVG dans un wrapper qui force un padding pour que l'icône
  // occupe ~70% du frame (les SVG Iconify sont edge-to-edge).
  const wrapped = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#ffffff"/>
  <g transform="translate(160 160) scale(29.3)">${svg.replace(/<\?xml[^>]*\?>/, '').replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '')}</g>
</svg>`;
  // The Iconify SVG is normally 24x24. We translate (160,160) and scale 29.3 to fit
  // 24*29.3 = 703 px (= ~70% of 1024). Padding ~160 px around.
  return await sharp(Buffer.from(wrapped)).png().toBuffer();
}

async function azureGenerate(pngInput) {
  const url = `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT}/images/edits?api-version=${AZURE_API_VERSION}`;
  const form = new FormData();
  form.append('image', new Blob([pngInput], { type: 'image/png' }), 'icon.png');
  form.append('prompt', GOLD_PROMPT);
  form.append('size', '1024x1024');
  form.append('quality', 'high');
  form.append('n', '1');
  form.append('output_format', 'png');
  form.append('background', 'transparent');

  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': AZURE_API_KEY },
      body: form,
    });
    if (r.status === 429) {
      const wait = parseInt(r.headers.get('Retry-After') || '6', 10);
      console.log(`  429 rate limit, attente ${wait}s (essai ${attempt+1}/5)`);
      await new Promise(res => setTimeout(res, wait * 1000));
      continue;
    }
    if (r.status >= 500 && attempt < 4) {
      console.log(`  ${r.status}, retry dans ${2**attempt}s`);
      await new Promise(res => setTimeout(res, (2**attempt) * 1000));
      continue;
    }
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Azure ${r.status}: ${t.slice(0, 500)}`);
    }
    const j = await r.json();
    return Buffer.from(j.data[0].b64_json, 'base64');
  }
  throw new Error('Max retries reached');
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Output dir: ${OUT_DIR}`);

  for (const icon of ICONS) {
    console.log(`\n=== ${icon.label} (${icon.iconify}) ===`);
    try {
      console.log('  1. Fetch SVG…');
      const svg = await fetchIconSvg(icon.iconify);

      console.log('  2. SVG → PNG (silhouette noire 1024)…');
      const inputPng = await svgToPng(svg);
      // Save the input for debugging
      await writeFile(join(OUT_DIR, `${icon.slug}.input.png`), inputPng);

      console.log('  3. Azure /images/edits → 3D gold…');
      const t0 = Date.now();
      const goldPng = await azureGenerate(inputPng);
      console.log(`     done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      // Save raw PNG (transparent alpha)
      const outPng = join(OUT_DIR, `${icon.slug}.png`);
      await writeFile(outPng, goldPng);
      console.log(`  4. PNG saved → ${outPng}`);

      // Convert to WebP (smaller)
      const outWebp = join(OUT_DIR, `${icon.slug}.webp`);
      await sharp(goldPng).webp({ quality: 92, alphaQuality: 100 }).toFile(outWebp);
      console.log(`  5. WebP saved → ${outWebp}`);
    } catch (e) {
      console.error(`  ✗ ${icon.slug} FAILED:`, e.message);
    }
  }

  console.log('\n--- Generation complete ---');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
