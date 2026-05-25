// ============================================
// TARGET: MonitorConfigurations
// FILTER: MonitorSourceType = 2
// ============================================

const NAME_MAP = {
  "idp"          : "iam",
  "uds"          : "data",
  "deployment"   : "release",
  "observability": "monitor",
  "eurolm"       : "localization",
  "agent"        : "agents",
  "utility"      : "utilities",
};

const col = db.getCollection("MonitorConfigurations");

// ── Pre-flight ──────────────────────────────
print("======= PRE-FLIGHT CHECK =======\n");

const totalTargeted = col.countDocuments({ MonitorSourceType: 2 });
print(`Documents with MonitorSourceType = 2: ${totalTargeted}`);

col.find({ MonitorSourceType: 2 }).forEach((doc) => {
  const matchedKey = Object.keys(NAME_MAP).find((key) => doc.name === key);
  if (matchedKey) {
    print(`  📄 _id: ${doc._id}  |  name: "${doc.name}"  |  url: "${doc.url}"`);
    print(`     ➜  name: "${NAME_MAP[matchedKey]}"  |  url: "${doc.url?.replace(matchedKey, NAME_MAP[matchedKey])}"`);
  } else {
    print(`  ⚠️  _id: ${doc._id}  |  name: "${doc.name}" — NO MAPPING FOUND, will be skipped`);
  }
});

print("\n=============== DONE ==================\n");

// ── Rename ──────────────────────────────────
print("======= UPDATING DOCUMENTS =======\n");

let updated = 0;
let skipped = 0;

col.find({ MonitorSourceType: 2 }).forEach((doc) => {
  const matchedKey = Object.keys(NAME_MAP).find((key) => doc.name === key);

  if (!matchedKey) {
    print(`⏭️  Skipped  — _id: ${doc._id}, name: "${doc.name}" (no mapping)`);
    skipped++;
    return;
  }

  const newName = NAME_MAP[matchedKey];
  const newUrl  = doc.url?.replace(matchedKey, newName) ?? doc.url;

  const result = col.updateOne(
    { _id: doc._id },
    { $set: { name: newName, url: newUrl } }
  );

  if (result.modifiedCount === 1) {
    print(`✅ Updated  — _id: ${doc._id}`);
    print(`   name : "${doc.name}" ➜ "${newName}"`);
    print(`   url  : "${doc.url}" ➜ "${newUrl}"`);
    updated++;
  } else {
    print(`❌ Failed   — _id: ${doc._id}`);
  }

  print("");
});

print("=================================");
print(`✅ Updated : ${updated}`);
print(`⏭️  Skipped : ${skipped}`);
print("=================================");
