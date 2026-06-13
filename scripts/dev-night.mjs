// Lanceur de test local pour la feature photo-picker (env isolé, DB dédiée).
// Usage : node scripts/dev-night.mjs  (ou via .claude/launch.json "outil-night")
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(appRoot);

process.env.PORT = process.env.PORT || '3300';
process.env.DB_PATH = process.env.DB_PATH || join(appRoot, 'data', 'salons-night.db');
process.env.SALON_PHOTOS_DIR = process.env.SALON_PHOTOS_DIR || 'D:/images-coiffeurs/photos-web';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'night-test-secret-0123456789abcdef';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'night@test.local';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nuit-test-123';
process.env.INTERNAL_SCREENSHOT_BASE_URL = 'http://localhost:' + process.env.PORT;
// Azure OpenAI : la clé ne vit JAMAIS dans le code (repo public).
// La récupérer avant lancement : export AZURE_OPENAI_KEY=$(az cognitiveservices account keys list -g johann -n johannfoundry --query key1 -o tsv)
process.env.AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://johannfoundry.cognitiveservices.azure.com/';
process.env.AZURE_OPENAI_DEPLOYMENT_VISION = process.env.AZURE_OPENAI_DEPLOYMENT_VISION || 'gpt-4o';
process.env.AZURE_OPENAI_DEPLOYMENT_EMBED = process.env.AZURE_OPENAI_DEPLOYMENT_EMBED || 'text-embed-3-small-ACCROCHE';
if (!process.env.AZURE_OPENAI_KEY) console.warn('[dev-night] AZURE_OPENAI_KEY absente -> scoring IA desactive (le reste marche)');

await import('../server.js');
