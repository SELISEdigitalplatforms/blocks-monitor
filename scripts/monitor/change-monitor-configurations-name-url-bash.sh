#!/bin/bash

# =========================
# CONFIG
# =========================

MONGO_URI="mongodb://127.0.0.1:27017"
DATABASE_NAME="yourDatabaseName"       # 👈 set your database name
COLLECTION_NAME="MonitorConfigurations"
URL_SUFFIX=".seliseblocks.com/ping"

# =========================
# SCRIPT DIRECTORY & BACKUP
# =========================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT_DIR="$SCRIPT_DIR/mongo-backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_ROOT_DIR"

echo "======================================="
echo "  MonitorConfigurations URL Migration"
echo "  Database   : $DATABASE_NAME"
echo "  Collection : $COLLECTION_NAME"
echo "======================================="
echo "Backup Directory: $BACKUP_ROOT_DIR"
echo ""

# =========================
# PRE-FLIGHT CHECK
# =========================

echo "======= PRE-FLIGHT CHECK ======="
echo ""

mongosh "$MONGO_URI" --quiet --eval "

  db = db.getSiblingDB('$DATABASE_NAME');
  const col = db.getCollection('$COLLECTION_NAME');

  // currentName → urlSegment
  // New Name  = urlSegment (value)
  // New Url   = https://{urlSegment}.seliseblocks.com/ping
  const SERVICE_MAP = {
    'iam'         : 'iam',
    'data'        : 'data',
    'release'     : 'release',
    'monitor'     : 'monitor',
    'localization': 'localization',
    'agents'      : 'agents',
    'utilities'   : 'utilities',
    'logic'       : 'logic',
    'studio'      : 'studio',
    'blocks os'   : 'os',
  };

  const URL_SUFFIX = '$URL_SUFFIX';

  const totalTargeted = col.countDocuments({ MonitorSourceType: 2 });
  print('Documents with MonitorSourceType = 2: ' + totalTargeted);
  print('');

  // Build a lookup of existing Name → doc
  const existingNames = {};
  col.find({ MonitorSourceType: 2 }).forEach((doc) => {
    existingNames[doc.Name] = doc;
  });

  let toUpdate  = 0;
  let toInsert  = 0;
  let toDelete  = 0;

  // ── Check what needs updating or inserting ──
  print('--- Updates & Inserts ---');
  print('');

  Object.entries(SERVICE_MAP).forEach(([currentName, urlSegment]) => {
    const newName = urlSegment;
    const newUrl  = 'https://' + urlSegment + URL_SUFFIX;

    if (existingNames[currentName]) {
      print('  📝 UPDATE  — Name: \"' + currentName + '\" ➜ \"' + newName + '\"');
      print('               Url : \"' + existingNames[currentName].Url + '\" ➜ \"' + newUrl + '\"');
      toUpdate++;
    } else {
      print('  ➕ INSERT  — Name: \"' + newName + '\"');
      print('               Url : \"' + newUrl + '\"');
      print('               (fields copied from existing template doc)');
      toInsert++;
    }

    print('');
  });

  // ── Check what needs deleting ──
  print('--- Deletions ---');
  print('');

  col.find({ MonitorSourceType: 2 }).forEach((doc) => {
    if (SERVICE_MAP[doc.Name] === undefined) {
      print('  🗑️  DELETE  — _id: ' + doc._id + ' | Name: \"' + doc.Name + '\"');
      toDelete++;
    }
  });

  print('');
  print('=================================');
  print('  📝 To update : ' + toUpdate);
  print('  ➕ To insert : ' + toInsert);
  print('  🗑️  To delete : ' + toDelete);
  print('  📦 Expected docs after migration: ' + Object.keys(SERVICE_MAP).length);
  print('=================================');
"

echo ""
read -p "⚠️  Proceed with backup, update, insert and delete? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""

# =========================
# BACKUP
# =========================

echo "======= TAKING BACKUP ======="
echo ""

mongodump \
  --uri="$MONGO_URI" \
  --db="$DATABASE_NAME" \
  --collection="$COLLECTION_NAME" \
  --out="$BACKUP_ROOT_DIR"

echo "✅ Backup completed: $BACKUP_ROOT_DIR/$DATABASE_NAME/$COLLECTION_NAME.bson"
echo ""

# =========================
# RUN UPDATE, INSERT & DELETE
# =========================

echo "======= UPDATING, INSERTING & CLEANING DOCUMENTS ======="
echo ""

mongosh "$MONGO_URI" --quiet --eval "

  db = db.getSiblingDB('$DATABASE_NAME');
  const col = db.getCollection('$COLLECTION_NAME');

  const SERVICE_MAP = {
    'iam'         : 'iam',
    'data'        : 'data',
    'release'     : 'release',
    'monitor'     : 'monitor',
    'localization': 'localization',
    'agents'      : 'agents',
    'utilities'   : 'utilities',
    'logic'       : 'logic',
    'studio'      : 'studio',
    'blocks os'   : 'os',
  };

  const URL_SUFFIX = '$URL_SUFFIX';

  // ── Grab a template doc to copy fields from ──
  const templateDoc = col.findOne({ MonitorSourceType: 2 });

  if (!templateDoc) {
    print('❌ No template document found. Cannot insert new documents. Aborting.');
    quit();
  }

  print('📋 Template doc used for inserts: ' + templateDoc._id);
  print('');

  // Build lookup of existing docs by Name
  const existingNames = {};
  col.find({ MonitorSourceType: 2 }).forEach((doc) => {
    existingNames[doc.Name] = doc;
  });

  let updated = 0;
  let inserted = 0;
  let deleted  = 0;
  let failed   = 0;

  // ── UPDATE or INSERT for each service in map ──
  Object.entries(SERVICE_MAP).forEach(([currentName, urlSegment]) => {
    const newName = urlSegment;
    const newUrl  = 'https://' + urlSegment + URL_SUFFIX;

    if (existingNames[currentName]) {

      // UPDATE existing document
      const doc    = existingNames[currentName];
      const result = col.updateOne(
        { _id: doc._id },
        { \$set: { Name: newName, Url: newUrl } }
      );

      if (result.modifiedCount === 1) {
        print('✅ Updated  — _id: ' + doc._id);
        print('   Name : \"' + doc.Name + '\" ➜ \"' + newName + '\"');
        print('   Url  : \"' + doc.Url  + '\" ➜ \"' + newUrl  + '\"');
        updated++;
      } else {
        print('❌ Update failed — _id: ' + doc._id);
        failed++;
      }

    } else {

      // INSERT new document using template fields
      const newDoc = Object.assign({}, templateDoc, {
        _id  : UUID().toString(),   // fresh unique id
        Name : newName,
        Url  : newUrl,
        CreatedDate     : new Date(),
        LastUpdatedDate : new Date(),
      });

      // Remove fields that should not be carried over from template
      delete newDoc.LastIncidentAt;
      delete newDoc.LastCheckedAt;

      try {
        col.insertOne(newDoc);
        print('➕ Inserted — Name: \"' + newName + '\" | Url: \"' + newUrl + '\"');
        inserted++;
      } catch(e) {
        print('❌ Insert failed — Name: \"' + newName + '\" | Error: ' + e.message);
        failed++;
      }
    }

    print('');
  });

  // ── DELETE docs not in map ────────────────────
  col.find({ MonitorSourceType: 2 }).forEach((doc) => {
    if (SERVICE_MAP[doc.Name] === undefined) {
      const deleteResult = col.deleteOne({ _id: doc._id });
      if (deleteResult.deletedCount === 1) {
        print('🗑️  Deleted — _id: ' + doc._id + ' | Name: \"' + doc.Name + '\"');
        deleted++;
      } else {
        print('❌ Delete failed — _id: ' + doc._id);
        failed++;
      }
    }
  });

  // ── Final verification ────────────────────────
  const remaining = col.countDocuments({ MonitorSourceType: 2 });

  print('');
  print('=================================');
  print('✅ Updated  : ' + updated);
  print('➕ Inserted : ' + inserted);
  print('🗑️  Deleted  : ' + deleted);
  print('❌ Failed   : ' + failed);
  print('📦 Remaining docs (MonitorSourceType=2): ' + remaining);
  print('=================================');
"

echo ""
echo "======================================="
echo "  MIGRATION COMPLETED"
echo "  Database  : $DATABASE_NAME"
echo "  Backup at : $BACKUP_ROOT_DIR"
echo "======================================="
