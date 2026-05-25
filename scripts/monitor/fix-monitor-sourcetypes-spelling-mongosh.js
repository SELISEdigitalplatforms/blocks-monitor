/** SCRIPT 1 goes through all collections and renames the field */

const oldField = "MonitorSourcetypes";
const newField = "MonitorSourceType"; // 👈 same as above

print("======= RENAMING FIELD START =======\n");

db.getCollectionNames().forEach((collectionName) => {
  const col = db.getCollection(collectionName);
  const docsWithOld = col.countDocuments({ [oldField]: { $exists: true } });

  if (docsWithOld === 0) {
    print(`⏭️  ${collectionName}: skipped (field not found)`);
    return; // skip collections that don't have the field
  }

  const result = col.updateMany(
    { [oldField]: { $exists: true } },
    { $rename: { [oldField]: newField } },
  );

  print(
    `✅ ${collectionName}: ${result.modifiedCount}/${docsWithOld} documents updated`,
  );
});

print("\n======= DONE =======");


/** SCRIPT 2 is a pre-flight check to identify affected collections before
 * running the pre-flight script or update script. */

db.getCollectionNames().forEach((collectionName) => {
  const count = db.getCollection(collectionName).countDocuments({
    [oldField]: { $exists: true }
  });

  if (count > 0) {
    print(`✅ ${collectionName}: ${count} documents have "${oldField}"`);
  } else {
    print(`⛔ ${collectionName}: field "${oldField}" NOT found`);
  }
});

/** SCRIPT 3 is a check pre-flight script to identify affected documents inside certain collections */

const oldField = "MonitorSourcetypes";
const newField = "MonitorSourceType"; // 👈 set your new field name
const collections = ["MonitorIncidents", "MonitorConfigurations"];

print("======= PRE-FLIGHT CHECK =======\n");

collections.forEach((collectionName) => {
  const col = db.getCollection(collectionName);
  const docsWithOld = col.countDocuments({ [oldField]: { $exists: true } });
  const docsWithNew = col.countDocuments({ [newField]: { $exists: true } });

  print(`✅ ${collectionName}: ${docsWithOld} documents have "${oldField}"`);

  if (docsWithNew > 0) {
    print(
      `   ⚠️  WARNING: "${newField}" already exists in ${docsWithNew} docs — $rename will overwrite!`,
    );
  }
});

print("\n=================================");
print(`Collections to update: [${collections.join(", ")}]`);
print("=================================\n");

/** SCRIPT 4 is a script to fix the casing of the field name in the two affected collections.
 * Run it in the MongoDB shell connected to the appropriate database.  */

const oldField = "MonitorSourcetypes";
const newField = "MonitorSourceType"; // 👈 same as above
const collections = ["MonitorIncidents", "MonitorConfigurations"];

print("======= RENAMING FIELD =======\n");

collections.forEach((collectionName) => {
  const col = db.getCollection(collectionName);

  const result = col.updateMany(
    { [oldField]: { $exists: true } },
    { $rename: { [oldField]: newField } },
  );

  print(`✅ ${collectionName}: ${result.modifiedCount} documents updated`);
});

print("\n======= DONE =======");
