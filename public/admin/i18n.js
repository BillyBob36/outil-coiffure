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
    'msg.all_clean_already': 'Tous les noms sont déjà nettoyés ({total}/{total}).',
    'msg.force_clean_question': 'Voulez-vous re-traiter tous les noms (utile si le prompt a été amélioré) ?',
    'job.status_label': '[{status}] {done}/{total} ({errors} erreurs)',

    // Groupes
    'groups.title': 'Groupes',
    'groups.help': 'Organisez vos imports CSV en projets distincts. Chaque groupe est sauvegardé automatiquement et accessible plus tard.',
    'groups.all_salons': 'Tous les salons',
    'groups.without_group': 'Salons sans groupe',
    'groups.orphan_help': 'Ces salons ne sont rattachés à aucun groupe. Créez un groupe et assignez-les depuis le filtre de source.',
    'groups.new': 'Nouveau groupe',
    'groups.rename': 'Renommer',
    'groups.rename_tooltip': 'Renommer ce groupe',
    'groups.delete': 'Supprimer',
    'groups.delete_tooltip': 'Supprimer ce groupe (les salons restent dans la base)',
    'groups.salons_label': 'salons',
    'groups.sources_label': 'imports CSV',
    'groups.import_no_group': '— Aucun groupe (par défaut) —',
    'groups.prompt_new_name': 'Nom du nouveau groupe :',
    'groups.prompt_new_description': 'Description (optionnelle) :',
    'groups.prompt_rename': 'Nouveau nom du groupe :',
    'groups.confirm_delete': 'Supprimer le groupe « {name} » ?\n\nLes {count} salons qu\'il contient ne seront PAS supprimés — ils retourneront simplement dans « Salons sans groupe ».',

    // Bulk actions
    'bulk.count_label': '{count} salons correspondent au filtre actif',
    'bulk.move': 'Déplacer',
    'bulk.delete': 'Supprimer',
    'bulk.choose_target': '— Choisir un groupe cible —',
    'bulk.target_no_group': 'Retirer du groupe (devient « sans groupe »)',
    'bulk.confirm_move': 'Déplacer {count} salons vers « {target} » ?',
    'bulk.moved_success': '{count} salons déplacés avec succès.',
    'bulk.confirm_delete_1': 'Supprimer définitivement {count} salons ?\n\nCette action est irréversible — toutes les données, captures et personnalisations seront perdues.',
    'bulk.confirm_delete_2': 'Vraiment ? Tape sur OK pour confirmer définitivement.',
    'bulk.deleted_success': '{count} salons supprimés.',

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
    'msg.all_clean_already': 'All names have been cleaned already ({total}/{total}).',
    'msg.force_clean_question': 'Do you want to re-process all names (useful if the prompt was improved)?',
    'job.status_label': '[{status}] {done}/{total} ({errors} errors)',

    // Groups
    'groups.title': 'Groups',
    'groups.help': 'Organize your CSV imports into distinct projects. Each group is saved automatically and can be reopened later.',
    'groups.all_salons': 'All salons',
    'groups.without_group': 'Salons without group',
    'groups.orphan_help': 'These salons are not assigned to any group. Create a group and assign them via the source filter.',
    'groups.new': 'New group',
    'groups.rename': 'Rename',
    'groups.rename_tooltip': 'Rename this group',
    'groups.delete': 'Delete',
    'groups.delete_tooltip': 'Delete this group (salons stay in the database)',
    'groups.salons_label': 'salons',
    'groups.sources_label': 'CSV imports',
    'groups.import_no_group': '— No group (default) —',
    'groups.prompt_new_name': 'Name of the new group:',
    'groups.prompt_new_description': 'Description (optional):',
    'groups.prompt_rename': 'New name for the group:',
    'groups.confirm_delete': 'Delete group "{name}"?\n\nThe {count} salons it contains will NOT be deleted — they will simply return to "Salons without group".',

    // Bulk actions
    'bulk.count_label': '{count} salons match the active filter',
    'bulk.move': 'Move',
    'bulk.delete': 'Delete',
    'bulk.choose_target': '— Choose a target group —',
    'bulk.target_no_group': 'Remove from group (becomes "without group")',
    'bulk.confirm_move': 'Move {count} salons to "{target}"?',
    'bulk.moved_success': '{count} salons moved successfully.',
    'bulk.confirm_delete_1': 'Permanently delete {count} salons?\n\nThis action cannot be undone — all data, screenshots and customizations will be lost.',
    'bulk.confirm_delete_2': 'Really? Click OK to confirm permanently.',
    'bulk.deleted_success': '{count} salons deleted.',

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
    'msg.all_clean_already': '所有名称已经清理（{total}/{total}）。',
    'msg.force_clean_question': '是否重新处理所有名称（在提示语改进后很有用）？',
    'job.status_label': '[{status}] {done}/{total}（{errors} 个错误）',

    // 分组
    'groups.title': '分组',
    'groups.help': '将您的 CSV 导入组织到不同的项目中。每个分组都会自动保存，以便日后访问。',
    'groups.all_salons': '所有沙龙',
    'groups.without_group': '未分组的沙龙',
    'groups.orphan_help': '这些沙龙未分配到任何分组。创建一个分组并通过来源筛选器进行分配。',
    'groups.new': '新建分组',
    'groups.rename': '重命名',
    'groups.rename_tooltip': '重命名此分组',
    'groups.delete': '删除',
    'groups.delete_tooltip': '删除此分组（沙龙仍保留在数据库中）',
    'groups.salons_label': '沙龙',
    'groups.sources_label': 'CSV 导入',
    'groups.import_no_group': '— 无分组（默认）—',
    'groups.prompt_new_name': '新分组的名称：',
    'groups.prompt_new_description': '描述（可选）：',
    'groups.prompt_rename': '分组的新名称：',
    'groups.confirm_delete': '删除分组 "{name}"？\n\n其中包含的 {count} 个沙龙不会被删除——它们将回到"未分组的沙龙"。',

    // 批量操作
    'bulk.count_label': '{count} 个沙龙符合当前筛选条件',
    'bulk.move': '移动',
    'bulk.delete': '删除',
    'bulk.choose_target': '— 选择目标分组 —',
    'bulk.target_no_group': '从分组中移除（变为"未分组"）',
    'bulk.confirm_move': '将 {count} 个沙龙移动到 "{target}"？',
    'bulk.moved_success': '已成功移动 {count} 个沙龙。',
    'bulk.confirm_delete_1': '永久删除 {count} 个沙龙？\n\n此操作无法撤销 — 所有数据、截图和自定义内容都将丢失。',
    'bulk.confirm_delete_2': '确定吗？点击"确定"以确认永久删除。',
    'bulk.deleted_success': '已删除 {count} 个沙龙。',

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
