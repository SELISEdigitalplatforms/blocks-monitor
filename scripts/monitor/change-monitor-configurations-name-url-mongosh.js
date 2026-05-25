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
  "blocks ai"    : "agents",
  "utility"      : "utilities",
};

// Override URL segment when it differs from the NAME_MAP key
// key = Name value, value = [oldUrlSegment, newUrlSegment]
const URL_OVERRIDE_MAP = {
  "blocks ai": ["agent", "agents"],
};


const col = db.getCollection("MonitorConfigurations");

// helper — safely replace inside a URL, returns original if null/missing
function replaceUrl(url, oldKey, newKey) {
  if (!url || typeof url !== "string") return url;
  return url.replace(oldKey, newKey);
}

function resolveUrl(doc, matchedKey) {
  const newName = NAME_MAP[matchedKey];

  if (URL_OVERRIDE_MAP[matchedKey]) {
    const [oldSegment, newSegment] = URL_OVERRIDE_MAP[matchedKey];
    return replaceUrl(doc.Url, oldSegment, newSegment);
  }

  return replaceUrl(doc.Url, matchedKey, newName);
}

// ── Pre-flight ──────────────────────────────
print("======= PRE-FLIGHT CHECK START =======\n");

const totalTargeted = col.countDocuments({ MonitorSourceType: 2 });
print(`Documents with MonitorSourceType = 2: ${totalTargeted}`);

col.find({ MonitorSourceType: 2 }).forEach((doc) => {
  const matchedKey = Object.keys(NAME_MAP).find((key) => doc.Name === key);
  if (matchedKey) {
    const newName = NAME_MAP[matchedKey];
    const newUrl  = resolveUrl(doc, matchedKey);
    print(`  📄 _id: ${doc._id}`);
    print(`     Name : "${doc.Name}" ➜ "${newName}"`);
    print(`     Url  : "${doc.Url}" ➜ "${newUrl}"`);
  } else {
    print(`  ⚠️  _id: ${doc._id}  |  Name: "${doc.Name}" — NO MAPPING FOUND, will be skipped`);
  }
  print("");
});

print("\n=============== PRE-FLIGHT CHECK DONE ==================\n");





// ── Update ──────────────────────────────────
print("======= UPDATING DOCUMENTS =======\n");

let updated = 0;
let skipped = 0;

col.find({ MonitorSourceType: 2 }).forEach((doc) => {
  const matchedKey = Object.keys(NAME_MAP).find((key) => doc.Name === key);

  if (!matchedKey) {
    print(`⏭️  Skipped  — _id: ${doc._id}, Name: "${doc.Name}" (no mapping)`);
    skipped++;
    return;
  }

  const newName = NAME_MAP[matchedKey];
  const newUrl  = resolveUrl(doc, matchedKey);

  const result = col.updateOne(
    { _id: doc._id },
    { $set: { Name: newName, Url: newUrl } }
  );

  if (result.modifiedCount === 1) {
    print(`✅ Updated  — _id: ${doc._id}`);
    print(`   Name : "${doc.Name}" ➜ "${newName}"`);
    print(`   Url  : "${doc.Url}" ➜ "${newUrl}"`);
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
