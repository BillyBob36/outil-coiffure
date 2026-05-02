/**
 * Sémaphore global pour les appels Azure OpenAI.
 *
 * Pourquoi un sémaphore global :
 * - 3 workers Azure peuvent tourner en simultanée (clean_names,
 *   correct_presentation, domain_suggestions).
 * - Chacun lance ~5-6 appels parallèles à Azure quand il tourne seul.
 * - Si les 3 tournent en même temps, on monterait à 15-18 appels concurrents,
 *   ce qui peut déclencher le rate limit Azure (250 req/min sur le deployment).
 *
 * Solution :
 * - Un sémaphore borné à AZURE_MAX_CONCURRENT (défaut 12) qu'utilisent
 *   les 3 workers via `azureSlot(() => callAzure(...))`.
 * - Quand 1 seul worker tourne, il peut prendre jusqu'à 12 slots → throughput max.
 * - Quand 3 tournent, ils se partagent dynamiquement les 12 slots.
 * - File d'attente FIFO : si tous les slots sont pris, l'appelant attend
 *   qu'un slot se libère.
 */

const MAX_CONCURRENT = Math.max(1, parseInt(process.env.AZURE_MAX_CONCURRENT || '12', 10));

let activeCount = 0;
const queue = []; // file d'attente de fonctions resolve()

function acquire() {
  return new Promise(resolve => {
    if (activeCount < MAX_CONCURRENT) {
      activeCount++;
      resolve();
    } else {
      queue.push(resolve);
    }
  });
}

function release() {
  if (queue.length > 0) {
    // Hand off le slot directement au prochain en attente
    const next = queue.shift();
    next();
    // activeCount reste identique (un slot transite d'un appelant à un autre)
  } else {
    activeCount--;
  }
}

/**
 * Wrap une fonction async pour qu'elle prenne un slot Azure pendant son exécution.
 *
 * Usage :
 *   const result = await azureSlot(() => callAzure(items));
 *
 * Le slot est libéré que la promesse réussisse ou échoue.
 */
export async function azureSlot(fn) {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * État courant du sémaphore (pour monitoring/debug).
 */
export function getAzureStats() {
  return {
    active: activeCount,
    queued: queue.length,
    max: MAX_CONCURRENT,
  };
}
