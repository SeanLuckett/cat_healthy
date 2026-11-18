#!/bin/bash
# Daily backup of cat.db to Dropbox. Run by the systemd user timer cat-healthy-backup.timer
# (see scripts/systemd/).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="$PROJECT_DIR/cat.db"
DEST="$HOME/Dropbox/cat_healthy_backups"
KEEP_DAYS=30
STAMP="$(date +%Y-%m-%d)"

mkdir -p "$DEST"

# .backup takes a consistent snapshot, including anything still in the WAL file.
sqlite3 "$DB" ".backup '$DEST/cat-$STAMP.db'"

sqlite3 -header -csv "$DB" \
  "SELECT date, weight_kg, ROUND(weight_kg * 2.20462, 2) AS weight_lbs, notes FROM weight_log ORDER BY date;" \
  > "$DEST/weight-$STAMP.csv"

find "$DEST" -name 'cat-*.db' -mtime +$KEEP_DAYS -delete
find "$DEST" -name 'weight-*.csv' -mtime +$KEEP_DAYS -delete

echo "$(date '+%Y-%m-%d %H:%M:%S') backed up to $DEST/cat-$STAMP.db"
