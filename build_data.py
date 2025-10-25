import json
import re
import math

INPUT_STORE = "javelindata_pvp_store_v2.json"
INPUT_REWARDS = "javelindata_pvp_rewards_v2.json"
INPUT_LOOTTABLES = "javelindata_loottables_pvp_rewards_track.json"
OUTPUT_JS = "data.js"

# -------------------------------------------------
# 1. Utilitaires
# -------------------------------------------------

def bucket_applies(bucket_name: str, level: int) -> bool:
    """
    Est-ce que cette ligne du store est active pour ce niveau de PvP Track ?
    On gère les buckets évidents ('Odds', 'Evens', '5ths', '10ths', 'Post 200').
    Tout le reste = actif tout le temps pour l'instant.
    """
    if not bucket_name or bucket_name.strip() == "":
        return True
    b = bucket_name.strip().lower()

    if b == "odds":
        return (level % 2 == 1)
    if b == "evens":
        return (level % 2 == 0)
    if b == "5ths":
        return (level % 5 == 0)
    if b == "10ths":
        return (level % 10 == 0)
    if b in ("post 200", "post200", "post_200", "post200+", "post200plus"):
        return (level > 200)

    # Bucket inconnu => on le garde
    return True


def prob_at_least_one(weight, total_weight, draws=3):
    """
    Approx (tirage avec remise) :
    P(>=1 fois sur 'draws' choix) = 1 - (1 - p)^draws
    p = weight / sum(weights)
    """
    if total_weight <= 0:
        return 0.0
    p_single = weight / total_weight
    return 1.0 - (1.0 - p_single) ** draws


def clean_loottable_name(item_field: str):
    """
    '[LTID]PvP_Whatever' -> 'PvP_Whatever'
    '[LBID]Something'    -> 'Something'
    """
    if not isinstance(item_field, str):
        return None
    return re.sub(r"^\[(?:LTID|LBID)\]", "", item_field)


def safe_int(v, default=0):
    try:
        return int(v)
    except Exception:
        try:
            return int(float(v))
        except Exception:
            return default


# -------------------------------------------------
# 2. Chargement brut des fichiers datasheet
# -------------------------------------------------

with open(INPUT_STORE, "r") as f:
    store_rows = json.load(f)

with open(INPUT_REWARDS, "r") as f:
    reward_rows = json.load(f)

with open(INPUT_LOOTTABLES, "r") as f:
    loot_rows = json.load(f)

# Index pratique par LootTableID
rows_by_loot_id = {row["LootTableID"]: row for row in loot_rows}


# -------------------------------------------------
# 3. Flatten du store (chaque ligne notch/bucket/reward/poids)
# -------------------------------------------------

long_rows = []
for row in store_rows:
    rowname = row.get("RowPlaceholders", "")
    for notch_idx in (1, 2, 3):
        bucket = row.get(f"Bucket{notch_idx}", "")
        reward_id = row.get(f"RewardId{notch_idx}", "")
        weight = row.get(f"RandomWeights{notch_idx}", 0) or 0
        select_once = bool(row.get(f"SelectOnceOnly{notch_idx}", False))
        exclude_cat = row.get(f"ExcludeTypeStage{notch_idx}", "")

        if reward_id and weight:
            long_rows.append({
                "notch": notch_idx,
                "bucket": bucket,
                "rewardId": reward_id,
                "weight": int(weight),
                "selectOnceOnly": select_once,
                "excludeTypeStage": exclude_cat,
                "rowName": rowname,
            })

# Marquage "artifact-like" (certains rewards sont marqués Artifact dans ExcludeTypeStage)
artifact_like_map = {}
for lr in long_rows:
    rid = lr["rewardId"]
    exclude_cat = (lr.get("excludeTypeStage") or "").lower()
    is_artifact = "artifact" in exclude_cat
    artifact_like_map[rid] = artifact_like_map.get(rid, False) or is_artifact


# -------------------------------------------------
# 4. Construction de PVP_DATA
#    => proba d'apparition par TrackLevel (0-230) / Notch (1-3)
# -------------------------------------------------

def add_entry(store, level, notch, rewards_merged):
    total_w = sum(r["weight"] for r in rewards_merged)

    out_list = []
    for r in rewards_merged:
        w = r["weight"]
        single = (w / total_w * 100.0) if total_w > 0 else 0.0
        atleast = prob_at_least_one(w, total_w, draws=3) * 100.0

        out_list.append({
            "rewardId": r["rewardId"],
            "weight": w,
            "selectOnceOnly": r.get("selectOnceOnly", False),
            "percentSingle": round(single, 4),
            "percentAtLeastOneOfThree": round(atleast, 4),
        })

    # tri par % mono tirage décroissant
    out_list.sort(key=lambda x: x["percentSingle"], reverse=True)

    lvl_key = str(level)
    notch_key = str(notch)
    if lvl_key not in store:
        store[lvl_key] = {}
    store[lvl_key][notch_key] = {
        "totalWeight": total_w,
        "rewards": out_list,
    }

PVP_DATA = {}
for level in range(0, 231):  # TrackLevel 0 → 230
    for notch in (1, 2, 3):

        # 1. On collecte les lignes actives à ce niveau de PvP Track
        pool = []
        for r in long_rows:
            if r["notch"] == notch and bucket_applies(r["bucket"], level):
                pool.append({
                    "rewardId": r["rewardId"],
                    "weight": r["weight"],
                    "selectOnceOnly": r["selectOnceOnly"],
                })

        # 2. Fusion par RewardId
        merged = {}
        for item in pool:
            rid = item["rewardId"]
            if rid not in merged:
                merged[rid] = {
                    "rewardId": rid,
                    "weight": 0,
                    "selectOnceOnly": False,
                }
            merged[rid]["weight"] += item["weight"]
            # si l'une des occurrences est "select once", on garde True
            merged[rid]["selectOnceOnly"] = (
                merged[rid]["selectOnceOnly"] or item["selectOnceOnly"]
            )

        rewards_merged = list(merged.values())

        # 3. Calcul des % pour ce notch
        add_entry(PVP_DATA, level, notch, rewards_merged)


# -------------------------------------------------
# 5. PVP_LOOT_TABLES = comment une LootTable choisit le palier GS
#    ("Level", "PvP_XP", min thresholds, sous-table éventuelle)
# -------------------------------------------------

def build_loot_table_struct(table_id: str):
    """
    Pour une LootTableID donnée (ex: 'PvP_BasicArmor1_CharmFiltering'),
    on construit:
    {
        "condition": "Level" ou "PvP_XP" (ce que la table regarde)
        "tiers": [
            { "min": 0,   "gsRange": "200-300", "subTable": null },
            { "min": 20,  "gsRange": "300-400", "subTable": null },
            { "min": 61,  "gsRange": null,      "subTable": "PvP_Prestige..." },
            ...
        ]
    }
    """
    row = rows_by_loot_id[table_id]
    probs_row = rows_by_loot_id.get(table_id + "_Probs", {})

    tiers = []
    i = 1
    while f"Item{i}" in row:
        item_val = row.get(f"Item{i}")
        gs_val = row.get(f"GearScoreRange{i}")
        raw_thresh = probs_row.get(f"Item{i}", 0)
        min_val = safe_int(raw_thresh, 0)

        # est-ce que ce palier redirige vers une autre table ?
        sub_table = None
        if isinstance(item_val, str) and item_val.startswith("[LTID]"):
            sub_table = re.sub(r"^\[LTID\]", "", item_val)

        tiers.append({
            "min": min_val,
            "gsRange": gs_val if gs_val is not None else None,
            "subTable": sub_table,
        })
        i += 1

    cond_list = row.get("Conditions", [])
    condition = cond_list[0] if isinstance(cond_list, list) and cond_list else None

    return {
        "condition": condition,
        "tiers": tiers,
    }


# -------------------------------------------------
# 6. PVP_LOOT_CONTENTS = le contenu interne d'une LootTable
#    (les LBID, quantités, minRoll, GSrange par entrée, etc.)
#    C'est ce qu'on veut afficher quand on clique sur un [LTID]
# -------------------------------------------------

def build_loot_roll_contents(table_id: str):
    """
    Exemple pris sur PVP_PerkCharmDust :

    - table_id: "PVP_PerkCharmDust"
      AND/OR: "OR"
      Item1: "[LBID]PerkCharmMats_All"
      Item2: "[LBID]PerkCharm"
    - PVP_PerkCharmDust_Qty :
      Item1: "2-4"
      Item2: "1"
    - PVP_PerkCharmDust_Probs :
      Item1: "0"
      Item2: "99000"

    On veut garder pour l'UI :
      rule (AND/OR)
      maxRoll
      entries: [
        { raw: "[LBID]PerkCharmMats_All", qty: "2-4", gsRange: None, minRoll: 0 },
        { raw: "[LBID]PerkCharm",         qty: "1",   gsRange: None, minRoll: 99000 }
      ]
    """
    row = rows_by_loot_id[table_id]
    qty_row = rows_by_loot_id.get(table_id + "_Qty", {})
    probs_row = rows_by_loot_id.get(table_id + "_Probs", {})

    entries = []
    i = 1
    while f"Item{i}" in row:
        raw_item = row.get(f"Item{i}")
        qty_val = qty_row.get(f"Item{i}")
        gs_val = row.get(f"GearScoreRange{i}")  # parfois présent
        min_roll_raw = probs_row.get(f"Item{i}")
        min_roll = None
        if min_roll_raw is not None:
            min_roll = safe_int(min_roll_raw, None)

        entries.append({
            "raw": raw_item,
            "qty": qty_val,
            "gsRange": gs_val if gs_val is not None else None,
            "minRoll": min_roll,
        })
        i += 1

    cond_list = row.get("Conditions", [])
    condition = cond_list[0] if isinstance(cond_list, list) and cond_list else None

    rule_val = row.get("AND/OR") or row.get("AND\\/OR") or ""

    return {
        "condition": condition,
        "rule": rule_val,
        "rollBonusSetting": row.get("RollBonusSetting") or "",
        "maxRoll": row.get("MaxRoll", 0),
        "entries": entries,
    }


PVP_LOOT_TABLES = {}
PVP_LOOT_CONTENTS = {}
for table_id in rows_by_loot_id.keys():
    # on saute les _Qty / _Probs elles-mêmes
    if table_id.endswith("_Qty") or table_id.endswith("_Probs"):
        continue
    PVP_LOOT_TABLES[table_id] = build_loot_table_struct(table_id)
    PVP_LOOT_CONTENTS[table_id] = build_loot_roll_contents(table_id)


# -------------------------------------------------
# 7. PVP_REWARD_META = méta par RewardID
#    (nom affichable, lootTableId associée, coût Azoth Salt, etc.)
# -------------------------------------------------

PVP_REWARD_META = {}
for r in reward_rows:
    rid = r.get("RewardID") or r.get("RewardId") or ""
    if not rid:
        continue

    # champs utiles
    item_field = r.get("Item") or ""
    raw_item_field = item_field  # on le garde tel quel pour debug / fallback nom
    item_clean = clean_loottable_name(item_field) or ""
    name_field = r.get("Name") or ""
    desc_field = r.get("Description") or ""
    icon_path = r.get("IconPath") or ""

    # meilleur nom à afficher
    if name_field.strip():
        best_name = name_field.strip()
    elif item_field.strip():
        best_name = item_field.strip()
    else:
        best_name = rid

    # si RollOnPresent = true et l'Item est un [LTID]..., c'est la loot table à dérouler
    final_loot_id = None
    if r.get("RollOnPresent") and item_clean:
        final_loot_id = item_clean

    buy_cost = r.get("BuyCategoricalProgressionCost")
    buy_currency = r.get("BuyCategoricalProgressionCurrencyId") or ""

    # uniqueEligible : on ne veut pouvoir cocher que les trucs vraiment uniques
    # logique : ENT_... (skins / emotes / titres / entitlements) OU artefacts
    is_ent = rid.startswith("ENT_")
    is_art = rid.startswith("ITM_Artifacts") or artifact_like_map.get(rid, False)
    uniqueEligible = bool(is_ent or is_art)

    PVP_REWARD_META[rid] = {
        "name": best_name,
        "description": desc_field,
        "icon": icon_path,
        "rollOnPresent": bool(r.get("RollOnPresent", False)),
        "quantity": r.get("Quantity"),
        "buyCost": buy_cost,
        "buyCurrency": buy_currency,
        "lootTableId": final_loot_id,     # ex: "PvP_BasicArmor1_CharmFiltering"
        "rawItemField": raw_item_field,   # ex: "[LTID]PvP_BasicArmor1_CharmFiltering"
        "gameEvent": r.get("GameEvent") or "",
        "uniqueEligible": uniqueEligible,
    }


# -------------------------------------------------
# 8. Dump JS -> data.js
# -------------------------------------------------

with open(OUTPUT_JS, "w", encoding="utf-8") as f:
    f.write("window.PVP_DATA = " + json.dumps(PVP_DATA, separators=(",", ":")) + ";\n")
    f.write("window.PVP_REWARD_META = " + json.dumps(PVP_REWARD_META, separators=(",", ":")) + ";\n")
    f.write("window.PVP_LOOT_TABLES = " + json.dumps(PVP_LOOT_TABLES, separators=(",", ":")) + ";\n")
    f.write("window.PVP_LOOT_CONTENTS = " + json.dumps(PVP_LOOT_CONTENTS, separators=(",", ":")) + ";\n")

print("OK ->", OUTPUT_JS)
