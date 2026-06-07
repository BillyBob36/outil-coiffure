// Rattrapage des 10 salons Bretagne dont la suggestion de domaine a échoué
// (timeouts/429 transitoires pendant le gros run). force=true pour régénérer.
// Exécution : docker exec <helsinki-container> node /app/retry-domains-bretagne.cjs

(async () => {
  const mod = await import('/app/src/domain-suggester.js');
  const slugs = [
    'breal-sous-montfort-stylcoiffure',
    'breteil-le-salon-de-rose-et-julie',
    'cancale-lhair-du-large',
    'corps-nuds-maryvonne-simon-avantif-corps-nuds',
    'dol-de-bretagne-excell-coiffure',
    'le-vivier-sur-mer-ei-excell-coiffure',
    'montauban-de-bretagne-blkcoiffure',
    'montfort-sur-meu-stratosphair-coiffeur-mixte-barbier-evenementiel',
    'mordelles-le-temps-d-une-pause',
    'mordelles-lle-salon',
  ];

  const { jobId, total } = await mod.startDomainSuggestions({ slugs, force: true });
  console.log('Job lancé:', jobId, '| total:', total);

  // Poll jusqu'à fin
  while (true) {
    const job = mod.getDomainSuggestionsJob(jobId);
    if (!job) { console.log('Job introuvable'); break; }
    if (job.status === 'finished' || job.status === 'error') {
      console.log(`FINI: status=${job.status} done=${job.done}/${job.total} updated=${job.updated} errors=${job.errors}`);
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Vérif finale
  const Database = require('better-sqlite3');
  const db = new Database('/data/salons.db', { readonly: true });
  const ph = slugs.map(() => '?').join(',');
  const ok = db.prepare(`SELECT COUNT(*) c FROM salons WHERE slug IN (${ph}) AND domain_suggestions_json IS NOT NULL AND domain_suggestions_json != ''`).all
    ? db.prepare(`SELECT COUNT(*) c FROM salons WHERE slug IN (${ph}) AND domain_suggestions_json IS NOT NULL AND domain_suggestions_json != ''`).get(...slugs).c
    : 0;
  console.log(`Vérif: ${ok}/${slugs.length} ont désormais des suggestions de domaine`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
