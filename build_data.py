import json
import csv
import re

# --------- Inputs
INPUT_STORE = "javelindata_pvp_store_v2.json"
INPUT_REWARDS = "javelindata_pvp_rewards_v2.json"
INPUT_LOOTTABLES = "javelindata_loottables_pvp_rewards_track.json"
INPUT_LOOTBUCKETS = "javelindata_lootbuckets_pvp.json"
INPUT_HOUSING = "javelindata_housingitems.json"
INPUT_GAMEEVENTS = "javelindata_gameevents.json"

# data sources for names / icons
INPUT_ITEMCSV = "exportItemsNamesS10.csv"        # columns like: Item ID, Name, Icon Path, Rarity
INPUT_ENUS    = "en-us.json"                     # localization: keys like "ui_emote_frustrated_name"
INPUT_EMOTES  = "javelindata_emotedefinitions.json"

OUTPUT_JS = "data.js"

CDN_PREFIX = "https://cdn.nw-buddy.de/nw-data/live/"

# --------- Helpers / utils

def lc(x: str) -> str:
    return (x or "").strip().lower()

def full_icon(url: str) -> str:
    """
    Turn relative LyShine paths into CDN urls.
    """
    if not url:
        return ""
    u = url.strip()
    if u.startswith("http://") or u.startswith("https://"):
        return u
    return CDN_PREFIX + u.lstrip("/")

def bucket_applies(bucket_name: str, level: int) -> bool:
    """
    Rules from the store sheet:
    - "Odds", "Evens", "5ths", "10ths", "Post 200", etc.
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
        return level > 200

    # things like "Recruit", "NotchOne", etc. -> we just allow by default
    return True

def prob_at_least_one(weight, total_weight, draws=3):
    """
    Approx chance that a reward with weight W in totalWeight
    appears >=1 time in N=3 picks.
    Uses 1 - (1-p)^3, where p = W/total.
    """
    if total_weight <= 0:
        return 0.0
    p = weight / total_weight
    return 1.0 - (1.0 - p) ** draws

def clean_loottable_name(s: str):
    """
    Strip [LTID] / [LBID] prefix from strings like "[LTID]PVP_PerkCharmDust"
    """
    if not isinstance(s, str):
        return None
    return re.sub(r"^\[(?:LTID|LBID)\]", "", s)

def safe_int(v, default=0):
    try:
        return int(v)
    except Exception:
        try:
            return int(float(v))
        except Exception:
            return default


# --------- LOAD RAW FILES

with open(INPUT_STORE, "r", encoding="utf-8") as f:
    store_rows = json.load(f)

with open(INPUT_REWARDS, "r", encoding="utf-8") as f:
    reward_rows = json.load(f)

with open(INPUT_LOOTTABLES, "r", encoding="utf-8") as f:
    loot_rows = json.load(f)

with open(INPUT_LOOTBUCKETS, "r", encoding="utf-8") as f:
    lootbuckets_rows = json.load(f)

with open(INPUT_HOUSING, "r", encoding="utf-8") as f:
    housing_rows = json.load(f)

with open(INPUT_GAMEEVENTS, "r", encoding="utf-8") as f:
    gameevents_rows = json.load(f)

with open(INPUT_ENUS, "r", encoding="utf-8") as f:
    en_us_raw = json.load(f)

with open(INPUT_EMOTES, "r", encoding="utf-8") as f:
    emote_defs = json.load(f)

# also read CSV for items / rarity / icons
with open(INPUT_ITEMCSV, "r", encoding="utf-8", newline="") as fcsv:
    csv_reader = csv.DictReader(fcsv)
    itemcsv_rows = list(csv_reader)

# build lowercase lookup for en-us
en_us_lower = {k.lower(): v for k, v in en_us_raw.items()}


# --------- TEXT / LOCALIZATION HELPERS

def humanize_from_key(k: str) -> str:
    """
    Turn 'ui_emote_frustrated_name' -> 'Frustrated'
    It's a fallback if we don't find it in en-us.json
    """
    if not k:
        return ""
    base = k.lower()
    base = re.sub(r"^ui_emote_", "", base)
    if base.endswith("_name"):
        base = base[:-5]
    parts = [p for p in base.split("_") if p]
    if not parts:
        return k
    return " ".join(p.capitalize() for p in parts)

def resolve_localized_name(raw: str) -> str:
    """
    Resolve:
    - '@Something_MasterName' via en-us.json
    - '@ui_emote_Frustrated_name' via en-us.json or fallback 'Frustrated'
    Otherwise just return raw.
    """
    if not raw:
        return ""
    if raw.startswith("@"):
        # strip '@' and lowercase for lookup in en-us
        k_full = raw[1:].strip().lower()
        # try exact
        if k_full in en_us_lower:
            return en_us_lower[k_full]
        # try removing _name suffix
        if k_full.endswith("_name"):
            k_short = k_full[:-5]
            if k_short in en_us_lower:
                return en_us_lower[k_short]
        # fallback to humanized
        return humanize_from_key(k_full)
    return raw


# --------- BUILD CATALOGS (item CSV, emotes, housing)

# item CSV -> build:
#   - catalog_by_id_lower:  itemId.lower() -> {name, icon, rarity}
#   - catalog_by_name_lower: prettyName.lower() -> {name, icon, rarity}
catalog_by_id_lower = {}
catalog_by_name_lower = {}

for row in itemcsv_rows:
    item_id_raw = (row.get("Item ID") or row.get("ItemID") or "").strip()
    raw_name = (row.get("Name") or "").strip()
    rarity = (row.get("Rarity") or "").strip()          # Artifact / Legendary / etc.
    icon_rel = (row.get("Icon Path") or row.get("IconPath") or "").strip()

    pretty_name = resolve_localized_name(raw_name) or item_id_raw
    icon_full = full_icon(icon_rel)

    rec = {
        "id": item_id_raw,
        "name": pretty_name,
        "icon": icon_full,
        "rarity": rarity.lower() if rarity else "",
    }

    if item_id_raw:
        catalog_by_id_lower[item_id_raw.lower()] = rec
    catalog_by_name_lower[rec["name"].lower()] = rec


# emote data
# emote_prettyname_by_key["ui_emote_frustrated_name"] -> "Frustrated"
# emote_icon_by_key["ui_emote_frustrated_name"] -> full icon URL
emote_icon_by_key = {}
emote_prettyname_by_key = {}

for e in emote_defs:
    disp_key = (e.get("DisplayName") or "").strip()  # e.g. "ui_emote_Frustrated_name"
    if not disp_key:
        continue
    k = disp_key.lower()

    # resolve display name via en-us, fallback to humanized
    if k in en_us_lower:
        pretty = en_us_lower[k]
    elif k.endswith("_name") and k[:-5] in en_us_lower:
        pretty = en_us_lower[k[:-5]]
    else:
        pretty = humanize_from_key(k)

    icon_path = e.get("UiImage") or ""
    emote_icon_by_key[k] = full_icon(icon_path)
    emote_prettyname_by_key[k] = pretty


# housing items:
# HouseItemID / Name(@House_..._MasterName) / IconPath
housing_by_id_lower = {}
for h in housing_rows:
    hid = (h.get("HouseItemID") or "").strip()
    raw_loc_name = (h.get("Name") or "").strip()  # ex: "@House_Season5_PVP_shelf_MasterName"
    pretty_name = resolve_localized_name(raw_loc_name) or hid

    icon_path = h.get("IconPath") or ""
    icon_full = full_icon(icon_path)

    rarity_val = (h.get("ItemRarity") or "").strip().lower()

    if hid:
        housing_by_id_lower[hid.lower()] = {
            "id": hid,
            "name": pretty_name,
            "icon": icon_full,
            "rarity": rarity_val,
        }
 
# game events:
# on map chaque EventID -> sa ligne complète pour récupérer les quantités
gameevent_by_id = {}
for ge in gameevents_rows:
    geid = (ge.get("EventID") or ge.get("EventId") or "").strip()
    if geid:
        gameevent_by_id[geid] = ge



def resolve_icon_and_rarity(reward_name_field: str, raw_item_id: str):
    """
    Guess icon + rarity for a reward.
    - reward_name_field might be "@ui_emote_Frustrated_name", "@House_..._MasterName", etc.
    - raw_item_id might be an itemID like "AzothSaltVialT1" or a housing ID.
    Returns (icon_url, rarity_lowercase).
    """
    icon_guess = ""
    rarity_guess = ""

    # If it's an @key (emote / housing style)
    if reward_name_field and reward_name_field.startswith("@"):
        k_full = reward_name_field[1:].strip().lower()  # "ui_emote_frustrated_name", etc.

        # emote?
        if k_full in emote_icon_by_key:
            icon_guess = emote_icon_by_key[k_full]
            # emotes don't really have rarity, leave empty

        # housing? (fallback if not emote)
        if not icon_guess and raw_item_id:
            h = housing_by_id_lower.get(raw_item_id.lower())
            if h:
                icon_guess = h["icon"]
                rarity_guess = h["rarity"] or rarity_guess

    # Try via localized name -> CSV match
    if not icon_guess:
        loc_nm = resolve_localized_name(reward_name_field)
        if loc_nm:
            rec = catalog_by_name_lower.get(loc_nm.lower())
            if rec:
                icon_guess = rec["icon"]
                rarity_guess = rarity_guess or rec["rarity"]

    # Try via raw item id -> CSV / housing
    if not icon_guess and raw_item_id:
        rec2 = catalog_by_id_lower.get(raw_item_id.lower())
        if rec2:
            icon_guess = rec2["icon"]
            rarity_guess = rarity_guess or rec2["rarity"]
        else:
            h2 = housing_by_id_lower.get(raw_item_id.lower())
            if h2:
                icon_guess = h2["icon"]
                rarity_guess = rarity_guess or h2["rarity"]

    return icon_guess, (rarity_guess or "")


# --------- 1) Build PVP_DATA

# collect all rows from the store with notch info
long_rows = []
for row in store_rows:
    rowname = row.get("RowPlaceholders", "")
    for notch_idx in (1, 2, 3):
        reward_id = row.get(f"RewardId{notch_idx}") or row.get(f"RewardID{notch_idx}") or ""
        if not reward_id:
            continue
        weight = int(row.get(f"RandomWeights{notch_idx}", 0) or 0)
        if weight <= 0:
            continue

        bucket_name = row.get(f"Bucket{notch_idx}", "")
        select_once = bool(row.get(f"SelectOnceOnly{notch_idx}", False))
        exclude_cat = row.get(f"ExcludeTypeStage{notch_idx}", "")

        long_rows.append({
            "notch": notch_idx,
            "bucket": bucket_name,
            "rewardId": reward_id,
            "weight": weight,
            "selectOnceOnly": select_once,
            "excludeTypeStage": exclude_cat,
            "rowName": rowname,
        })

# mark rewards that behave like "unique collectibles" (artifact / cosmetics etc.)
artifact_like_map = {}
for lr in long_rows:
    rid = lr["rewardId"]
    is_artifact = "artifact" in (lr.get("excludeTypeStage") or "").lower()
    artifact_like_map[rid] = artifact_like_map.get(rid, False) or is_artifact


def add_entry(store, level, notch, rewards_here):
    total_w = sum(r["weight"] for r in rewards_here)
    out_rows = []

    for r in rewards_here:
        w = r["weight"]
        p_single = (w / total_w * 100.0) if total_w > 0 else 0.0
        p_atleast = prob_at_least_one(w, total_w, 3) * 100.0
        out_rows.append({
            "rewardId": r["rewardId"],
            "weight": w,
            "selectOnceOnly": r.get("selectOnceOnly", False),
            "percentSingle": round(p_single, 4),
            "percentAtLeastOneOfThree": round(p_atleast, 4),
        })

    # sort by highest single-pick probability in that notch
    out_rows.sort(key=lambda x: x["percentSingle"], reverse=True)

    store.setdefault(str(level), {})[str(notch)] = {
        "totalWeight": total_w,
        "rewards": out_rows,
    }


PVP_DATA = {}
# precompute for levels 0..230 (front clamp to 200 anyway)
for lvl in range(0, 231):
    for notch in (1, 2, 3):
        possible = [r for r in long_rows
                    if r["notch"] == notch and bucket_applies(r["bucket"], lvl)]
        add_entry(PVP_DATA, lvl, notch, possible)


# --------- 2) Loot tables (LTID) structures

rows_by_loot_id = {row["LootTableID"]: row for row in loot_rows}

def build_loot_table_struct(table_id: str):
    """
    Return the tier structure for a loot table: which min threshold,
    gearscorerange, or subTable applies with Level/PvP_XP scaling.
    """
    row = rows_by_loot_id[table_id]
    probs = rows_by_loot_id.get(table_id + "_Probs", {})

    cond_list = row.get("Conditions", [])
    cond = cond_list[0] if isinstance(cond_list, list) and cond_list else None

    tiers = []
    i = 1
    while True:
        key_item = f"Item{i}"
        if key_item not in row:
            break

        raw_item = row.get(key_item)
        gs_val = row.get(f"GearScoreRange{i}")
        sub_table = None
        if isinstance(raw_item, str) and raw_item.startswith("[LTID]"):
            sub_table = clean_loottable_name(raw_item)

        thr = safe_int(probs.get(key_item, 0), 0)

        tiers.append({
            "min": thr,
            "gsRange": gs_val if gs_val is not None else None,
            "subTable": sub_table,
        })
        i += 1

    return {
        "condition": cond,  # "Level", "PvP_XP", etc.
        "tiers": tiers,
    }


def build_loot_roll_contents(table_id: str):
    """
    Return the actual rows of that loot table, with qty / minRoll etc.
    This is what the front uses to compute OR/AND bucket probabilities.
    """
    row = rows_by_loot_id[table_id]
    qtys = rows_by_loot_id.get(table_id + "_Qty", {})
    probs = rows_by_loot_id.get(table_id + "_Probs", {})

    cond_list = row.get("Conditions", [])
    cond = cond_list[0] if isinstance(cond_list, list) and cond_list else None

    rule_val = row.get("AND/OR") or row.get("AND\\/OR") or ""
    roll_bonus = row.get("RollBonusSetting") or ""
    max_roll = row.get("MaxRoll", 0)

    entries = []
    i = 1
    while True:
        key_item = f"Item{i}"
        if key_item not in row:
            break

        raw_item_field = row.get(key_item)
        qty_val = qtys.get(key_item)
        gs_val = row.get(f"GearScoreRange{i}")
        min_roll_val = safe_int(probs.get(key_item, 0), 0)

        entries.append({
            "raw": raw_item_field,
            "qty": qty_val,
            "gsRange": gs_val if gs_val is not None else None,
            "minRoll": min_roll_val,
        })
        i += 1

    return {
        "condition": cond,
        "rule": rule_val if rule_val else "OR",  # "OR", "AND", etc.
        "rollBonusSetting": roll_bonus,
        "maxRoll": max_roll,
        "entries": entries,
    }


PVP_LOOT_TABLES = {}
PVP_LOOT_CONTENTS = {}

for tid in rows_by_loot_id.keys():
    if tid.endswith("_Qty") or tid.endswith("_Probs"):
        continue
    PVP_LOOT_TABLES[tid] = build_loot_table_struct(tid)
    PVP_LOOT_CONTENTS[tid] = build_loot_roll_contents(tid)


# --------- 3) Bucket contents (LBID -> final item list)

# lootbuckets sheet works as:
# FIRSTROW row says: LootBucket1="PerkCharmMats_All", LootBucket2="PerkCharm", etc.
firstrow_lb = next(
    (r for r in lootbuckets_rows if (r.get("RowPlaceholders") or "").upper() == "FIRSTROW"),
    None
)

idx_to_bucket = {}
if firstrow_lb:
    for k, v in firstrow_lb.items():
        if isinstance(k, str) and k.startswith("LootBucket"):
            idx = k.replace("LootBucket", "")
            idx_to_bucket[idx] = v

bucket_contents = {b: [] for b in idx_to_bucket.values()}

for row in lootbuckets_rows:
    for idx, bucket_name in idx_to_bucket.items():
        item_key = f"Item{idx}"
        qty_key = f"Quantity{idx}"
        tags_key = f"Tags{idx}"

        if item_key in row and row[item_key]:
            tags_val = row.get(tags_key, [])
            if isinstance(tags_val, str):
                tags_val = [tags_val]

            bucket_contents[bucket_name].append({
                "itemId": row[item_key],
                "qty": row.get(qty_key, None),
                "tags": tags_val or [],
            })


# --------- 4) Reward meta (RewardID -> metadata used by the UI)

PVP_REWARD_META = {}

for r in reward_rows:
    rid = (r.get("RewardID") or r.get("RewardId") or "").strip()
    if not rid:
        continue

    raw_item_field = (r.get("Item") or "").strip()  # ex: "[LBID]PvP_FactionDye" ou "[LTID]PvP_BasicArmor..."
    def strip_prefix(x: str) -> str:
        if x.startswith("[LBID]"):
            return x[len("[LBID]"):]
        if x.startswith("[LTID]"):
            return x[len("[LTID]"):]
        return x
    item_clean = strip_prefix(raw_item_field)

    # --- classify
    is_lb = raw_item_field.startswith("[LBID]")
    is_lt = raw_item_field.startswith("[LTID]")

    meta = {
        "name": (r.get("Name") or "").strip(),
        "description": r.get("Description") or "",
        "icon": full_icon(r.get("IconPath") or ""),
        "rarity": "",
        "rollOnPresent": bool(r.get("RollOnPresent", False)),
        "quantity": r.get("Quantity"),
        "buyCost": r.get("BuyCategoricalProgressionCost"),
        "buyCurrency": r.get("BuyCategoricalProgressionCurrencyId") or r.get("CategoricalProgressionId") or "",
        "rawItemField": raw_item_field,
        "gameEvent": r.get("GameEvent") or "",

        # IMPORTANT:
        "lootTableId": None,
        "directBucketId": None,
    }

    # Si c’est un LBID -> on renseigne directBucketId et on NE RENSEIGNE PAS lootTableId
    if item_clean:
        if is_lt:
            # IMPORTANT :
            # Toujours garder la LootTable d'origine,
            # même si rollOnPresent est False,
            # sinon on ne peut plus calculer les GS ranges.
            meta["lootTableId"] = item_clean.replace("[LTID]", "")

        if is_lb and meta["rollOnPresent"]:
            # directBucketId ne doit exister que si on donne DIRECTEMENT ce bucket,
            # pas juste un sous-bucket d'une LT plus profonde.
            meta["directBucketId"] = item_clean.replace("[LBID]", "")

    # marqueurs entitlement / skins / artefacts
    is_ent = rid.startswith("ENT_")          # tous les ENT_ (skins, emotes, titres, etc.)
    is_skin = rid.startswith("ENT_Skin")     # uniquement les skins
    is_art = rid.startswith("ITM_Artifacts") or ("artifact" in (r.get("ExcludeTypeStage") or "").lower())

    # info annexe pour debug/affichage
    meta["isSkin"] = bool(is_skin)

    # uniqueEligible = peut être coché comme "Owned?"
    # - Artifacts => oui
    # - ENT_* sauf ENT_Skin* => oui (ex: emotes, titres, etc.)
    # - ENT_Skin* => non (les skins restent dans le pool même si tu les as)
    meta["uniqueEligible"] = bool(is_art or (is_ent and not is_skin))

    PVP_REWARD_META[rid] = meta




# --------- 5) Enrichment steps

def enrich_reward_meta(reward_meta_dict):
    """
    For each RewardID:
    - Compute a human display name (localized, CSV, housing, emote, etc.)
    - Pick best icon
    - Pick rarity color label ("legendary", "artifact", ...)
    """

    for rid, meta in reward_meta_dict.items():
        raw_name = (meta.get("name") or "").strip()
        raw_item_id = (meta.get("rawItemField") or "").strip()

        # 1. Name / display label
        display_name = resolve_localized_name(raw_name)

        # If that still looks bad (like "@...", "[LTID]...", same as raw ID)
        if (
            not display_name
            or display_name == rid
            or display_name.startswith("[LTID]")
            or display_name.startswith("@")
            or display_name == raw_item_id
        ):
            # try item ID in CSV (case-insensitive)
            if raw_item_id:
                rec_from_id = catalog_by_id_lower.get(raw_item_id.lower())
                if rec_from_id:
                    display_name = rec_from_id["name"]

                # try housing
                if (not display_name or display_name.startswith("@")) and raw_item_id.lower() in housing_by_id_lower:
                    display_name = housing_by_id_lower[raw_item_id.lower()]["name"]

        # Emote fallback: if raw_name is an @ui_emote_* key and we still didn't get a nice name
        if (not display_name or display_name.startswith("@")) and raw_name.startswith("@ui_emote"):
            k_full = raw_name[1:].strip().lower()  # "ui_emote_frustrated_name"
            if k_full in emote_prettyname_by_key:
                display_name = emote_prettyname_by_key[k_full]

        # Housing fallback (again, in case raw_name was @House_... and not found)
        if (
            (not display_name or display_name.startswith("@"))
            and raw_item_id
            and raw_item_id.lower() in housing_by_id_lower
        ):
            display_name = housing_by_id_lower[raw_item_id.lower()]["name"]

        # 2. Icon + rarity
        icon_guess, rarity_guess = resolve_icon_and_rarity(raw_name, raw_item_id)

        # 3. Si c'est un bundle GE_* basé sur un GameEvent,
        #    on ajoute la quantité dans le nom affiché.
        if rid.startswith("GE_"):
            gevent_id = (meta.get("gameEvent") or "").strip()
            ev = gameevent_by_id.get(gevent_id)
            bonus_val = None

            if ev:
                if rid.startswith("GE_FactionTokens"):
                    # FactionTokens est déjà dans les unités finales (pas besoin de /100)
                    try:
                        bonus_val = int(ev.get("FactionTokens", 0))
                    except Exception:
                        bonus_val = None

                elif rid.startswith("GE_Coin"):
                    # CurrencyReward est en centimes → on divise par 100
                    try:
                        bonus_val = int(ev.get("CurrencyReward", 0)) / 100
                    except Exception:
                        bonus_val = None

                elif rid.startswith("GE_Umbrals"):
                    # Umbral shards: valeur directe
                    try:
                        bonus_val = int(ev.get("UmbralCurrency", 0))
                    except Exception:
                        bonus_val = None

            if bonus_val is not None:
                # formater sans ".0" si c'est un entier
                if isinstance(bonus_val, float) and bonus_val.is_integer():
                    bonus_str = str(int(bonus_val))
                else:
                    bonus_str = str(int(bonus_val)) if isinstance(bonus_val, int) else str(bonus_val)

                display_name = f"{display_name} ({bonus_str})"

        # final assign
        meta["name"] = display_name or raw_name or rid
        meta["icon"] = icon_guess or meta.get("icon") or ""
        meta["rarity"] = rarity_guess or meta.get("rarity") or ""


def enrich_bucket_items(bucket_contents_dict):
    """
    For each LBID bucket entry:
    - Add displayName, icon, rarity for each concrete item that can drop.
    """

    for bucket_name, items in bucket_contents_dict.items():
        for it in items:
            raw_id = (it.get("itemId") or "").strip()

            # 1. Base display name
            disp = resolve_localized_name(raw_id)  # if it's @Some_Key
            if (
                not disp
                or disp == raw_id
                or disp.startswith("[LTID]")
                or disp.startswith("@")
            ):
                # Try CSV by item ID, case-insensitive
                rec = catalog_by_id_lower.get(raw_id.lower())
                if rec:
                    disp = rec["name"]
                else:
                    # Try housing
                    h = housing_by_id_lower.get(raw_id.lower())
                    if h:
                        disp = h["name"]

            # 2. Icon / rarity
            icon_val = ""
            rarity_val = ""

            # CSV direct by ID
            rec2 = catalog_by_id_lower.get(raw_id.lower())
            if rec2:
                icon_val = rec2["icon"]
                rarity_val = rec2["rarity"] or rarity_val

            # Housing direct
            if not icon_val and raw_id.lower() in housing_by_id_lower:
                h2 = housing_by_id_lower[raw_id.lower()]
                icon_val = h2["icon"]
                rarity_val = h2["rarity"] or rarity_val

            # Emote (in case bucket ever puts an emote)
            if not icon_val and raw_id:
                k_full = raw_id.lower()
                if k_full in emote_icon_by_key:
                    icon_val = emote_icon_by_key[k_full]
                    if k_full in emote_prettyname_by_key and (not disp or disp == raw_id):
                        disp = emote_prettyname_by_key[k_full]

            # Fallback by name
            if not icon_val and disp:
                recn = catalog_by_name_lower.get(disp.lower())
                if recn:
                    icon_val = recn["icon"]
                    rarity_val = rarity_val or recn["rarity"]

            it["displayName"] = disp or raw_id
            it["icon"] = icon_val or ""
            it["rarity"] = rarity_val or ""


# apply enrichment
enrich_reward_meta(PVP_REWARD_META)
enrich_bucket_items(bucket_contents)

# --------- OUTPUT (data.js)

with open(OUTPUT_JS, "w", encoding="utf-8") as f:
    f.write("window.PVP_DATA=" + json.dumps(PVP_DATA, separators=(",", ":")) + ";\n")
    f.write("window.PVP_REWARD_META=" + json.dumps(PVP_REWARD_META, separators=(",", ":")) + ";\n")
    f.write("window.PVP_LOOT_TABLES=" + json.dumps(PVP_LOOT_TABLES, separators=(",", ":")) + ";\n")
    f.write("window.PVP_LOOT_CONTENTS=" + json.dumps(PVP_LOOT_CONTENTS, separators=(",", ":")) + ";\n")
    f.write("window.PVP_BUCKET_CONTENTS=" + json.dumps(bucket_contents, separators=(",", ":")) + ";\n")

print("OK ->", OUTPUT_JS)
