#!/bin/bash
# Backup DB SQLite (WAL mode → backup atomique via better-sqlite3) +
# rotation locale + cross-VPS rsync.
#
# Variables requises :
#   CONTAINER_PATTERN  : pattern docker ps --format '{{.Names}}' | grep
#   VOLUME_DIR         : path host du volume (pour récupérer le tmp backup)
#   LOCAL_DIR          : dossier local de backup (rotation 30j)
#   REMOTE             : user@host:/path pour rsync (vide = pas de cross)
#   SSH_KEY            : clé SSH (default /root/.ssh/backup_id_ed25519)

set -euo pipefail

: "${CONTAINER_PATTERN:?CONTAINER_PATTERN not set}"
: "${VOLUME_DIR:?VOLUME_DIR not set}"
: "${LOCAL_DIR:?LOCAL_DIR not set}"
REMOTE="${REMOTE:-}"
SSH_KEY="${SSH_KEY:-/root/.ssh/backup_id_ed25519}"

mkdir -p "$LOCAL_DIR"
DATE=$(date +%Y-%m-%d_%H%M)
TMP_NAME="_backup-$DATE.db"
BACKUP="$LOCAL_DIR/salons-$DATE.db.gz"

CONTAINER=$(docker ps --format '{{.Names}}' | grep "$CONTAINER_PATTERN" | head -1)
if [ -z "$CONTAINER" ]; then
  echo "[backup-db] ERROR: container matching '$CONTAINER_PATTERN' not found" >&2
  exit 1
fi

# 1. Backup atomique via better-sqlite3 (résout WAL mode)
docker exec "$CONTAINER" node -e "
const db = require('better-sqlite3')('/data/salons.db', { readonly: true });
db.backup('/data/$TMP_NAME').then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
"

# 2. Compress + move depuis volume vers dossier de backup
if [ ! -f "$VOLUME_DIR/$TMP_NAME" ]; then
  echo "[backup-db] ERROR: $VOLUME_DIR/$TMP_NAME not found after backup" >&2
  exit 1
fi
gzip -c "$VOLUME_DIR/$TMP_NAME" > "$BACKUP"
rm -f "$VOLUME_DIR/$TMP_NAME"
SIZE=$(stat -c%s "$BACKUP" 2>/dev/null || stat -f%z "$BACKUP")
echo "[backup-db] $(date -Iseconds) local backup $BACKUP ($SIZE bytes)"

# 3. Rotation 30 jours
find "$LOCAL_DIR" -name 'salons-*.db.gz' -mtime +30 -delete
echo "[backup-db] $(date -Iseconds) rotation: kept last 30 days"

# 4. Cross-VPS rsync (optional)
if [ -n "$REMOTE" ]; then
  rsync -az -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=15" \
    "$BACKUP" "$REMOTE/" && \
    echo "[backup-db] $(date -Iseconds) cross-VPS rsync OK → $REMOTE" || \
    echo "[backup-db] $(date -Iseconds) cross-VPS rsync FAILED (non-fatal)" >&2
fi
