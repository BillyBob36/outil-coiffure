# Outil coiffure

Générateur de landings personnalisées pour prospection de salons de coiffure.

## Architecture

- **Backend** : Node.js + Express + SQLite (better-sqlite3)
- **Captures** : Puppeteer headless Chromium
- **Frontend public** : HTML/CSS/JS statique servi via le même Express
- **Frontend admin** : HTML/CSS/JS avec session login (bcrypt + express-session)

## URLs

- `coiffure.lamidetlm.com/{slug}` → landing personnalisée
- `outil-coiffure.lamidetlm.com` → admin (login)
- `coiffure.lamidetlm.com/screenshots/{slug}.jpg` → captures servies en statique

## Variables d'environnement

Voir `.env.example`. Au démarrage, si aucun utilisateur n'existe en BDD et qu'aucun
`ADMIN_PASSWORD_HASH` n'est fourni, un mot de passe aléatoire est généré et imprimé
dans les logs (ou bien `ADMIN_PASSWORD` peut être fourni pour le contrôler).

## Lancer en local

```bash
npm install
node server.js
```

Le port par défaut est 3000. L'admin sur `http://localhost:3000/admin`,
le site public sur `http://localhost:3000/{slug}` après import d'un CSV.

## Format CSV attendu

TSV ou CSV avec entête. Colonnes reconnues (extraites de Scrap.io) :
Nom, Ville, Code postal, Adresse 1, Téléphone international, Email de contact,
Latitude, Longitude, Heures d'ouverture (JSON), Note des avis, Nombre d'avis,
Tous les types, Lien Facebook/Instagram/TikTok/Youtube, Meta image du site, etc.

Le délimiteur (`\t`, `;`, `,`) est détecté automatiquement.

## Slugs

Format : `{ville}-{nom}` en kebab-case ASCII (max 80 char). Suffixe numérique
(`-2`, `-3`) en cas de collision avec un salon existant.

## Captures d'écran

JPEG 1280×800 qualité 80. Stockées sur le volume `/data/screenshots`. Servies
publiquement via `/screenshots/{slug}.jpg`.

## Export CSV enrichi

Bouton "Exporter CSV enrichi" → ajoute deux colonnes :
- `URL_landing` : `https://coiffure.lamidetlm.com/{slug}`
- `Capture_ecran` : `https://coiffure.lamidetlm.com/screenshots/{slug}.jpg`
