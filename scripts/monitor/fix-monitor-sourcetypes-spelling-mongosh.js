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

/** Pre-flight check script to identify affected collections and documents */

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

/** We can use the script below to fix the casing of the field name in the two affected collections. Run it in the MongoDB shell connected to the appropriate database.  */

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
