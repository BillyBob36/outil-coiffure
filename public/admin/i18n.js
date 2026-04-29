// ====================================================================
// I18N — Outil coiffure admin (FR / EN / ZH)
// ====================================================================

const TRANSLATIONS = {
  fr: {
    // Topbar
    'app.title': 'Outil coiffure',
    'app.logout': 'Déconnexion',

    // Login
    'login.title': 'Outil coiffure',
    'login.subtitle': 'Connexion administrateur',
    'login.email': 'Email',
    'login.password': 'Mot de passe',
    'login.submit': 'Se connecter',
    'login.error_default': 'Erreur de connexion',

    // Stats
    'stats.title': 'Statistiques',
    'stats.total': 'Salons en base',
    'stats.with_screenshot': 'Avec capture',
    'stats.without_screenshot': 'Sans capture',
    'stats.csv_sources': 'Imports CSV',
    'stats.clean_names': 'Noms nettoyés',

    // CSV import
    'csv.title': 'Importer un CSV',
    'csv.choose_file': 'Choisir un fichier',
    'csv.no_file': 'Aucun fichier choisi',
    'csv.source_name_placeholder': 'Nom de la source (ex : coiffeurs-auvergne-ain)',
    'csv.import_btn': 'Importer',
    'csv.importing': 'Import en cours…',

    // Salons table
    'table.title': 'Salons',
    'table.search_placeholder': 'Rechercher (nom, ville, slug)…',
    'table.all_sources': 'Toutes les sources',
    'table.refresh': 'Actualiser',
    'table.batch_screenshots': 'Générer toutes les captures manquantes',
    'table.clean_names': 'Nettoyer les noms (IA)',
    'table.clean_names_tooltip': 'Nettoie les noms à rallonge via IA (Azure GPT)',
    'table.export_csv': 'Exporter CSV enrichi',
    'col.nom_scrappe': 'Nom scrappé',
    'col.nom_final': 'Nom final',
    'col.editable_hint': '(éditable)',
    'col.ville': 'Ville',
    'col.note': 'Note',
    'col.url_landing': 'URL Landing',
    'col.url_edition': 'URL Édition',
    'col.capture': 'Capture',
    'col.actions': 'Actions',
    'cell.no_screenshot': 'non',
    'cell.edit_link': 'Modifier',
    'cell.edit_link_tooltip': 'Lien d\'édition à envoyer au coiffeur',
    'cell.copy_tooltip': 'Copier le lien',

    // Row actions
    'action.capture': 'Capture',
    'action.delete': 'Supprimer',
    'action.deleting': '…',

    // Pagination
    'page.previous': '←',
    'page.next': '→',

    // Modals & confirmations
    'confirm.delete_salon': 'Supprimer {slug} ?',
    'confirm.batch_screenshots': 'Lancer la génération des captures manquantes ?',
    'confirm.batch_screenshots_source': ' (source : {source})',
    'confirm.batch_screenshots_all': ' (toutes sources)',
    'confirm.clean_names_all': 'Lancer le nettoyage IA pour toutes les sources ?',
    'confirm.clean_names_source': 'Lancer le nettoyage IA des noms pour la source "{source}" ?',
    'confirm.clean_names_note': '\n\n(Seuls les noms pas encore nettoyés sont traités.)',
    'msg.no_names_to_clean': 'Aucun nom à nettoyer.',
    'job.status_label': '[{status}] {done}/{total} ({errors} erreurs)',

    // Errors
    'err.generic': 'Erreur',
    'err.empty_field': 'vide',
    'err.saving': '…'
  },

  en: {
    'app.title': 'Hairdresser Tool',
    'app.logout': 'Log out',

    'login.title': 'Hairdresser Tool',
    'login.subtitle': 'Admin login',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.error_default': 'Login error',

    'stats.title': 'Statistics',
    'stats.total': 'Salons in DB',
    'stats.with_screenshot': 'With screenshot',
    'stats.without_screenshot': 'Without screenshot',
    'stats.csv_sources': 'CSV imports',
    'stats.clean_names': 'Cleaned names',

    'csv.title': 'Import a CSV',
    'csv.choose_file': 'Choose file',
    'csv.no_file': 'No file chosen',
    'csv.source_name_placeholder': 'Source name (e.g. hairdressers-region-name)',
    'csv.import_btn': 'Import',
    'csv.importing': 'Importing…',

    'table.title': 'Salons',
    'table.search_placeholder': 'Search (name, city, slug)…',
    'table.all_sources': 'All sources',
    'table.refresh': 'Refresh',
    'table.batch_screenshots': 'Generate all missing screenshots',
    'table.clean_names': 'Clean names (AI)',
    'table.clean_names_tooltip': 'Cleans long names via AI (Azure GPT)',
    'table.export_csv': 'Export enriched CSV',
    'col.nom_scrappe': 'Scraped name',
    'col.nom_final': 'Final name',
    'col.editable_hint': '(editable)',
    'col.ville': 'City',
    'col.note': 'Rating',
    'col.url_landing': 'Landing URL',
    'col.url_edition': 'Edit URL',
    'col.capture': 'Screenshot',
    'col.actions': 'Actions',
    'cell.no_screenshot': 'no',
    'cell.edit_link': 'Edit',
    'cell.edit_link_tooltip': 'Edit link to send to the salon owner',
    'cell.copy_tooltip': 'Copy link',

    'action.capture': 'Capture',
    'action.delete': 'Delete',
    'action.deleting': '…',

    'page.previous': '←',
    'page.next': '→',

    'confirm.delete_salon': 'Delete {slug}?',
    'confirm.batch_screenshots': 'Start generating missing screenshots?',
    'confirm.batch_screenshots_source': ' (source: {source})',
    'confirm.batch_screenshots_all': ' (all sources)',
    'confirm.clean_names_all': 'Start AI cleaning for all sources?',
    'confirm.clean_names_source': 'Start AI cleaning for source "{source}"?',
    'confirm.clean_names_note': '\n\n(Only names not yet cleaned will be processed.)',
    'msg.no_names_to_clean': 'No names to clean.',
    'job.status_label': '[{status}] {done}/{total} ({errors} errors)',

    'err.generic': 'Error',
    'err.empty_field': 'empty',
    'err.saving': '…'
  },

  zh: {
    'app.title': '理发店工具',
    'app.logout': '登出',

    'login.title': '理发店工具',
    'login.subtitle': '管理员登录',
    'login.email': '邮箱',
    'login.password': '密码',
    'login.submit': '登录',
    'login.error_default': '登录错误',

    'stats.title': '统计',
    'stats.total': '数据库中的沙龙',
    'stats.with_screenshot': '已截图',
    'stats.without_screenshot': '未截图',
    'stats.csv_sources': 'CSV 导入',
    'stats.clean_names': '已清理名称',

    'csv.title': '导入 CSV',
    'csv.choose_file': '选择文件',
    'csv.no_file': '未选择文件',
    'csv.source_name_placeholder': '来源名称（例如：理发店-地区-名称）',
    'csv.import_btn': '导入',
    'csv.importing': '导入中…',

    'table.title': '沙龙',
    'table.search_placeholder': '搜索（名称、城市、slug）…',
    'table.all_sources': '所有来源',
    'table.refresh': '刷新',
    'table.batch_screenshots': '生成所有缺失的截图',
    'table.clean_names': '清理名称（AI）',
    'table.clean_names_tooltip': '通过 AI 清理冗长的名称（Azure GPT）',
    'table.export_csv': '导出增强的 CSV',
    'col.nom_scrappe': '抓取的名称',
    'col.nom_final': '最终名称',
    'col.editable_hint': '（可编辑）',
    'col.ville': '城市',
    'col.note': '评分',
    'col.url_landing': '着陆页 URL',
    'col.url_edition': '编辑 URL',
    'col.capture': '截图',
    'col.actions': '操作',
    'cell.no_screenshot': '无',
    'cell.edit_link': '编辑',
    'cell.edit_link_tooltip': '发送给沙龙老板的编辑链接',
    'cell.copy_tooltip': '复制链接',

    'action.capture': '截图',
    'action.delete': '删除',
    'action.deleting': '…',

    'page.previous': '←',
    'page.next': '→',

    'confirm.delete_salon': '删除 {slug}？',
    'confirm.batch_screenshots': '开始生成缺失的截图？',
    'confirm.batch_screenshots_source': '（来源：{source}）',
    'confirm.batch_screenshots_all': '（所有来源）',
    'confirm.clean_names_all': '为所有来源启动 AI 清理？',
    'confirm.clean_names_source': '为来源 "{source}" 启动 AI 清理？',
    'confirm.clean_names_note': '\n\n（仅处理尚未清理的名称。）',
    'msg.no_names_to_clean': '没有需要清理的名称。',
    'job.status_label': '[{status}] {done}/{total}（{errors} 个错误）',

    'err.generic': '错误',
    'err.empty_field': '空',
    'err.saving': '…'
  }
};

// Detection auto : prefere localStorage > navigateur > defaut FR
function detectLang() {
  const stored = localStorage.getItem('outil-coiffure-lang');
  if (stored && TRANSLATIONS[stored]) return stored;
  const browser = (navigator.language || 'fr').toLowerCase();
  if (browser.startsWith('zh')) return 'zh';
  if (browser.startsWith('en')) return 'en';
  return 'fr';
}

let currentLang = detectLang();

export function getCurrentLang() { return currentLang; }

export function setLang(lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  localStorage.setItem('outil-coiffure-lang', lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
  applyTranslations();
}

export function t(key, params = {}) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.fr;
  let s = dict[key] ?? TRANSLATIONS.fr[key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    s = s.replace(`{${k}}`, v);
  }
  return s;
}

// Applique les traductions a tous les elements [data-i18n] et [data-i18n-attr]
export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  // Attributs (placeholder, title, aria-label)
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  // Mise a jour du <title> si la page en a un attribut data
  if (document.body.dataset.i18nTitle) {
    document.title = t(document.body.dataset.i18nTitle);
  }
  // Update active state of language buttons
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === currentLang);
  });
  // Re-render dynamic content if a callback is registered
  if (window.onLangChange) window.onLangChange();
}

// Initialisation
document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : currentLang;
