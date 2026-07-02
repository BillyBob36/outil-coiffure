/* =====================================================================
   Arbre de conversation d'appel — MaQuickPage (vente de sites aux coiffeurs)
   Source unique de vérité pour : le mode guidé (page + panneau cockpit),
   la vue carte, et le catalogue envoyé au copilote IA.
   Chaque nœud : { id, phase, label, summary, say, tip?, branches:[{label,to}] }
   ===================================================================== */
(function (global) {
  'use strict';

  var NODES = {
    start: {
      id: 'start', phase: 'Ouverture', label: 'Qui décroche ?',
      summary: 'Filtrer standard/employé vs gérant',
      say: "Bonjour ! Je cherche à joindre le ou la responsable du salon, s'il vous plaît ?",
      branches: [
        { label: "C'est moi / le gérant", to: 'opener' },
        { label: 'Employé / standard', to: 'gatekeeper' },
        { label: "Pas là maintenant", to: 'callback' },
      ],
    },
    gatekeeper: {
      id: 'gatekeeper', phase: 'Ouverture', label: 'Barrage (employé)',
      summary: 'Passer au décideur sans forcer',
      say: "Je comprends. Quel serait le meilleur moment pour joindre le responsable ? Je rappellerai avec plaisir — c'est au sujet du site internet du salon.",
      branches: [
        { label: 'Passe le gérant', to: 'opener' },
        { label: 'Donne un créneau', to: 'callback' },
        { label: 'Refuse / filtre', to: 'end_npr' },
      ],
    },
    opener: {
      id: 'opener', phase: 'Ouverture', label: 'Accroche + permission (30 s)',
      summary: 'Se présenter, la raison, demander 30 secondes',
      say: "Bonjour [NOM], [TOI] de MaQuickPage. Je vous appelle parce qu'on a déjà créé un site web de démonstration pour votre salon, à partir de votre fiche Google. Vous avez 30 secondes pour que je vous dise où le voir ?",
      tip: "Souris en parlant, débit posé. Ne dis JAMAIS « je vous dérange ? » ou « c'est le bon moment ? ».",
      branches: [
        { label: "Oui / d'accord", to: 'pitch' },
        { label: "C'est quoi ?", to: 'pitch' },
        { label: 'Pas le temps', to: 'obj_temps' },
        { label: 'Pas intéressé', to: 'obj_besoin' },
        { label: "C'est de la pub ?", to: 'obj_arnaque' },
      ],
    },
    pitch: {
      id: 'pitch', phase: 'Pitch', label: 'Le pitch — « c\'est déjà fait »',
      summary: 'Bénéfice + prix léger + proposer de regarder',
      say: "En fait votre site est déjà prêt : vos photos, vos horaires, vos avis Google, tout y est. Vous le regardez, et s'il vous plaît vous le gardez pour une dizaine d'euros par mois — sinon vous ne payez rien. Je vous envoie le lien pour que vous jugiez ?",
      branches: [
        { label: 'Oui, envoyez', to: 'close_link' },
        { label: 'Intéressé / curieux', to: 'close_link' },
        { label: "J'ai déjà un site", to: 'obj_deja_site' },
        { label: 'Ça coûte combien ?', to: 'obj_prix' },
        { label: 'Pas besoin', to: 'obj_besoin' },
        { label: 'Envoyez un mail', to: 'close_link' },
      ],
    },
    obj_temps: {
      id: 'obj_temps', phase: 'Objection', label: '« Pas le temps »',
      summary: 'Reconnaître + tout est déjà fait + envoyer le lien',
      say: "Je comprends, vous êtes sûrement en plein rush. Justement, tout est déjà fait de mon côté : je vous envoie le lien par SMS, vous le regardez ce soir tranquillement. C'est quoi votre numéro ?",
      branches: [
        { label: 'OK, donne le numéro', to: 'close_link' },
        { label: 'Toujours non', to: 'obj_besoin' },
        { label: 'Rappelez plus tard', to: 'callback' },
      ],
    },
    obj_deja_site: {
      id: 'obj_deja_site', phase: 'Objection', label: '« J\'ai déjà un site »',
      summary: 'Explorer puis inviter à comparer 2 min',
      say: "Ah, super. Il est à jour et vous en êtes content ? … Comparez juste 2 minutes avec le nôtre : beaucoup le trouvent plus moderne, et souvent 3 fois moins cher. Je vous envoie le lien, vous me direz ce que vous en pensez ?",
      branches: [
        { label: 'OK, je compare', to: 'close_link' },
        { label: "J'en suis content", to: 'obj_besoin' },
        { label: 'Combien le vôtre ?', to: 'obj_prix' },
      ],
    },
    obj_prix: {
      id: 'obj_prix', phase: 'Objection', label: '« Ça coûte combien ? »',
      summary: 'Ancrer bas, sans engagement, regarder d\'abord',
      say: "De 9,90 à 29 € par mois selon la formule, avec une option sans engagement. Mais honnêtement, regardez d'abord le site : s'il ne vous plaît pas, la question du prix ne se pose même pas. Je vous l'envoie ?",
      branches: [
        { label: 'OK, envoyez', to: 'close_link' },
        { label: 'Trop cher', to: 'obj_besoin' },
        { label: 'Je vais réfléchir', to: 'callback' },
      ],
    },
    obj_besoin: {
      id: 'obj_besoin', phase: 'Objection', label: '« Pas besoin / pas envie »',
      summary: 'Poke the bear : les clients cherchent sur Google',
      say: "Je comprends. Juste un chiffre : 7 personnes sur 10 regardent Google avant de choisir un coiffeur. Sans site à jour, elles vont souvent chez le voisin. Ça vaut le coup d'y jeter un œil, non ? Je vous envoie le lien, ça ne vous engage à rien.",
      branches: [
        { label: "OK, d'accord", to: 'close_link' },
        { label: 'Non merci', to: 'end_lost' },
        { label: 'Ne me rappelez plus', to: 'end_npr' },
      ],
    },
    obj_arnaque: {
      id: 'obj_arnaque', phase: 'Objection', label: '« C\'est de la pub / une arnaque »',
      summary: 'Rassurer, s\'identifier, proposer de juger',
      say: "Je comprends la méfiance, c'est normal. Je suis [TOI], de MaQuickPage — on a vraiment créé le site à partir de votre fiche Google, et regarder ne coûte rien. Je vous envoie le lien, vous jugez par vous-même. D'accord ?",
      branches: [
        { label: 'OK, montrez', to: 'close_link' },
        { label: 'Non', to: 'end_lost' },
      ],
    },
    close_link: {
      id: 'close_link', phase: 'Closing', label: 'Envoyer le lien (le prochain pas)',
      summary: 'Récupérer le canal + programmer le rappel',
      say: "Parfait ! Je vous envoie le lien tout de suite. Vous préférez par SMS ou par e-mail ? … Super. Et je vous rappelle dans 2 jours pour recueillir votre avis, ça vous va ?",
      tip: 'Note le numéro/e-mail et programme le rappel dans le cockpit. Envoie le lien PENDANT l\'appel.',
      branches: [
        { label: 'Accepte le rappel', to: 'end_win' },
        { label: 'Regardera de lui-même', to: 'end_win' },
        { label: 'Finalement non', to: 'obj_besoin' },
      ],
    },
    callback: {
      id: 'callback', phase: 'Closing', label: 'Rappel à programmer',
      summary: 'Convenir d\'un créneau précis',
      say: "Aucun souci. Quel est le meilleur moment pour vous rappeler ? Je le note et je vous rappelle pile à ce moment-là.",
      branches: [
        { label: 'Donne un créneau', to: 'end_win' },
        { label: 'Refuse', to: 'end_lost' },
      ],
    },
    end_win: {
      id: 'end_win', phase: 'Fin', label: '✅ Prochain pas obtenu',
      summary: 'Lien envoyé / rappel calé',
      say: "Bravo ! Dans le cockpit : marque « Démo envoyée » ou « À rappeler » + la date. Et envoie le lien immédiatement, tant que c'est chaud.",
      branches: [],
    },
    end_lost: {
      id: 'end_lost', phase: 'Fin', label: 'Perdu (pour l\'instant)',
      summary: 'Pas intéressé aujourd\'hui',
      say: "OK. Marque « Pas intéressé ». Un « non » = un « pas maintenant » : tu pourras retenter dans quelques semaines.",
      branches: [],
    },
    end_npr: {
      id: 'end_npr', phase: 'Fin', label: '🚫 Ne pas rappeler',
      summary: 'Opposition définitive (on respecte)',
      say: "Note « Ne pas rappeler » dans le cockpit — on respecte, il ne ressortira plus jamais dans la file d'appel.",
      branches: [],
    },
  };

  var TREE = {
    startId: 'start',
    nodes: NODES,
    // Ordre des phases pour la vue carte.
    phases: ['Ouverture', 'Pitch', 'Objection', 'Closing', 'Fin'],
    // Catalogue compact (id/label/summary) pour le copilote IA.
    catalog: function () {
      return Object.keys(NODES).map(function (k) {
        return { id: NODES[k].id, label: NODES[k].label, summary: NODES[k].summary };
      });
    },
  };

  /* --------- Mode guidé : monte le composant dans un conteneur ----------
     mountGuided(el, opts) → contrôleur { goTo(id), current(), reset() }
     opts.onNode(node) : callback à chaque changement de nœud.        */
  function esc(s) { return s == null ? '' : String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function mountGuided(el, opts) {
    opts = opts || {};
    var history = [];
    var currentId = TREE.startId;

    function render() {
      var n = NODES[currentId] || NODES[TREE.startId];
      var isEnd = !n.branches || !n.branches.length;
      var h = '';
      h += '<div class="cg-top">';
      h += '<span class="cg-phase cg-ph-' + esc(n.phase) + '">' + esc(n.phase) + '</span>';
      if (history.length) h += '<button class="cg-nav" data-back="1">← Retour</button>';
      h += '<button class="cg-nav" data-restart="1">↺ Recommencer</button>';
      h += '</div>';
      h += '<div class="cg-label">' + esc(n.label) + '</div>';
      h += '<div class="cg-say">' + esc(n.say) + '</div>';
      if (n.tip) h += '<div class="cg-tip">💡 ' + esc(n.tip) + '</div>';
      if (isEnd) {
        h += '<div class="cg-end">— fin de branche —</div>';
      } else {
        h += '<div class="cg-branch-lab">Le prospect répond…</div><div class="cg-branches">';
        n.branches.forEach(function (b, i) {
          h += '<button class="cg-branch" data-to="' + esc(b.to) + '" data-i="' + i + '">' + esc(b.label) + '</button>';
        });
        h += '</div>';
      }
      el.innerHTML = h;

      Array.prototype.forEach.call(el.querySelectorAll('[data-to]'), function (btn) {
        btn.onclick = function () { go(btn.getAttribute('data-to')); };
      });
      var bk = el.querySelector('[data-back]'); if (bk) bk.onclick = function () { back(); };
      var rs = el.querySelector('[data-restart]'); if (rs) rs.onclick = function () { reset(); };

      if (opts.onNode) try { opts.onNode(n); } catch (e) {}
    }

    function go(id) { if (!NODES[id]) return; history.push(currentId); currentId = id; render(); }
    function back() { if (history.length) { currentId = history.pop(); render(); } }
    function reset() { history = []; currentId = TREE.startId; render(); }
    function goTo(id) { // saut direct (copilote) — enregistre l'historique
      if (!NODES[id] || id === currentId) return; history.push(currentId); currentId = id; render();
    }

    render();
    return { goTo: goTo, current: function () { return NODES[currentId]; }, reset: reset };
  }

  global.CALL_TREE = TREE;
  global.mountGuided = mountGuided;
})(window);
