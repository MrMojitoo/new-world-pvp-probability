import json
import csv
import re

# --------- Inputs
INPUT_STORE = "javelindata_pvp_store_v2.json"
INPUT_REWARDS = "javelindata_pvp_rewards_v2.json"
INPUT_LOOTTABLES = "javelindata_loottables_pvp_rewards_track.json"
INPUT_LOOTBUCKETS = "javelindata_lootbuckets_pvp.json"

# NEW: for names/icons
INPUT_ITEMCSV = "exportItemsNamesS10.csv"        # columns: Item ID, Name, Icon Path, Rarity
INPUT_ENUS    = "en-us.json"                     # localization for @keys
INPUT_EMOTES  = "javelindata_emotedefinitions.json"

OUTPUT_JS = "data.js"

CDN_PREFIX = "https://cdn.nw-buddy.de/nw-data/live/"

# --------- Utils
def bucket_applies(bucket_name: str, level: int) -> bool:
    if not bucket_name or bucket_name.strip() == "":
        return True
    b = bucket_name.strip().lower()
    if b == "odds":  return (level % 2 == 1)
    if b == "evens": return (level % 2 == 0)
    if b == "5ths":  return (level % 5 == 0)
    if b == "10ths": return (level % 10 == 0)
    if b in ("post 200", "post200", "post_200", "post200+", "post200plus"):
        return level > 200
    return True

def prob_at_least_one(weight, total_weight, draws=3):
    if total_weight <= 0: return 0.0
    p = weight / total_weight
    return 1.0 - (1.0 - p) ** draws

def clean_loottable_name(s: str):
    if not isinstance(s, str): return None
    return re.sub(r"^\[(?:LTID|LBID)\]", "", s)

def safe_int(v, default=0):
    try: return int(v)
    except Exception:
        try: return int(float(v))
        except Exception: return default

def lc(x: str) -> str:
    return (x or "").strip().lower()

def full_icon(url: str) -> str:
    if not url: return ""
    u = url.strip()
    if u.startswith("http://") or u.startswith("https://"): return u
    return CDN_PREFIX + u.lstrip("/")

# Rarity → dark backgrounds
RARITY_COLOR = {
    "artifact":  "#7f1d1d",  # dark red
    "legendary": "#9a3412",  # dark orange
    "epic":      "#5b21b6",  # dark purple
    "rare":      "#1e40af",  # blue
    "uncommon":  "#14532d",  # dark green
    "common":    "#334155",  # dark gray
}

# --------- Load raw data
with open(INPUT_STORE, "r", encoding="utf-8") as f:
    store_rows = json.load(f)
with open(INPUT_REWARDS, "r", encoding="utf-8") as f:
    reward_rows = json.load(f)
with open(INPUT_LOOTTABLES, "r", encoding="utf-8") as f:
    loot_rows = json.load(f)

rows_by_loot_id = {row["LootTableID"]: row for row in loot_rows}

# --------- 1) Flatten store → PVP_DATA (weights / % per notch)
long_rows = []
for row in store_rows:
    rowname = row.get("RowPlaceholders", "")
    for notch_idx in (1, 2, 3):
        reward_id = row.get(f"RewardId{notch_idx}") or row.get(f"RewardID{notch_idx}") or ""
        if not reward_id: continue
        weight = int(row.get(f"RandomWeights{notch_idx}", 0) or 0)
        if weight <= 0: continue
        bucket = row.get(f"Bucket{notch_idx}", "")
        select_once = bool(row.get(f"SelectOnceOnly{notch_idx}", False))
        exclude_cat = row.get(f"ExcludeTypeStage{notch_idx}", "")
        long_rows.append({
            "notch": notch_idx,
            "bucket": bucket,
            "rewardId": reward_id,
            "weight": weight,
            "selectOnceOnly": select_once,
            "excludeTypeStage": exclude_cat,
            "rowName": rowname,
        })

# mark artifact-like from ExcludeTypeStage
artifact_like_map = {}
for lr in long_rows:
    rid = lr["rewardId"]
    is_artifact = "artifact" in (lr.get("excludeTypeStage") or "").lower()
    artifact_like_map[rid] = artifact_like_map.get(rid, False) or is_artifact

def add_entry(store, level, notch, rewards_merged):
    total_w = sum(r["weight"] for r in rewards_merged)
    out = []
    for r in rewards_merged:
        w = r["weight"]
        single = (w / total_w * 100.0) if total_w > 0 else 0.0
        atleast = prob_at_least_one(w, total_w, 3) * 100.0
        out.append({
            "rewardId": r["rewardId"],
            "weight": w,
            "selectOnceOnly": r.get("selectOnceOnly", False),
            "percentSingle": round(single, 4),
            "percentAtLeastOneOfThree": round(atleast, 4),
        })
    out.sort(key=lambda x: x["percentSingle"], reverse=True)
    store.setdefault(str(level), {})[str(notch)] = {"totalWeight": total_w, "rewards": out}

PVP_DATA = {}
for level in range(0, 231):
    for notch in (1, 2, 3):
        pool = [r for r in long_rows if r["notch"] == notch and bucket_applies(r["bucket"], level)]
        add_entry(PVP_DATA, level, notch, pool)

# --------- 2) Build loottable structures (tiers OR / AND + _Probs/_Qty)
def build_loot_table_struct(table_id: str):
    row = rows_by_loot_id[table_id]
    probs = rows_by_loot_id.get(table_id + "_Probs", {})
    entries = []
    i = 1
    while f"Item{i}" in row:
        raw_item = row.get(f"Item{i}")
        gs_val = row.get(f"GearScoreRange{i}")
        min_roll = safe_int(probs.get(f"Item{i}", 0), 0)
        sub_table = None
        if isinstance(raw_item, str) and raw_item.startswith("[LTID]"):
            sub_table = clean_loottable_name(raw_item)
        entries.append({
            "raw": raw_item,
            "gsRange": gs_val if gs_val is not None else None,
            "minRoll": min_roll,
            "subTable": sub_table,
        })
        i += 1
    cond = None
    cond_list = row.get("Conditions", [])
    if isinstance(cond_list, list) and cond_list: cond = cond_list[0]
    rule_val = row.get("AND/OR") or row.get("AND\\/OR") or ""
    return {
        "condition": cond,
        "rule": rule_val,
        "rollBonusSetting": row.get("RollBonusSetting") or "",
        "maxRoll": row.get("MaxRoll", 0),
        "entries": entries,
    }

def build_loot_roll_contents(table_id: str):
    row = rows_by_loot_id[table_id]
    qtys = rows_by_loot_id.get(table_id + "_Qty", {})
    entries = []
    i = 1
    while f"Item{i}" in row:
        raw_item = row.get(f"Item{i}")
        qty_val = qtys.get(f"Item{i}")
        min_roll_raw = row.get(f"Item{i}")
        min_roll = None
        entries.append({
            "raw": raw_item,
            "qty": qty_val,
        })
        i += 1
    return entries

PVP_LOOT_TABLES = {}
PVP_LOOT_CONTENTS = {}
for tid in rows_by_loot_id.keys():
    if tid.endswith("_Qty") or tid.endswith("_Probs"): continue
    PVP_LOOT_TABLES[tid] = build_loot_table_struct(tid)
    PVP_LOOT_CONTENTS[tid] = build_loot_roll_contents(tid)

# --------- 3) Reward meta (base)
PVP_REWARD_META = {}
for r in reward_rows:
    rid = r.get("RewardID") or r.get("RewardId") or ""
    if not rid: continue
    item_field = (r.get("Item") or "").strip()
    raw_item_field = item_field
    item_clean = clean_loottable_name(item_field) or ""
    name_field = (r.get("Name") or "").strip()
    desc_field = r.get("Description") or ""
    icon_path = r.get("IconPath") or ""
    if name_field:
        best_name = name_field
    elif item_field:
        best_name = item_field
    else:
        best_name = rid
    final_loot_id = item_clean if (r.get("RollOnPresent") and item_clean) else None
    buy_cost = r.get("BuyCategoricalProgressionCost")
    buy_currency = r.get("BuyCategoricalProgressionCurrencyId") or ""
    is_ent = rid.startswith("ENT_")
    is_art = rid.startswith("ITM_Artifacts") or artifact_like_map.get(rid, False)
    uniqueEligible = bool(is_ent or is_art)
    PVP_REWARD_META[rid] = {
        "name": best_name,                # will be localized/enriched below
        "description": desc_field,
        "icon": icon_path,                # will be normalized/enriched below
        "rarity": "",                     # NEW
        "rollOnPresent": bool(r.get("RollOnPresent", False)),
        "quantity": r.get("Quantity"),
        "buyCost": buy_cost,
        "buyCurrency": buy_currency,
        "lootTableId": final_loot_id,
        "rawItemField": raw_item_field,   # keep original for fallback & CSV lookup
        "gameEvent": r.get("GameEvent") or "",
        "uniqueEligible": uniqueEligible,
    }

# --------- 4) Loot buckets (LBID → final items)
with open(INPUT_LOOTBUCKETS, "r", encoding="utf-8") as f:
    lootbuckets_rows = json.load(f)

firstrow = next((r for r in lootbuckets_rows if (r.get("RowPlaceholders") or "").upper() == "FIRSTROW"), None)
idx_to_bucket = {}
if firstrow:
    for k, v in firstrow.items():
        if isinstance(k, str) and k.startswith("LootBucket"):
            idx_to_bucket[k.replace("LootBucket", "")] = v

bucket_contents = {b: [] for b in idx_to_bucket.values()}
for row in lootbuckets_rows:
    for idx, bucket in idx_to_bucket.items():
        item_key = f"Item{idx}"
        qty_key  = f"Quantity{idx}"
        tags_key = f"Tags{idx}"
        if item_key in row and row[item_key]:
            tags_val = row.get(tags_key, [])
            if isinstance(tags_val, str): tags_val = [tags_val]
            bucket_contents[bucket].append({
                "itemId": row[item_key],
                "qty": row.get(qty_key, None),
                "tags": tags_val or []
            })

# --------- 5) New: load CSV / en-us / emotes, then ENRICH names + icons + rarity
# CSV
catalog_by_id = {}
catalog_by_name = {}
try:
    with open(INPUT_ITEMCSV, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            iid = (row.get("Item ID") or row.get("ItemID") or "").strip()
            nm  = (row.get("Name") or "").strip()
            ip  = (row.get("Icon Path") or row.get("IconPath") or "").strip()
            rr  = (row.get("Rarity") or "").strip()
            if not (iid or nm): continue
            rec = {"id": iid, "name": nm, "icon": full_icon(ip), "rarity": rr}
            if iid: catalog_by_id[iid] = rec
            if nm:  catalog_by_name[lc(nm)] = rec
except Exception as e:
    # CSV optional; if missing we just won't have icons/rarities for many items
    pass

# en-us
en_us = {}
try:
    with open(INPUT_ENUS, "r", encoding="utf-8") as f:
        raw = json.load(f)
        en_us = {lc(k): v for k, v in raw.items()}
except Exception:
    en_us = {}

# Emotes
emote_icon_by_key = {}
try:
    with open(INPUT_EMOTES, "r", encoding="utf-8") as f:
        arr = json.load(f)
        for e in arr:
            key = lc(e.get("DisplayName"))
            if key:
                emote_icon_by_key[key] = full_icon(e.get("UiImage") or "")
except Exception:
    emote_icon_by_key = {}

def resolve_localized_name(name_or_at: str) -> str:
    if not name_or_at: return ""
    if name_or_at.startswith("@"):
        k = lc(name_or_at[1:])
        # normalize emote keys: often '..._name'
        if k.endswith("_name"): k = k[:-5]
        return en_us.get(k, name_or_at)
    return name_or_at

def resolve_icon_and_rarity(name_or_at: str, maybe_item_id: str):
    # 1) if it's @ui_emote..., try emotedefs
    if name_or_at.startswith("@"):
        k = lc(name_or_at[1:])
        if k.endswith("_name"): k = k[:-5]
        if k.startswith("ui_emote") and k in emote_icon_by_key:
            return emote_icon_by_key[k], ""
    # 2) try by NAME in CSV
    nm = resolve_localized_name(name_or_at)
    rec = catalog_by_name.get(lc(nm))
    if rec:
        return rec["icon"], rec["rarity"]
    # 3) try by ITEM ID (raw)
    if maybe_item_id and not maybe_item_id.startswith("[LTID]"):
        rec2 = catalog_by_id.get(maybe_item_id)
        if rec2:
            return rec2["icon"], rec2["rarity"]
    return "", ""

def enrich_reward_meta():
    for rid, meta in PVP_REWARD_META.items():
        disp_name = resolve_localized_name(meta["name"])
        # If we still have a raw Item id and no nice name, try CSV name
        if disp_name == rid or disp_name.startswith("[LTID]"):
            rec = catalog_by_id.get(meta.get("rawItemField") or "")
            if rec and rec["name"]:
                disp_name = rec["name"]
        icon, rar = resolve_icon_and_rarity(meta["name"], meta.get("rawItemField") or "")
        # fallback: if still empty, try CSV by name we just resolved
        if not icon and disp_name:
            recn = catalog_by_name.get(lc(disp_name))
            if recn: icon, rar = recn["icon"], recn["rarity"]
        meta["name"] = disp_name
        if icon: meta["icon"] = icon
        if rar:  meta["rarity"] = rar

def enrich_bucket_items():
    for bname, items in bucket_contents.items():
        for it in items:
            raw = it.get("itemId") or ""
            # Most LB items are plain item IDs. Some could be @keys.
            disp = resolve_localized_name(raw)
            if disp == raw:
                # try CSV by ID
                rec = catalog_by_id.get(raw)
                if rec:
                    disp = rec["name"]
                    it["icon"] = rec["icon"]
                    it["rarity"] = rec["rarity"]
                else:
                    it["icon"] = ""
                    it["rarity"] = ""
            else:
                # we resolved a @key → name. Try CSV by NAME first
                recn = catalog_by_name.get(lc(disp))
                if recn:
                    it["icon"] = recn["icon"]
                    it["rarity"] = recn["rarity"]
                else:
                    # emote icon if applicable
                    key = lc(raw.lstrip("@"))
                    if key.endswith("_name"): key = key[:-5]
                    it["icon"] = emote_icon_by_key.get(key, "")
                    it["rarity"] = ""
            it["displayName"] = disp

enrich_reward_meta()
enrich_bucket_items()

# --------- Dump JS
with open(OUTPUT_JS, "w", encoding="utf-8") as f:
    f.write("window.PVP_DATA=" + json.dumps(PVP_DATA, separators=(",", ":")) + ";\n")
    f.write("window.PVP_REWARD_META=" + json.dumps(PVP_REWARD_META, separators=(",", ":")) + ";\n")
    f.write("window.PVP_LOOT_TABLES=" + json.dumps(PVP_LOOT_TABLES, separators=(",", ":")) + ";\n")
    f.write("window.PVP_LOOT_CONTENTS=" + json.dumps(PVP_LOOT_CONTENTS, separators=(",", ":")) + ";\n")
    f.write("window.PVP_BUCKET_CONTENTS=" + json.dumps(bucket_contents, separators=(",", ":")) + ";\n")

print("OK ->", OUTPUT_JS)
