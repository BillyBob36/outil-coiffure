// Nav admin unifiée : surligne l'onglet courant + câble la déconnexion.
// Chargé sur toutes les pages admin. S'appuie sur les data-path des .anav-tab.
(function () {
  var path = (location.pathname || '/admin').replace(/\/+$/, '') || '/admin';
  var best = null, bestLen = -1;
  Array.prototype.forEach.call(document.querySelectorAll('.anav-tab'), function (t) {
    var p = (t.getAttribute('data-path') || '').replace(/\/+$/, '');
    if (!p) return;
    if ((path === p || path.indexOf(p + '/') === 0 || path.indexOf(p) === 0) && p.length > bestLen) {
      best = t; bestLen = p.length;
    }
  });
  if (best) best.classList.add('active');

  var lo = document.getElementById('anav-logout');
  if (lo) lo.addEventListener('click', function (e) {
    e.preventDefault();
    fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' })
      .catch(function () {})
      .then(function () { location.href = '/admin/login'; });
  });

  var LANG_KEY = 'outil-coiffure-lang';
  var curLang = 'fr';
  try { curLang = localStorage.getItem(LANG_KEY) || 'fr'; } catch (e) {}
  Array.prototype.forEach.call(document.querySelectorAll('.anav .lang-btn'), function (b) {
    b.classList.toggle('active', b.getAttribute('data-lang') === curLang);
    b.addEventListener('click', function () {
      try { localStorage.setItem(LANG_KEY, b.getAttribute('data-lang')); } catch (e) {}
      location.reload();
    });
  });
})();
