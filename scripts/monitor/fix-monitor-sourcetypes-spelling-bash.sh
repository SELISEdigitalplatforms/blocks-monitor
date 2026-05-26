#!/bin/bash

# =========================
# CONFIG
# =========================

MONGO_URI="mongodb://10.10.64.11:27017"
DATABASE_NAME="yourDatabaseName"       # 👈 set your database name

OLD_FIELD="MonitorSourcetypes"
NEW_FIELD="MonitorSourceType"

# =========================
# SCRIPT DIRECTORY
# =========================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT_DIR="$SCRIPT_DIR/mongo-backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_ROOT_DIR"

echo "======================================="
echo "  MonitorSourcetypes Field Rename"
echo "  Database : $DATABASE_NAME"
echo "======================================="
echo ""

# =========================
# PRE-FLIGHT CHECK
# =========================

echo "======= PRE-FLIGHT CHECK ======="
echo ""

mongosh "$MONGO_URI" --quiet --eval "

  db = db.getSiblingDB('$DATABASE_NAME');

  const oldField = '$OLD_FIELD';
  const toUpdate = [];

  db.getCollectionNames().forEach((collectionName) => {
    const col = db.getCollection(collectionName);
    const count = col.countDocuments({ [oldField]: { \$exists: true } });

    if (count > 0) {
      print('  ✅ ' + collectionName + ': ' + count + ' documents have \"' + oldField + '\"');
      toUpdate.push(collectionName);
    } else {
      print('  ⛔ ' + collectionName + ': field not found');
    }
  });

  print('');
  print('Collections to update: [' + toUpdate.join(', ') + ']');
"

echo ""
echo "================================="
echo ""

# =========================
# CONFIRM BEFORE PROCEEDING
# =========================

read -p "⚠️  Proceed with backup and rename? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""

# =========================
# BACKUP MATCHING COLLECTIONS
# =========================

echo "======= TAKING BACKUP ======="
echo ""

MATCHING_COLLECTIONS=$(mongosh "$MONGO_URI" --quiet --eval "
  db = db.getSiblingDB('$DATABASE_NAME');
  const oldField = '$OLD_FIELD';

  db.getCollectionNames()
    .filter(name => db.getCollection(name).countDocuments({ [oldField]: { \$exists: true } }) > 0)
    .join('\n')
")

if [ -z "$MATCHING_COLLECTIONS" ]; then
  echo "⛔ No collections found with field '$OLD_FIELD'. Nothing to do."
  exit 0
fi

for COLLECTION_NAME in $MATCHING_COLLECTIONS
do
  echo "Backing up: $COLLECTION_NAME"

  mongodump \
    --uri="$MONGO_URI" \
    --db="$DATABASE_NAME" \
    --collection="$COLLECTION_NAME" \
    --out="$BACKUP_ROOT_DIR"

  echo "✅ Backup done: $BACKUP_ROOT_DIR/$DATABASE_NAME/$COLLECTION_NAME.bson"
  echo ""
done

# =========================
# RUN RENAME
# =========================

echo "======= RENAMING FIELD ======="
echo ""

mongosh "$MONGO_URI" --quiet --eval "

  db = db.getSiblingDB('$DATABASE_NAME');

  const oldField = '$OLD_FIELD';
  const newField = '$NEW_FIELD';

  let totalUpdated = 0;

  db.getCollectionNames().forEach((collectionName) => {
    const col = db.getCollection(collectionName);
    const docsWithOld = col.countDocuments({ [oldField]: { \$exists: true } });

    if (docsWithOld === 0) {
      print('⏭️  ' + collectionName + ': skipped (field not found)');
      return;
    }

    const result = col.updateMany(
      { [oldField]: { \$exists: true } },
      { \$rename: { [oldField]: newField } }
    );

    print('✅ ' + collectionName + ': ' + result.modifiedCount + '/' + docsWithOld + ' documents updated');
    totalUpdated += result.modifiedCount;
  });

  print('');
  print('Total documents updated: ' + totalUpdated);
"

echo ""
echo "======================================="
echo "  RENAME COMPLETED"
echo "  Database  : $DATABASE_NAME"
echo "  Backup at : $BACKUP_ROOT_DIR"
echo "======================================="
