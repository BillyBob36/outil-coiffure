// Wrapper Azure OpenAI pour le photo-picker : gpt-4o vision + text-embed-3-small.
// Porté depuis salon-hero-picker/src/azure-openai.js, adapté :
//   - pas de throw à l'import (le serveur doit booter sans la clé ; les routes
//     renvoient une erreur explicite si la config manque)
//   - API version dédiée possible via AZURE_OPENAI_PICKER_API_VERSION

import { readFileSync } from 'node:fs';

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/?$/, '/');
const KEY = process.env.AZURE_OPENAI_KEY;
const API_VERSION = process.env.AZURE_OPENAI_PICKER_API_VERSION || '2024-10-21';
const DEPLOYMENT_VISION = process.env.AZURE_OPENAI_DEPLOYMENT_VISION || 'gpt-4o';
const DEPLOYMENT_EMBED = process.env.AZURE_OPENAI_DEPLOYMENT_EMBED || 'text-embed-3-small-ACCROCHE';

// Prix indicatifs (mai 2026) pour estimer le coût/scoring.
const PRICE_PER_1M_INPUT_EUR = 4.5;
const PRICE_PER_1M_OUTPUT_EUR = 13.5;
const PRICE_EMBED_PER_1M_EUR = 0.02;

export function isPickerAiConfigured() {
  return !!(ENDPOINT && KEY);
}

export function estimateCostEur({ inputTokens, outputTokens }) {
  return (
    (inputTokens || 0) * PRICE_PER_1M_INPUT_EUR / 1_000_000 +
    (outputTokens || 0) * PRICE_PER_1M_OUTPUT_EUR / 1_000_000
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fileToDataUrl(filePath) {
  const buf = readFileSync(filePath);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function azureCall(deployment, path, body, { retries = 3 } = {}) {
  if (!isPickerAiConfigured()) {
    throw new Error('AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY non configurés sur ce serveur');
  }
  const url = `${ENDPOINT}openai/deployments/${deployment}/${path}?api-version=${API_VERSION}`;
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': KEY },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status === 503) {
        const wait = 2000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
        console.warn(`[picker-azure] ${res.status}, retry in ${wait}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Azure ${res.status}: ${errBody.slice(0, 300)}`);
      }
      return await res.json();
    } catch (e) {
      lastError = e;
      if (attempt < retries - 1) await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

/**
 * Vision call avec structured output JSON. Si une image a un `label`, on insère
 * ce label en bloc texte JUSTE AVANT l'image (ancrage anti-confusion d'ordre).
 */
export async function callVision({ systemPrompt, userText, images = [], maxTokens = 1500, temperature = 0.2 }) {
  const userContent = [{ type: 'text', text: userText }];
  for (const img of images) {
    if (img.label) userContent.push({ type: 'text', text: img.label });
    const url = img.type === 'image_path' ? fileToDataUrl(img.value) : img.value;
    userContent.push({ type: 'image_url', image_url: { url, detail: img.detail || 'auto' } });
  }
  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
    temperature,
  };
  const t0 = Date.now();
  const resp = await azureCall(DEPLOYMENT_VISION, 'chat/completions', body);
  const latency_ms = Date.now() - t0;
  const rawContent = resp.choices?.[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`Réponse non-JSON parsable: ${rawContent.slice(0, 200)}`);
  }
  const usage = resp.usage || {};
  return {
    content: parsed,
    raw: rawContent,
    usage,
    model: resp.model,
    latency_ms,
    cost_eur: estimateCostEur({ inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }),
    finish_reason: resp.choices?.[0]?.finish_reason,
  };
}

export async function callEmbedding(text) {
  const resp = await azureCall(DEPLOYMENT_EMBED, 'embeddings', { input: text });
  const vector = resp.data?.[0]?.embedding || [];
  const tokens = resp.usage?.total_tokens || 0;
  return { vector, dims: vector.length, tokens, cost_eur: tokens * PRICE_EMBED_PER_1M_EUR / 1_000_000 };
}
