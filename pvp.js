(function () {
  "use strict";

  // ----------------- STATE & HELPERS -----------------

  // Tri par défaut global (quand une colonne est en mode "sans sort")
  const DEFAULT_SORT_KEY = "trackPct";
  const DEFAULT_SORT_DIR = "desc";

  // État courant du tri de la table principale
  let SORT_KEY = DEFAULT_SORT_KEY;
  let SORT_DIR = DEFAULT_SORT_DIR;

  function getSortVal(row, key) {
    switch (key) {
      case "displayName": return (row.displayName || "").toLowerCase();
      case "cost":       return Number(row.cost)    || 0;
      case "gsMin":      return Number(row.gsMin)   || 0;

      case "n1Weight":      return Number(row.n1Weight)      || 0;
      case "n1PctSingle":   return Number(row.n1PctSingle)   || 0;
      case "n1PctAny":      return Number(row.n1PctAny)      || 0;

      case "n2Weight":      return Number(row.n2Weight)      || 0;
      case "n2PctSingle":   return Number(row.n2PctSingle)   || 0;
      case "n2PctAny":      return Number(row.n2PctAny)      || 0;

      case "n3Weight":      return Number(row.n3Weight)      || 0;
      case "n3PctSingle":   return Number(row.n3PctSingle)   || 0;
      case "n3PctAny":      return Number(row.n3PctAny)      || 0;

      case "trackPct":   return Number(row.trackPct) || 0;

      default: return 0;
    }
  }

  function sortMainRows(rows) {
    const mul = (SORT_DIR === "asc") ? 1 : -1;
    return rows.slice().sort((a,b) => {
      const av = getSortVal(a, SORT_KEY);
      const bv = getSortVal(b, SORT_KEY);
      if (av < bv) return -1 * mul;
      if (av > bv) return  1 * mul;
      return 0;
    });
  }
 
  // Met à jour l'état visuel des flèches dans le header principal
  function refreshSortHeaders() {
   document
      .querySelectorAll('thead th[data-sort-key]')
      .forEach(th => {
        th.classList.remove("active-sort-asc","active-sort-desc","cursor-pointer","select-none");
        th.classList.add("cursor-pointer","select-none");

        const key = th.getAttribute("data-sort-key");
        if (key === SORT_KEY) {
          if (SORT_DIR === "asc") {
            th.classList.add("active-sort-asc");
          } else {
            th.classList.add("active-sort-desc");
          }
        }
      });
  }


  function initMainHeaderSort() {
    document
      .querySelectorAll('thead th[data-sort-key]')
      .forEach(th => {
        th.classList.add("cursor-pointer","select-none");
        th.addEventListener("click", () => {
          const key = th.getAttribute("data-sort-key");

          if (SORT_KEY !== key) {
            // Nouveau tri sur cette colonne → état ASC en premier
            SORT_KEY = key;
            SORT_DIR = "asc";
          } else {
            // On clique encore la même colonne → cycle asc -> desc -> défaut
            if (SORT_DIR === "asc") {
              SORT_DIR = "desc";
            } else if (SORT_DIR === "desc") {
              // Troisième clic = retour à l'ordre par défaut global
              SORT_KEY = DEFAULT_SORT_KEY;
              SORT_DIR = DEFAULT_SORT_DIR;
            }
          }

          refreshSortHeaders();
          onCalc(); // re-render avec le nouveau tri
        });
      });

    // init visuel au chargement
    refreshSortHeaders();
  }

function makeInnerTableSortable(tableEl) {
  const tbody = tableEl.querySelector("tbody");
  if (!tbody) return;

  //
  // 1. Récupère le tri par défaut propre à CETTE table.
  //    On va l'indiquer sur <table data-default-col="9" data-default-dir="desc">
  //
  const defaultCol = parseInt(tableEl.getAttribute("data-default-col") || "0", 10);
  const defaultDir = tableEl.getAttribute("data-default-dir") || "desc";

  // état courant du tri pour cette table
  const state = { col: defaultCol, dir: defaultDir };

  //
  // 2. Resort = applique le tri courant (state.col/state.dir) sur les lignes.
  //    IMPORTANT : on trie des "groupes" {ligne principale + sa sous-ligne .bucket-items-row}
  //
  function resort() {
    const trs = Array.from(tbody.querySelectorAll("tr"));
    const groups = [];

    for (let i = 0; i < trs.length; i++) {
      const mainRow = trs[i];
      const maybeDetail = trs[i + 1];
      if (maybeDetail && maybeDetail.classList.contains("bucket-items-row")) {
        groups.push([mainRow, maybeDetail]);
        i++;
      } else {
        groups.push([mainRow]);
      }
    }

    const thForCol = tableEl.querySelector(`th[data-col-index="${state.col}"]`);
    const type = thForCol ? (thForCol.getAttribute("data-type") || "num") : "num";
    const mul = (state.dir === "asc") ? 1 : -1;

    groups.sort((A, B) => {
      const aCell = A[0].children[state.col];
      const bCell = B[0].children[state.col];

      let av = aCell ? (aCell.getAttribute("data-sort-val") || aCell.textContent || "") : "";
      let bv = bCell ? (bCell.getAttribute("data-sort-val") || bCell.textContent || "") : "";

      if (type === "num") {
        av = parseFloat(String(av).replace("%","")) || 0;
        bv = parseFloat(String(bv).replace("%","")) || 0;
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }

      if (av < bv) return -1 * mul;
      if (av > bv) return  1 * mul;
      return 0;
    });

    groups.forEach(g => g.forEach(tr => tbody.appendChild(tr)));
  }

  //
  // 3. refreshInnerSortHeaders = met à jour l'état visuel des flèches
  //    (mêmes classes .active-sort-asc / .active-sort-desc que le tableau principal)
  //
  function refreshInnerSortHeaders() {
    tableEl
      .querySelectorAll("th[data-col-index]")
      .forEach(th => {
        th.classList.remove("active-sort-asc","active-sort-desc","cursor-pointer","select-none");
        th.classList.add("cursor-pointer","select-none");

        const c = parseInt(th.getAttribute("data-col-index"),10);
        if (c === state.col) {
          if (state.dir === "asc") {
            th.classList.add("active-sort-asc");
          } else {
            th.classList.add("active-sort-desc");
          }
        }
      });
  }

  //
  // 4. Click handlers 3-états :
  //    - première fois qu'on clique une colonne -> ASC
  //    - deuxième clic -> DESC
  //    - troisième clic -> retour au tri par défaut (defaultCol/defaultDir)
  //
  tableEl.querySelectorAll("th[data-col-index]").forEach(th => {
    th.addEventListener("click", () => {
      const clickedCol = parseInt(th.getAttribute("data-col-index"),10);

      if (state.col !== clickedCol) {
        // nouvelle colonne → démarre en ASC
        state.col = clickedCol;
        state.dir = "asc";
      } else {
        // même colonne → on cycle
        if (state.dir === "asc") {
          state.dir = "desc";
        } else if (state.dir === "desc") {
          state.col = defaultCol;
          state.dir = defaultDir;
        }
      }

      resort();
      refreshInnerSortHeaders();
    });
  });

  // état initial : on force le tri par défaut
  // et on met direct en surbrillance la flèche correspondante,
  // même avant le premier clic (alignement visuel identique au tableau principal)
  resort();
  refreshInnerSortHeaders();
}


  function loadOwned() {
    try {
      const raw = localStorage.getItem("pvpOwnedRewards");
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveOwned(list) {
    localStorage.setItem("pvpOwnedRewards", JSON.stringify(list));
  }

  function isOwned(list, id) {
    return list.includes(id);
  }

  function toggleOwned(id) {
    const list = loadOwned();
    const i = list.indexOf(id);
    if (i === -1) list.push(id);
    else list.splice(i, 1);
    saveOwned(list);
  }

  // Uniquement ce que data.js marque comme uniqueEligible (Artifacts)
  function isUniqueEligible(rewardId) {
    const meta = window.PVP_REWARD_META?.[rewardId];
    return !!meta?.uniqueEligible;
  }

  // clamp inputs
  function clampPlayerLevel(v) {
    v = +v || 1;
    if (v < 1) v = 1;
    if (v > 70) v = 70;
    return v;
  }

  function clampTrackLevel(v) {
    v = +v || 0;
    if (v < 0) v = 0;
    if (v > 200) v = 200;
    return v;
  }

  function getNotchData(trackLvl, notch) {
    return window.PVP_DATA?.[String(trackLvl)]?.[String(notch)] || null;
  }

  function fmtPct(x) {
    if (!isFinite(x)) return "—";
    return x.toFixed(2).replace(",", ".") + " %";
  }

  // rarity -> CSS class for icon background
  function rarityClass(r) {
    const key = (r || "").toLowerCase();
    if (key === "artifact") return "rar-artifact";
    if (key === "legendary") return "rar-legendary";
    if (key === "epic") return "rar-epic";
    if (key === "rare") return "rar-rare";
    if (key === "uncommon") return "rar-uncommon";
    if (key === "common") return "rar-common";
    return "rar-unknown";
  }

  function getMeta(rewardId) {
    return window.PVP_REWARD_META?.[rewardId] || {};
  }

  function getDisplayName(rewardId) {
    const meta = getMeta(rewardId);
    if (meta.name && meta.name.trim()) return meta.name.trim();
    if (meta.rawItemField && meta.rawItemField.trim()) return meta.rawItemField.trim();
    return rewardId;
  }

  function getIconForReward(rewardId) {
    const meta = getMeta(rewardId);
    return meta.icon || "";
  }

  function getRarityForReward(rewardId) {
    const meta = getMeta(rewardId);
    return meta.rarity || "";
  }

  function getAzothCost(rewardId) {
    const meta = getMeta(rewardId);
    if (!meta) return "—";
    if (meta.buyCost === null || meta.buyCost === undefined) return "—";
    return meta.buyCost;
  }

  // ----------------- Gearscore estimation -----------------

  function pickTierForValue(def, value) {
    if (!def?.tiers) return null;
    let best = null;
    for (const t of def.tiers) {
      if (value >= t.min && (!best || t.min > best.min)) {
        best = t;
      }
    }
    return best;
  }

  // recursively follow subTable if present, pick best tier for player level / track XP etc.
  function resolveGsRangeFromLootTable(tableId, playerLevel, trackLevel) {
    if (!tableId || !window.PVP_LOOT_TABLES) return null;

    return (function pick(tid, seen) {
      if (seen.has(tid)) return null;
      seen.add(tid);

      const table = window.PVP_LOOT_TABLES[tid];
      if (!table) return null;

      const cond = table.condition || "Level";
      const val = /pvp.*xp/i.test(cond) ? trackLevel : playerLevel;

      const tier = pickTierForValue(table, val);
      if (!tier) return null;

      if (tier.gsRange && tier.gsRange !== "None") {
        return tier.gsRange;
      }
      if (tier.subTable && !seen.has(tier.subTable)) {
        return pick(tier.subTable, seen);
      }
      return null;
    })(tableId, new Set([tableId]));
  }

  function getGsRangeForReward(rewardId, playerLevel, trackLevel) {
    const lt = getMeta(rewardId).lootTableId;
    if (!lt) return "—";
    return resolveGsRangeFromLootTable(lt, playerLevel, trackLevel) || "—";
  }

  // ----------------- Filtering by owned uniques -----------------

function recomputeDistributionAfterFilter(levelData, ownedListOrSet) {
  if (!levelData || !levelData.rewards) {
    return { totalWeight: 0, rewards: [] };
  }
  const ownedSet = ownedListOrSet instanceof Set ? ownedListOrSet : new Set(ownedListOrSet);

  const kept = [];
  let totalW = 0;

  for (const row of levelData.rewards) {
    const rid = row.rewardId;
    if (!rid) continue;

    // on retire du pool uniquement si c'est un unique (cosmétique/artefact) déjà possédé
    if (isUniqueEligible(rid) && ownedSet.has(rid)) continue;

    kept.push({
      rewardId: rid,
      weight: row.weight,
      selectOnceOnly: !!row.selectOnceOnly, // <<< on le conserve
      percentSingle: 0,
      percentAtLeastOneOfThree: 0,
    });
    totalW += row.weight;
  }

  for (const k of kept) {
    if (totalW > 0) {
      const p = k.weight / totalW;
      k.percentSingle = p * 100;
      k.percentAtLeastOneOfThree = (1 - Math.pow(1 - p, 3)) * 100;
    }
  }

  kept.sort((a, b) => b.percentAtLeastOneOfThree - a.percentAtLeastOneOfThree);
  return { totalWeight: totalW, rewards: kept };
}


// pcts = [ pNotch1, pNotch2, pNotch3 ] en %
function trackAnyFromArray(pcts, onceOnly) {
  const p1 = (pcts[0] || 0) / 100;
  const p2 = (pcts[1] || 0) / 100;
  const p3 = (pcts[2] || 0) / 100;

  let total;
  if (onceOnly) {
    // séquentiel (si obtenu à N1, on ne peut plus l'avoir à N2/N3)
    total = p1 + (1 - p1) * p2 + (1 - p1) * (1 - p2) * p3;
  } else {
    // ancien modèle indépendant
    total = 1 - (1 - p1) * (1 - p2) * (1 - p3);
  }
  return total * 100;
}

  // ----------------- Loot Tables (LTID) / Buckets (LBID) -----------------

  function getTierIndexForValue(tableId, playerLevel, trackLevel) {
    const def = window.PVP_LOOT_TABLES?.[tableId];
    if (!def) return null;

    const cond = (def.condition || "").toLowerCase();
    const value = (cond.includes("pvp") && cond.includes("xp"))
      ? trackLevel
      : (cond.includes("level") ? playerLevel : null);

    if (value === null) return null;

    let bestIdx = null;
    let bestMin = -Infinity;
    const tiers = def.tiers || [];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      if (value >= t.min && t.min >= bestMin) {
        bestMin = t.min;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  // Build the "effective" loot table after picking tier for Level / PvP_XP etc.
  function getEffectiveLootTableModel(lootTableId, playerLevel, trackLevel, seen = new Set()) {
    if (seen.has(lootTableId)) {
      return {
        tableId: lootTableId,
        rule: "LOOP",
        condition: "",
        maxRoll: 0,
        mode: "SINGLE",
        entries: [],
      };
    }
    seen.add(lootTableId);

    const def = window.PVP_LOOT_TABLES?.[lootTableId];
    const data = window.PVP_LOOT_CONTENTS?.[lootTableId];
    if (!def || !data) {
      return {
        tableId: lootTableId,
        rule: "",
        condition: "",
        maxRoll: 0,
        mode: "SINGLE",
        entries: [],
      };
    }

    // If table has a condition and we can pick a tier, do that.
    const tierIdx = getTierIndexForValue(lootTableId, playerLevel, trackLevel);
    if (tierIdx !== null) {
        const tier = def.tiers && def.tiers[tierIdx];
        if (tier?.subTable) {
          // redirect to nested LTID
          return getEffectiveLootTableModel(tier.subTable, playerLevel, trackLevel, seen);
        }

        const chosen = (data.entries && data.entries[tierIdx]) ? [data.entries[tierIdx]] : [];
        return {
          tableId: lootTableId,
          rule: data.rule || "SINGLE",
          condition: data.condition || def.condition || "",
          maxRoll: data.maxRoll,
          mode: "SINGLE",
          entries: chosen,
        };
    }

    // else: treat the table as normal OR/AND distribution
    const ruleRaw = (data.rule || "").toUpperCase();
    const mode = ruleRaw.includes("AND") ? "AND" : "OR";

    return {
      tableId: lootTableId,
      rule: data.rule || mode,
      condition: data.condition || def.condition || "",
      maxRoll: data.maxRoll,
      mode,
      entries: data.entries || [],
    };
  }

  // Given an LTID model and the parent reward's % chances,
  // return the LBIDs with bucketPct, monoGlobalPct, atLeastGlobalPct, etc.
  function computeLBIDProbabilities(model, parentProbSinglePct, parentProbAtLeastOne3Pct) {
    const entriesInput = model.entries || [];
    const entries = Array.isArray(entriesInput) ? entriesInput : Object.values(entriesInput);

    // interpret maxRoll as the upper bound (inclusive-ish) of RNG for OR tables
    let maxRoll = parseInt(model.maxRoll, 10);
    if (isNaN(maxRoll) || maxRoll < 0) maxRoll = 0;

    function wrapAllWithProb(pBucketFrac) {
      // pBucketFrac ex: 0.25 for 25%
      const pParentSingle = (parentProbSinglePct || 0) / 100;
      const pParentAtLeast = (parentProbAtLeastOne3Pct || 0) / 100;

      const bucketPct = pBucketFrac * 100;
      const monoGlobal = pParentSingle * pBucketFrac * 100;
      const atLeastGlobal = pParentAtLeast * pBucketFrac * 100;
      return { bucketPct, monoGlobal, atLeastGlobal };
    }

    // SINGLE / AND / only one entry => guaranteed if the reward itself pops
    if (model.mode === "SINGLE" || model.mode === "AND" || entries.length <= 1) {
      return entries.map(e => {
        const probs = wrapAllWithProb(1.0);
        return {
          raw: e.raw,
          qty: e.qty,
          minRoll: e.minRoll,
          bucketPct: probs.bucketPct,
          monoGlobalPct: probs.monoGlobal,
          atLeastGlobalPct: probs.atLeastGlobal
        };
      });
    }

    // OR mode: need to split weights using minRoll thresholds from _Probs
    const tmp = entries.map((e, idx) => {
      let thr = parseInt(e.minRoll, 10);
      if (isNaN(thr) || thr < 0) thr = 0;
      return { idx, thr };
    }).sort((a, b) => b.thr - a.thr);

    const probsArr = new Array(entries.length).fill(0);

    for (let i = 0; i < tmp.length; i++) {
      const cur = tmp[i];
      const T_i = cur.thr;
      const T_prev = (i === 0) ? (maxRoll + 1) : tmp[i - 1].thr;

      let hi = Math.min(T_prev - 1, maxRoll);
      let lo = T_i;
      let countRange = hi - lo + 1;
      if (countRange < 0) countRange = 0;

      const denom = (maxRoll + 1);
      const p = (denom > 0) ? (countRange / denom) : 0;
      probsArr[cur.idx] = p;
    }

    return entries.map((e, idx) => {
      const pBucket = probsArr[idx] || 0;
      const probs = wrapAllWithProb(pBucket);
      return {
        raw: e.raw,
        qty: e.qty,
        minRoll: e.minRoll,
        bucketPct: probs.bucketPct,
        monoGlobalPct: probs.monoGlobal,
        atLeastGlobalPct: probs.atLeastGlobal
      };
    });
  }

  function cleanBucketNameFromLBID(s) {
    return (typeof s === "string") ? s.replace(/^\[LBID\]/, "") : "";
  }

  // Level tags in loot buckets: "Level:0-19", "Level:10-20", etc.
  function matchLevelTag(tag, lvl) {
    if (typeof tag !== "string") return true;
    const m = tag.match(/^Level:(\d+)(?:-(\d+))?$/i);
    if (!m) return true;
    const min = parseInt(m[1], 10);
    const max = (m[2] !== undefined) ? parseInt(m[2], 10) : 70;
    return (lvl >= min && lvl <= max);
  }

  function tagsMatchPlayerLevel(tags, lvl) {
    if (!tags?.length) return true;
    for (const t of tags) {
      if (/^Level:/i.test(t) && !matchLevelTag(t, lvl)) {
        return false;
      }
    }
    return true;
  }

  function getEligibleBucketItems(bucketName, playerLevel) {
    const all = window.PVP_BUCKET_CONTENTS?.[bucketName] || [];
    return all.filter(e => tagsMatchPlayerLevel(e.tags || [], playerLevel));
  }

  // styling helpers for % spans
  function pctSpan(val, notchIdx) {
    const cls = notchIdx === 1 ? "pct pct-n1"
              : notchIdx === 2 ? "pct pct-n2"
              : "pct pct-n3";
    return `<span class="${cls}">${fmtPct(val)}</span>`;
  }

  function pctTrackSpan(val) {
    return `<span class="pct-track">${fmtPct(val)}</span>`;
  }

let globalBucketDetailIdCounter = 0;

function buildLootDetailsHTMLMulti(lootTableId, playerLevel, trackLevel, perNotchParent) {
  const model = getEffectiveLootTableModel(lootTableId, playerLevel, trackLevel, new Set());
  if (!model) {
    return `<div class="text-xs text-slate-400">No details for ${lootTableId}</div>`;
  }

  // Did the parent reward have "selectOnceOnly" on any notch?
  const onceOnlyParent = [1,2,3].some(n => perNotchParent?.[n]?.selectOnceOnly);

  // 1) For each notch of the parent reward, compute probs of each LBID bucket.
  // We'll merge those into a bucketMap keyed by bucketName.
  const bucketMap = {}; // bucketName -> { notch: {1,2,3}, minRoll, qty }

  for (const notch of [1,2,3]) {
    const parentStats = perNotchParent?.[notch];
    if (!parentStats) continue;

    const probs = computeLBIDProbabilities(
      model,
      parentStats.percentSingle,
      parentStats.percentAtLeastOneOfThree
    );

    for (const p of probs) {
      const rawName = (typeof p.raw === "string" ? p.raw : (p.raw || ""));
      const bucketName = cleanBucketNameFromLBID(rawName);
      if (!bucketName) continue;

      if (!bucketMap[bucketName]) {
        bucketMap[bucketName] = {
          notch: {1:null,2:null,3:null},
          minRoll: p.minRoll || 0,
          qty: p.qty || "",
        };
      }

      bucketMap[bucketName].notch[notch] = {
        monoGlobalPct:    p.monoGlobalPct    || 0,
        atLeastGlobalPct: p.atLeastGlobalPct || 0,
        bucketPct:        p.bucketPct        || 0,
      };
    }
  }

  // 2) Convert that map into an array we can sort & render.
  const bucketRows = [];
  for (const bucketName in bucketMap) {
    const d = bucketMap[bucketName];
    const p1 = d.notch[1]?.atLeastGlobalPct || 0;
    const p2 = d.notch[2]?.atLeastGlobalPct || 0;
    const p3 = d.notch[3]?.atLeastGlobalPct || 0;

    // chance of getting at least one item from this bucket across the entire PvP track
    const trackPctBucket = trackAnyFromArray([p1, p2, p3], onceOnlyParent);

    bucketRows.push({
      bucketName,
      label: bucketName,
      qty: d.qty,
      minRoll: d.minRoll,
      perNotch: {
        1: d.notch[1] ? { mono: d.notch[1].monoGlobalPct, atLeast: d.notch[1].atLeastGlobalPct } : null,
        2: d.notch[2] ? { mono: d.notch[2].monoGlobalPct, atLeast: d.notch[2].atLeastGlobalPct } : null,
        3: d.notch[3] ? { mono: d.notch[3].monoGlobalPct, atLeast: d.notch[3].atLeastGlobalPct } : null,
      },
      trackPct: trackPctBucket,
    });
  }

  // sort buckets by highest overall track chance first
  bucketRows.sort((a,b) => b.trackPct - a.trackPct);

  // 3) Render HTML of the LootTable + its buckets
  let inner = `
    <div class="text-[11px] text-slate-300 font-mono mb-2">
      LootTable ${model.tableId}
    </div>

    <div class="rounded-lg border border-slate-700/60 bg-slate-900/40">
      <table class="w-full table-auto text-left text-[11px] text-slate-200 bucket-detail-table">
        <thead class="uppercase text-[9px] text-slate-300 bg-slate-900 sticky top-0 z-10">
          <tr class="bg-slate-900">
            <th rowspan="2"
                class="px-2 py-1 font-semibold border-b border-slate-700/60">
              Bucket (LBID)
            </th>

            <th rowspan="2"
                class="px-2 py-1 font-semibold text-right border-b border-slate-700/60">
              Qty
            </th>

            <th rowspan="2"
                class="px-2 py-1 font-semibold text-right border-b border-slate-700/60">
              MinRoll
            </th>

            <th colspan="2"
                class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n1">
              Notch 1
            </th>

            <th colspan="2"
                class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n2">
              Notch 2
            </th>

            <th colspan="2"
                class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n3">
              Notch 3
            </th>

            <th rowspan="2"
                class="px-2 py-1 font-semibold text-right border-b border-slate-700/60">
              % on Track
            </th>
          </tr>

          <tr class="bg-slate-900 text-[9px]">
            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n1">% single</th>
            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n1">% ≥1/3</th>

            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n2">% single</th>
            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n2">% ≥1/3</th>

            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n3">% single</th>
            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n3">% ≥1/3</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (!bucketRows.length) {
    inner += `
      <tr>
        <td colspan="10" class="px-2 py-2 text-slate-500 italic text-center">
          No valid entries for this loot table.
        </td>
      </tr>`;
  } else {
    for (const r of bucketRows) {
      const detailId = `bucket-items-${++globalBucketDetailIdCounter}`;
      const canDrill = !!window.PVP_BUCKET_CONTENTS?.[r.bucketName];

      const labelHTML = canDrill
        ? `<span class="lb-toggle cursor-pointer text-indigo-300 underline decoration-dotted hover:text-indigo-200"
                 tabindex="0" role="button"
                 data-target="${detailId}">${r.label}</span>`
        : `<span class="text-slate-300">${r.label}</span>`;

      // on ne rend plus la table d'items tout de suite.
      // on stocke les infos nécessaires dans data-* pour la construire plus tard (au clic).
      const encodedPerNotch   = r.perNotch
        ? JSON.stringify(r.perNotch).replace(/"/g, "&quot;")
        : "{}";
      const encodedSummaryRow = JSON.stringify(r).replace(/"/g, "&quot;");
      const onceOnlyAttr      = onceOnlyParent ? "1" : "0";

      let detailContentHtml;
      if (canDrill) {
        detailContentHtml =
          `<div class="bucket-items-container"
                data-bucket-name="${r.bucketName}"
                data-player-level="${playerLevel}"
                data-once-only="${onceOnlyAttr}"
                data-per-notch="${encodedPerNotch}"
                data-summary-row="${encodedSummaryRow}"></div>`;
      } else {
        detailContentHtml =
          `<div class="text-[10px] text-slate-500 italic">No item list for this bucket.</div>`;
      }

      inner += `
        <tr class="odd:bg-slate-800/40 even:bg-slate-800/20">
          <td class="px-2 py-1 font-mono text-[10px] break-all align-top">${labelHTML}</td>
          <td class="px-2 py-1 text-center align-top">${r.qty}</td>
          <td class="px-2 py-1 text-right align-top">${r.minRoll}</td>

          <td class="px-2 py-1 text-right align-top">${r.perNotch[1] ? pctSpan(r.perNotch[1].mono, 1) : "—"}</td>
          <td class="px-2 py-1 text-right align-top">${r.perNotch[1] ? pctSpan(r.perNotch[1].atLeast, 1) : "—"}</td>

          <td class="px-2 py-1 text-right align-top">${r.perNotch[2] ? pctSpan(r.perNotch[2].mono, 2) : "—"}</td>
          <td class="px-2 py-1 text-right align-top">${r.perNotch[2] ? pctSpan(r.perNotch[2].atLeast, 2) : "—"}</td>

          <td class="px-2 py-1 text-right align-top">${r.perNotch[3] ? pctSpan(r.perNotch[3].mono, 3) : "—"}</td>
          <td class="px-2 py-1 text-right align-top">${r.perNotch[3] ? pctSpan(r.perNotch[3].atLeast, 3) : "—"}</td>

          <td class="px-2 py-1 text-right align-top">
            <span class="pct-track">${fmtPct(r.trackPct)}</span>
          </td>
        </tr>

        <tr id="${detailId}" class="hidden bucket-items-row">
          <td colspan="10" class="px-2 pt-0 pb-2">
            ${detailContentHtml}
          </td>
        </tr>
      `;
    }
  }

  inner += `
        </tbody>
      </table>
    </div>
  `;

  return inner;
}



// bucketSummaryRow = la ligne du bucket parent (qty, minRoll, perNotch, trackPct...)
//                    pour afficher le petit encart récap au-dessus de la table.
function buildBucketItemsHTMLMulti(
  bucketName,
  playerLevel,
  bucketStatsPerNotch,
  onceOnlyParent,
  bucketSummaryRow
) {
  // safety: si on n'a pas reçu les stats par notch, on évite le crash
  if (!bucketStatsPerNotch) {
    bucketStatsPerNotch = {};
  }

  // filter items in the bucket by player level tags
  function matchLevelTag(tag, lvl) {
    if (typeof tag !== "string") return true;
    const m = tag.match(/^Level:(\d+)(?:-(\d+))?$/i);
    if (!m) return true;
    const min = parseInt(m[1], 10);
    const max = (m[2] !== undefined) ? parseInt(m[2], 10) : 70;
    return (lvl >= min && lvl <= max);
  }

  function tagsMatchPlayerLevel(tags, lvl) {
    if (!tags || !tags.length) return true;
    for (const t of tags) {
      if (/^Level:/i.test(t) && !matchLevelTag(t, lvl)) {
        return false;
      }
    }
    return true;
  }

  function getEligibleBucketItems(bucketName, lvl) {
    const all = window.PVP_BUCKET_CONTENTS?.[bucketName] || [];
    return all.filter(e => tagsMatchPlayerLevel(e.tags || [], lvl));
  }

  function pctSpan(val, notchIdx) {
    const cls = notchIdx === 1 ? "pct pct-n1"
              : notchIdx === 2 ? "pct pct-n2"
              : "pct pct-n3";
    return `<span class="${cls}">${fmtPct(val)}</span>`;
  }

  function pctTrackSpan(val) {
    return `<span class="pct-track">${fmtPct(val)}</span>`;
  }

  const items = getEligibleBucketItems(bucketName, playerLevel);
  const n = items.length;

  const rows = items.map(it => {
    const perNotch = { 1: null, 2: null, 3: null };

    for (const notch of [1, 2, 3]) {
      const bn = bucketStatsPerNotch[notch];
      if (!bn) continue;

      // bn can be { mono, atLeast } OR { monoGlobalPct, atLeastGlobalPct }
      const monoBucket    = (bn.mono    ?? bn.monoGlobalPct    ?? 0);
      const atleastBucket = (bn.atLeast ?? bn.atLeastGlobalPct ?? 0);

      perNotch[notch] = {
        mono:    n ? monoBucket    / n : 0,
        atLeast: n ? atleastBucket / n : 0,
      };
    }

    // chance to see this exact item on the full PvP track, not just inside bucket
    const trackPct = trackAnyFromArray(
      [
        perNotch[1]?.atLeast || 0,
        perNotch[2]?.atLeast || 0,
        perNotch[3]?.atLeast || 0,
      ],
      !!onceOnlyParent
    );

    return {
      displayName: it.displayName || it.itemId,
      icon: it.icon || "",
      rarity: rarityClass(it.rarity || ""),
      qty: it.qty ?? "—",
      perNotch,
      trackPct,
    };
  });

  // sort items in this bucket by "track chance" desc
  rows.sort((a, b) => b.trackPct - a.trackPct);

  // encart résumé du bucket ouvert : "garder la ligne du LB qu'on a ouvert en haut"
  // on ne l'affiche que si on a bien bucketSummaryRow (sinon, pas d'encart)
  let summaryBlock = "";
  if (bucketSummaryRow) {
    summaryBlock = `
      <div class="mb-2 rounded-xl border border-slate-700/60 bg-slate-800/80 p-2 text-[10px] leading-tight flex flex-wrap gap-x-4 gap-y-1">
        <div>
          <span class="text-slate-400">Bucket</span>
          <span class="font-mono text-indigo-300 break-all">
            ${bucketSummaryRow.label || bucketSummaryRow.bucketName || bucketName}
          </span>
        </div>
        <div>
          <span class="text-slate-400">Qty</span>
          <span class="font-mono text-slate-100">${bucketSummaryRow.qty ?? "—"}</span>
        </div>
        <div>
          <span class="text-slate-400">MinRoll</span>
          <span class="font-mono text-slate-100">${bucketSummaryRow.minRoll ?? "—"}</span>
        </div>
        <div>
          <span class="text-slate-400">%Track</span>
          ${pctTrackSpan(bucketSummaryRow.trackPct || 0)}
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-slate-400">N1</span>
          <span>${
            bucketSummaryRow.perNotch?.[1]
              ? pctSpan(bucketSummaryRow.perNotch[1].atLeast, 1)
              : "—"
          }</span>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-slate-400">N2</span>
          <span>${
            bucketSummaryRow.perNotch?.[2]
              ? pctSpan(bucketSummaryRow.perNotch[2].atLeast, 2)
              : "—"
          }</span>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-slate-400">N3</span>
          <span>${
            bucketSummaryRow.perNotch?.[3]
              ? pctSpan(bucketSummaryRow.perNotch[3].atLeast, 3)
              : "—"
          }</span>
        </div>
      </div>`;
  }


  // build HTML table for bucket items
  let html = `
    <div class="rounded-lg border border-slate-700/60 bg-slate-900/40 mt-2">
      ${summaryBlock}
      <table class="w-full table-auto text-left text-[10px] text-slate-200 bucket-final-table">
        <thead class="uppercase text-[9px] text-slate-300 bg-slate-900 sticky top-0 z-10">
          <tr class="bg-slate-900">
            <th rowspan="2"
                class="px-2 py-1 font-semibold text-center border-b border-slate-700/60">
              Icon
            </th>

            <th rowspan="2"
                class="px-2 py-1 font-semibold border-b border-slate-700/60">
              Item
            </th>

            <th rowspan="2"
                class="px-2 py-1 font-semibold text-right border-b border-slate-700/60">
              Qty
            </th>

            <th colspan="2"
                class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n1">
              Notch 1
            </th>

            <th colspan="2"
                class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n2">
              Notch 2
            </th>

            <th colspan="2"
                class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n3">
              Notch 3
            </th>

            <th rowspan="2"
                class="px-2 py-1 font-semibold text-right border-b border-slate-700/60">
              % on Track
            </th>
          </tr>

          <tr class="bg-slate-900 text-[9px]">
            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n1">% single</th>
            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n1">% ≥1/3</th>

            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n2">% single</th>
            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n2">% ≥1/3</th>

            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n3">% single</th>
            <th class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 subhead n3">% ≥1/3</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (!rows.length) {
    html += `
      <tr>
        <td colspan="10" class="px-2 py-2 text-slate-500 italic text-center">
          No visible item for this level / track.
        </td>
      </tr>`;
  } else {
    for (const r of rows) {
      html += `
        <tr class="odd:bg-slate-800/40 even:bg-slate-800/20">
          <td class="px-2 py-1 text-center align-top">
            <div class="icon-wrap ${r.rarity}">
              ${r.icon ? `<img src="${r.icon}" alt="" />` : ""}
            </div>
          </td>

          <td class="px-2 py-1 break-words align-top">${r.displayName}</td>
          <td class="px-2 py-1 text-right align-top">${r.qty}</td>

          <td class="px-2 py-1 text-right align-top">
            ${r.perNotch[1] ? pctSpan(r.perNotch[1].mono, 1) : "—"}
          </td>
          <td class="px-2 py-1 text-right align-top">
            ${r.perNotch[1] ? pctSpan(r.perNotch[1].atLeast, 1) : "—"}
          </td>

          <td class="px-2 py-1 text-right align-top">
            ${r.perNotch[2] ? pctSpan(r.perNotch[2].mono, 2) : "—"}
          </td>
          <td class="px-2 py-1 text-right align-top">
            ${r.perNotch[2] ? pctSpan(r.perNotch[2].atLeast, 2) : "—"}
          </td>

          <td class="px-2 py-1 text-right align-top">
            ${r.perNotch[3] ? pctSpan(r.perNotch[3].mono, 3) : "—"}
          </td>
          <td class="px-2 py-1 text-right align-top">
            ${r.perNotch[3] ? pctSpan(r.perNotch[3].atLeast, 3) : "—"}
          </td>

          <td class="px-2 py-1 text-right align-top">
            ${pctTrackSpan(r.trackPct)}
          </td>
        </tr>`;
    }
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  return html;
}



  // attach expand/collapse handlers to LBID rows inside a loot table detail block
function attachBucketRowToggles(root) {
  const toggles = Array.from(root.querySelectorAll(".lb-toggle[data-target]"));

  for (const t of toggles) {
    const targetId = t.getAttribute("data-target");
    const detailRow = targetId ? root.querySelector(`#${CSS.escape(targetId)}`) : null;
    if (!detailRow) continue;

    const doToggle = (ev) => {
      if (ev?.type === "keypress" && ev.key !== "Enter" && ev.key !== " ") return;

      detailRow.classList.toggle("hidden");

      // si on vient d'ouvrir la ligne du bucket
      if (!detailRow.classList.contains("hidden")) {
        // 1. lazy-build du contenu si pas déjà fait
        const container = detailRow.querySelector(".bucket-items-container");
        if (container && !container.dataset.filled) {
          const bucketName   = container.getAttribute("data-bucket-name");
          const playerLvl    = parseInt(container.getAttribute("data-player-level"), 10);
          const onceOnly     = container.getAttribute("data-once-only") === "1";

          // on a encodé les objets JSON en remplaçant " par &quot;.
          const perNotchJson = (container.getAttribute("data-per-notch") || "{}").replace(/&quot;/g, '"');
          const summaryJson  = (container.getAttribute("data-summary-row") || "{}").replace(/&quot;/g, '"');

          const perNotchObj  = JSON.parse(perNotchJson);
          const summaryObj   = JSON.parse(summaryJson);

          container.innerHTML = buildBucketItemsHTMLMulti(
            bucketName,
            playerLvl,
            perNotchObj,
            onceOnly,
            summaryObj
          );

          container.dataset.filled = "1";
        }
      }
    };

    t.addEventListener("click", doToggle);
    t.addEventListener("keypress", doToggle);
  }
}


  // ----------------- Building the table rows -----------------

  function buildAllNotchDists(trackLevel, playerLevel) {
    const owned = loadOwned();
    return {
      d1: recomputeDistributionAfterFilter(getNotchData(trackLevel, 1), owned),
      d2: recomputeDistributionAfterFilter(getNotchData(trackLevel, 2), owned),
      d3: recomputeDistributionAfterFilter(getNotchData(trackLevel, 3), owned),
    };
  }

function parseGsRangeToMinMax(gsStr) {
  if (!gsStr || gsStr === "—" || gsStr === "---") {
    return { gsMin: 0, gsMax: 0 };
  }
  const m = /(\d+)\s*-\s*(\d+)/.exec(gsStr);
  if (m) {
    return { gsMin: parseInt(m[1],10), gsMax: parseInt(m[2],10) };
  }
  const single = /(\d+)/.exec(gsStr);
  if (single) {
    const v = parseInt(single[1],10);
    return { gsMin: v, gsMax: v };
  }
  return { gsMin: 0, gsMax: 0 };
}


function buildMergedRows(playerLevel, trackLevel, d1, d2, d3) {
  // On fusionne les récompenses des 3 encoches (Notch 1/2/3)
  // pour produire UNE ligne par rewardId, avec les stats par encoche.
  const merged = {};

  function ingest(dist, notchNum) {
    if (!dist || !Array.isArray(dist.rewards)) return;
    for (const entry of dist.rewards) {
      const rid = entry.rewardId;
      if (!rid) continue;

      if (!merged[rid]) {
        merged[rid] = {
          rewardId: rid,
          perNotch: {},
          selectOnceOnly: false,
        };
      }

      // Sauvegarde les stats pour CETTE encoche
      merged[rid].perNotch[notchNum] = {
        weight: entry.weight || 0,
        percentSingle: entry.percentSingle || 0,
        percentAtLeastOneOfThree: entry.percentAtLeastOneOfThree || 0,
        selectOnceOnly: !!entry.selectOnceOnly,
      };

      // Si c'est "SelectOnceOnly" quelque part, on le marque sur la ligne globale
      if (entry.selectOnceOnly) {
        merged[rid].selectOnceOnly = true;
      }
    }
  }

  ingest(d1, 1);
  ingest(d2, 2);
  ingest(d3, 3);

  const rows = [];
  for (const rid in merged) {
    const m = merged[rid];

    // Probabilité d'obtenir AU MOINS UNE copie sur la track complète
    const p1 = m.perNotch[1]?.percentAtLeastOneOfThree || 0;
    const p2 = m.perNotch[2]?.percentAtLeastOneOfThree || 0;
    const p3 = m.perNotch[3]?.percentAtLeastOneOfThree || 0;
    const trackPct = trackAnyFromArray([p1, p2, p3], m.selectOnceOnly);

    // GS range affichée + min/max numériques pour le tri
    const gsStr = getGsRangeForReward(rid, playerLevel, trackLevel); // "590-600" ou "—"
    let gsMin = 0, gsMax = 0;
    if (gsStr && /\d/.test(gsStr)) {
      const m2 = gsStr.match(/(\d+)\s*-\s*(\d+)/);
      if (m2) {
        gsMin = +m2[1];
        gsMax = +m2[2];
      } else {
        const n = parseInt(gsStr, 10);
        if (!isNaN(n)) {
          gsMin = n;
          gsMax = n;
        }
      }
    }

    const meta = getMeta(rid);

    rows.push({
      rewardId: rid,
      displayName: getDisplayName(rid),
      gs: gsStr,
      gsMin, gsMax,
      cost: getAzothCost(rid),
      icon: getIconForReward(rid),
      rarity: getRarityForReward(rid),
      uniqueEligible: !!meta?.uniqueEligible,
      rollOnPresent: !!meta?.rollOnPresent,
      lootTableId: meta?.lootTableId || null,

      perNotch: m.perNotch,
      selectOnceOnly: m.selectOnceOnly,

      // Copies pratiques pour le tri / affichage de colonnes
      n1Weight: m.perNotch[1]?.weight || 0,
      n1PctSingle: m.perNotch[1]?.percentSingle || 0,
      n1PctAny: m.perNotch[1]?.percentAtLeastOneOfThree || 0,
      n2Weight: m.perNotch[2]?.weight || 0,
      n2PctSingle: m.perNotch[2]?.percentSingle || 0,
      n2PctAny: m.perNotch[2]?.percentAtLeastOneOfThree || 0,
      n3Weight: m.perNotch[3]?.weight || 0,
      n3PctSingle: m.perNotch[3]?.percentSingle || 0,
      n3PctAny: m.perNotch[3]?.percentAtLeastOneOfThree || 0,

      trackPct,
    });
  }

  // Tri par défaut = plus grosse chance Track1/9 en haut
  rows.sort((a, b) => b.trackPct - a.trackPct);
  return rows;
}



  // ----------------- Owned list UI -----------------

  function renderOwnedList() {
    const wrap = document.getElementById("ownedWrapper");
    const body = document.getElementById("ownedBody");
    const count = document.getElementById("ownedCount");
    if (!wrap || !body || !count) return;

    const raw = loadOwned().filter((id) => isUniqueEligible(id));
    if (!raw.length) {
      wrap.classList.add("hidden");
      body.innerHTML = "";
      count.textContent = "0";
      return;
    }

    wrap.classList.remove("hidden");
    count.textContent = String(raw.length);
    body.innerHTML = "";

    for (const rid of raw) {
      const tr = document.createElement("tr");
      tr.className = "odd:bg-slate-800/40 even:bg-slate-800/20";

      // ICON
      const tdIcon = document.createElement("td");
      tdIcon.className = "px-3 py-2 text-center align-top w-[2.5rem]";

      const iconUrl = getIconForReward(rid);
      const rarity  = getRarityForReward(rid);
      const rarityCls = rarityClass(rarity);

      const metaForRow = window.PVP_REWARD_META?.[rid] || {};
      const isLT = !!(metaForRow.rollOnPresent && metaForRow.lootTableId && !iconUrl);
      const isLB = !!(metaForRow.directBucketId && !iconUrl);

      tdIcon.innerHTML = `
        <div class="icon-wrap ${rarityCls}">
          ${
            iconUrl
              ? `<img src="${iconUrl}" alt="" />`
              : (isLT
                  ? `<span class="lt-badge">LT</span>`
                  : (isLB ? `<span class="lt-badge">LB</span>` : ""))
          }
        </div>`;

      // ITEM NAME
      const tdName = document.createElement("td");
      tdName.className = "px-3 py-2";
      tdName.textContent = getDisplayName(rid);

      // REMOVE BTN
      const tdAct = document.createElement("td");
      tdAct.className = "px-3 py-2 text-right w-[3rem]";
      const btn = document.createElement("button");
      btn.className =
        "text-red-400 hover:text-red-300 text-[14px] font-semibold px-2 py-1 rounded hover:bg-red-500/10 focus:outline-none";
      btn.setAttribute("aria-label", "Remove from owned");
      btn.textContent = "✕";
      btn.addEventListener("click", () => {
        toggleOwned(rid);
        onCalc();
      });
      tdAct.appendChild(btn);

      // ordre final : Icon | Item | ✕
      tr.appendChild(tdIcon);
      tr.appendChild(tdName);
      tr.appendChild(tdAct);
      body.appendChild(tr);
    }

  }

  // ----------------- Main table render -----------------

  function renderMergedRows(playerLevel, trackLevel, rows) {
    const tbody = document.getElementById("resultsBodyAll");
    if (!tbody) return;
    tbody.innerHTML = "";

    const owned = loadOwned();

    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.className = "odd:bg-slate-800/40 even:bg-slate-800/20 align-top";
      tr.id = `reward-${row.rewardId}`;
      tr.setAttribute("data-reward-id", row.rewardId);

      // Owned? column (checkbox for cosmetics / artifacts)
      const tdOwned = document.createElement("td");
      tdOwned.className = "px-2 py-2 text-center align-top w-[2rem]";
      if (row.uniqueEligible) {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "chk";
        cb.checked = isOwned(owned, row.rewardId);
        cb.setAttribute("aria-label", "Already owned?");
        cb.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleOwned(row.rewardId);
          onCalc();
        });
        tdOwned.appendChild(cb);
      } else {
        tdOwned.innerHTML = `<span class="text-slate-500 text-[11px]">—</span>`;
      }
      tr.appendChild(tdOwned);


        // Icon column
        const tdIcon = document.createElement("td");
        tdIcon.className = "px-2 py-2 text-center align-top w-[2.5rem]";

        const iconUrl = getIconForReward(row.rewardId);
        const rarity = getRarityForReward(row.rewardId);
        const rarityCls = rarityClass(rarity);

        // est-ce que c'est un LTID ? (rollOnPresent true et lootTableId présent)
        // et pas d'icône trouvée
        const metaForRow = window.PVP_REWARD_META?.[row.rewardId] || {};
        const isLT = !!(metaForRow.rollOnPresent && metaForRow.lootTableId && !iconUrl);
        const isLB = !!(metaForRow.directBucketId && !iconUrl);

        tdIcon.innerHTML = `
        <div class="icon-wrap ${rarityCls}">
            ${
            iconUrl
                ? `<img src="${iconUrl}" alt="" />`
                : (isLT ? `<span class="lt-badge">LT</span>`
                      : (isLB ? `<span class="lt-badge">LB</span>` : ""))
            }
        </div>
        `;
        tr.appendChild(tdIcon);


      // Item cell (clickable to expand loot table)
      const tdItem = document.createElement("td");
      tdItem.className = "px-2 py-2 break-words";
      tdItem.textContent = row.displayName;

      let detailsTr = null;
      if (row.rollOnPresent && row.lootTableId) {
        tdItem.classList.add(
          "cursor-pointer",
          "text-indigo-300",
          "underline",
          "decoration-dotted",
          "hover:text-indigo-200"
        );
        tdItem.setAttribute("tabindex", "0");
        tdItem.setAttribute("role", "button");

        detailsTr = document.createElement("tr");
        detailsTr.className = "bg-slate-900/60 hidden";

        const detailsTd = document.createElement("td");
        // colSpan must span all columns in main table
        detailsTd.colSpan = 14;
        detailsTd.className = "px-6 py-4 text-xs";

        // Build per-notch parent chances (for that reward only)
        const perNotchParent = {};
        for (const n of [1, 2, 3]) {
          if (row.perNotch && row.perNotch[n]) {
            perNotchParent[n] = {
              percentSingle: row.perNotch[n].percentSingle,
              percentAtLeastOneOfThree: row.perNotch[n].percentAtLeastOneOfThree,
              selectOnceOnly: row.perNotch[n].selectOnceOnly === true,
            };
          }
        }

        detailsTd.innerHTML = buildLootDetailsHTMLMulti(
          row.lootTableId,
          playerLevel,
          trackLevel,
          perNotchParent
        );

        detailsTr.appendChild(detailsTd);

        const toggle = (ev) => {
          if (ev?.type === "keypress" && ev.key !== "Enter" && ev.key !== " ")
            return;
          detailsTr.classList.toggle("hidden");
          if (!detailsTr.classList.contains("hidden")) {
            attachBucketRowToggles(detailsTd);
          }
        };

        tdItem.addEventListener("click", toggle);
        tdItem.addEventListener("keypress", toggle);
      }
      if (!detailsTr && metaForRow.directBucketId && window.PVP_BUCKET_CONTENTS?.[metaForRow.directBucketId]) {
        tdItem.classList.add(
          "cursor-pointer",
          "text-indigo-300",
          "underline",
          "decoration-dotted",
          "hover:text-indigo-200"
        );
        tdItem.setAttribute("tabindex", "0");
        tdItem.setAttribute("role", "button");

        detailsTr = document.createElement("tr");
        detailsTr.className = "bg-slate-900/60 hidden";

        const detailsTd = document.createElement("td");
        // use the same total colSpan as your current table (likely 15 with the Icon column)
        detailsTd.colSpan = 14;
        detailsTd.className = "px-6 py-4 text-xs";

        // per-notch probs for THIS reward (as the parent)
        const perNotchParent = {};
        for (const n of [1, 2, 3]) {
          if (row.perNotch && row.perNotch[n]) {
            // IMPORTANT: pass keys {mono, atLeast} for our bucket renderer
            perNotchParent[n] = {
              mono: row.perNotch[n].percentSingle,
              atLeast: row.perNotch[n].percentAtLeastOneOfThree,
            };
          }
        }

        // row.selectOnceOnly matters for track aggregation of inner items
        const onceOnlyParent = !!row.selectOnceOnly;

        // Construire un mini "bucketSummaryRow" pour l'affichage du bloc récap
        const pctsForTrack = [1, 2, 3].map(n => perNotchParent[n]?.atLeast || 0);
        const trackPctBucket = trackAnyFromArray(pctsForTrack, onceOnlyParent);

        const bucketSummaryRowObj = {
          bucketName: metaForRow.directBucketId,
          label: metaForRow.directBucketId,
          qty: "—",
          minRoll: "—",
          perNotch: {
            1: perNotchParent[1]
              ? { mono: perNotchParent[1].mono, atLeast: perNotchParent[1].atLeast }
              : null,
            2: perNotchParent[2]
              ? { mono: perNotchParent[2].mono, atLeast: perNotchParent[2].atLeast }
              : null,
            3: perNotchParent[3]
              ? { mono: perNotchParent[3].mono, atLeast: perNotchParent[3].atLeast }
              : null,
          },
          trackPct: trackPctBucket,
        };

        detailsTd.innerHTML = buildBucketItemsHTMLMulti(
          metaForRow.directBucketId,
          playerLevel,
          perNotchParent,
          onceOnlyParent,
          bucketSummaryRowObj
        );

        detailsTr.appendChild(detailsTd);

        const toggle = (ev) => {
          if (ev?.type === "keypress" && ev.key !== "Enter" && ev.key !== " ") return;
          detailsTr.classList.toggle("hidden");
          if (!detailsTr.classList.contains("hidden")) {
            attachBucketRowToggles(detailsTd); // keep LBID→final items toggles working
          }
        };

        tdItem.addEventListener("click", toggle);
        tdItem.addEventListener("keypress", toggle);
      }

      tr.appendChild(tdItem);

      // Azoth Salt column
      const tdCost = document.createElement("td");
      tdCost.className = "px-2 py-2 text-center align-top";
      tdCost.textContent = row.cost ?? "—";
      tr.appendChild(tdCost);


      // 3x triplets of columns for Notch1/Notch2/Notch3:
      // Weight / %single / %≥1/3
      for (const notch of [1, 2, 3]) {
        const d = row.perNotch[notch];
        const w = d?.weight;
        const pMono = d?.percentSingle;
        const pAtLeast = d?.percentAtLeastOneOfThree;

        const tdW = document.createElement("td");
        tdW.className = "px-2 py-2 text-right align-top";
        tdW.textContent = w ?? "—";
        tr.appendChild(tdW);

        const tdMono = document.createElement("td");
        tdMono.className = "px-2 py-2 text-right align-top";
        tdMono.innerHTML = pMono != null ? pctSpan(pMono, notch) : "—";
        tr.appendChild(tdMono);

        const tdAtLeast = document.createElement("td");
        tdAtLeast.className = "px-2 py-2 text-right align-top";
        tdAtLeast.innerHTML = pAtLeast != null ? pctSpan(pAtLeast, notch) : "—";
        tr.appendChild(tdAtLeast);
      }

      // Track1/9 column (green)
      const tdTrack = document.createElement("td");
      tdTrack.className = "px-2 py-2 text-right align-top";
      tdTrack.innerHTML = pctTrackSpan(row.trackPct);
      tr.appendChild(tdTrack);

      tbody.appendChild(tr);
      if (detailsTr) tbody.appendChild(detailsTr);
      document.querySelectorAll(".bucket-detail-table, .bucket-final-table")
        .forEach(tbl => makeInnerTableSortable(tbl));

    }
  }

  // ----------------- Main driver -----------------

  function onCalc() {
    const player = document.getElementById("playerLevelInput");
    const track = document.getElementById("trackLevelInput");

    const pLvl = clampPlayerLevel(player.value);
    const tLvl = clampTrackLevel(track.value);
    player.value = pLvl;
    track.value = tLvl;

    // Recalcule les distributions des 3 encoches avec le filtre "déjà possédé"
    const distAll = buildAllNotchDists(tLvl, pLvl);
    const { d1, d2, d3 } = distAll;

    // Compte des récompenses uniques proposées dans ce track
    const uniqueIds = new Set([
      ...d1.rewards.map(r => r.rewardId),
      ...d2.rewards.map(r => r.rewardId),
      ...d3.rewards.map(r => r.rewardId),
    ]);

    // Cartes récap du haut (Player / Notch1 / Notch2 / Notch3)
    const metaTop = document.getElementById("resultMeta");
    if (metaTop) {
      metaTop.innerHTML = `
        <!-- PLAYER -->
        <div class="bg-slate-800/60 rounded-lg border border-slate-700/60 p-3 flex flex-col justify-between">
          <div>
            <div class="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Player</div>
            <div class="text-sm font-mono text-slate-100 leading-tight">
              Lvl ${pLvl} / Track ${tLvl}
            </div>
          </div>
          <div class="text-[11px] text-slate-400 leading-tight mt-2">
            Unique rewards in track:
            <span class="text-emerald-400 font-semibold">${uniqueIds.size}</span>
          </div>
        </div>

        <!-- NOTCH 1 -->
        <div class="bg-slate-800/60 rounded-lg border border-sky-500/30 p-3">
          <div class="text-[11px] text-sky-400 font-medium uppercase tracking-wide">Notch 1</div>
          <div class="text-sm text-slate-100 leading-tight font-mono">${d1.totalWeight} weight</div>
          <div class="text-[11px] text-slate-400 leading-tight">${d1.rewards.length} options</div>
        </div>

        <!-- NOTCH 2 -->
        <div class="bg-slate-800/60 rounded-lg border border-violet-500/30 p-3">
          <div class="text-[11px] text-violet-400 font-medium uppercase tracking-wide">Notch 2</div>
          <div class="text-sm text-slate-100 leading-tight font-mono">${d2.totalWeight} weight</div>
          <div class="text-[11px] text-slate-400 leading-tight">${d2.rewards.length} options</div>
        </div>

        <!-- NOTCH 3 -->
        <div class="bg-slate-800/60 rounded-lg border border-amber-500/30 p-3">
          <div class="text-[11px] text-amber-400 font-medium uppercase tracking-wide">Notch 3</div>
          <div class="text-sm text-slate-100 leading-tight font-mono">${d3.totalWeight} weight</div>
          <div class="text-[11px] text-slate-400 leading-tight">${d3.rewards.length} options</div>
        </div>
      `;
    }

    // Construit toutes les lignes fusionnées avec stats Notch1/2/3
    const baseRows = buildMergedRows(pLvl, tLvl, d1, d2, d3);
    const sortrows = sortMainRows(baseRows);

    renderMergedRows(pLvl, tLvl, sortrows);
    renderOwnedList();
  }

// ----------------- SEARCH (name or ID → jump & expand) -----------------

// Build indexes once from data.js
const SEARCH_INDEX = (function buildSearchIndex() {
  const rewardMeta   = window.PVP_REWARD_META   || {};
  const lootContents = window.PVP_LOOT_CONTENTS || {};
  const buckets      = window.PVP_BUCKET_CONTENTS || {};

  const ltToRewards  = {};  // LTID -> [RewardId]
  const lbToRewards  = {};  // LBID -> [RewardId] (via LTID or directBucketId)
  const lbToLt       = {};  // LBID -> Set(LTID)
  const ltToLb       = {};  // LTID -> Set(LBID)
  const itemIdToLb   = {};  // itemId lower -> Set(LBID)
  const itemNameToLb = {};  // displayName lower -> Set(LBID)

  // Rewards -> LT or direct bucket
  Object.keys(rewardMeta).forEach(rid => {
    const m = rewardMeta[rid] || {};
    if (m.lootTableId) (ltToRewards[m.lootTableId] ||= []).push(rid);
    if (m.directBucketId) (lbToRewards[m.directBucketId] ||= []).push(rid);
  });

  // LT -> LB (scan raw "[LBID]..." entries)
  Object.keys(lootContents).forEach(tid => {
    const def = lootContents[tid];
    (def?.entries || []).forEach(e => {
      const raw = e.raw || "";
      if (typeof raw === "string" && raw.startsWith("[LBID]")) {
        const lb = raw.replace(/^\[LBID\]/, "");
        (lbToLt[lb] ||= new Set()).add(tid);
        (ltToLb[tid] ||= new Set()).add(lb);
      }
    });
  });

  // LB -> Rewards (via LT linkage)
  Object.keys(lbToLt).forEach(lb => {
    Array.from(lbToLt[lb]).forEach(tid => {
      (ltToRewards[tid] || []).forEach(rid => {
        (lbToRewards[lb] ||= []).push(rid);
      });
    });
  });

  // Items -> LB
  Object.keys(buckets).forEach(lb => {
    (buckets[lb] || []).forEach(e => {
      const id = (e.itemId || "").toLowerCase();
      const nm = (e.displayName || "").toLowerCase();
      if (id) (itemIdToLb[id] ||= new Set()).add(lb);
      if (nm) (itemNameToLb[nm] ||= new Set()).add(lb);
    });
  });

  return { ltToRewards, lbToRewards, lbToLt, ltToLb, itemIdToLb, itemNameToLb };
})();

function normalize(s) { return (s || "").trim().toLowerCase(); }

// Very small heuristic to route “Conscript’s …” / “Shatterer’s …”
function guessLtFromName(q) {
  const n = normalize(q);
  if (!n) return null;

  // crude weapon hints
  const hasWeaponWord = /(great axe|greataxe|sword|spear|bow|musket|blunderbuss|rapier|war hammer|hammer|greatsword|ice gauntlet|void gauntlet|fire staff|life staff|flail|hatchet)/i.test(q);

  // families commonly appearing in “Basic … Filter” tables
  if (/conscript'?s?/i.test(q)) return hasWeaponWord ? "BasicWeaponFilter" : "BasicArmorFilter";
  if (/shatterer'?s?/i.test(q)) return "BasicArmorFilter";

  return null;
}

function findBestSearchTarget(q) {
  const rewardMeta  = window.PVP_REWARD_META   || {};
  const buckets     = window.PVP_BUCKET_CONTENTS || {};
  const lootTables  = window.PVP_LOOT_CONTENTS || {};

  const n = normalize(q);
  if (!n) return null;

  const rewardsById = Object.keys(rewardMeta);
  const ltIds       = Object.keys(lootTables);
  const lbIds       = Object.keys(buckets);

  // 1) Exact ID
  if (rewardsById.some(r => r.toLowerCase() === n))
    return { kind: "reward", rewardId: rewardsById.find(r => r.toLowerCase() === n) };
  if (ltIds.some(t => t.toLowerCase() === n))
    return { kind: "lt", ltId: ltIds.find(t => t.toLowerCase() === n) };
  if (lbIds.some(b => b.toLowerCase() === n))
    return { kind: "lb", lbId: lbIds.find(b => b.toLowerCase() === n) };

  // ItemId exact
  if (SEARCH_INDEX.itemIdToLb[n]?.size) {
    return { kind: "item", itemId: q, lbId: Array.from(SEARCH_INDEX.itemIdToLb[n])[0] };
  }

  // 2) Reward display name exact
  const rByNameExact = rewardsById.find(r => normalize(getDisplayName(r)) === n);
  if (rByNameExact) return { kind: "reward", rewardId: rByNameExact };

  // 3) Item display name exact (only items explicitly listed in a LB)
  if (SEARCH_INDEX.itemNameToLb[n]?.size) {
    return { kind: "itemByName", itemName: q, lbId: Array.from(SEARCH_INDEX.itemNameToLb[n])[0] };
  }

  // 4) Prefix matches
  const rByIdPre = rewardsById.find(r => r.toLowerCase().startsWith(n));
  if (rByIdPre) return { kind: "reward", rewardId: rByIdPre };
  const ltPre = ltIds.find(t => t.toLowerCase().startsWith(n));
  if (ltPre) return { kind: "lt", ltId: ltPre };
  const lbPre = lbIds.find(b => b.toLowerCase().startsWith(n));
  if (lbPre) return { kind: "lb", lbId: lbPre };
  const itemIdPre = Object.keys(SEARCH_INDEX.itemIdToLb).find(id => id.startsWith(n));
  if (itemIdPre) return { kind: "item", itemId: itemIdPre, lbId: Array.from(SEARCH_INDEX.itemIdToLb[itemIdPre])[0] };


  // 5) Substring matches
  const rByNameSub = rewardsById.find(r => getDisplayName(r).toLowerCase().includes(n));
  if (rByNameSub) return { kind: "reward", rewardId: rByNameSub };

  const itemNameSub = Object.keys(SEARCH_INDEX.itemNameToLb).find(nm => nm.includes(n));
  if (itemNameSub) {
    return {
      kind: "itemByName",
      itemName: itemNameSub,
      lbId: Array.from(SEARCH_INDEX.itemNameToLb[itemNameSub])[0]
    };
  }

  const lbSub = lbIds.find(b => b.toLowerCase().includes(n));
  if (lbSub) return { kind: "lb", lbId: lbSub };

  const ltSub = ltIds.find(t => t.toLowerCase().includes(n));
  if (ltSub) return { kind: "lt", ltId: ltSub };

  // 6) Heuristic families → LTID (ex: "Conscript's …" → BasicWeaponFilter)
  const hintLt = guessLtFromName(q);
  if (hintLt && ltIds.includes(hintLt)) {
    return { kind: "lt", ltId: hintLt };
  }

  return null;
}

function smoothScrollIntoView(el) {
  if (!el) return;
  try { el.scrollIntoView({ behavior: "smooth", block: "center" }); }
  catch { el.scrollIntoView(); }
}

function highlight(el) {
  if (!el) return;
  el.classList.add("search-highlight");
  setTimeout(() => el.classList.remove("search-highlight"), 1600);
}

// Expand the bucket row for a given LBID inside the reward details
function expandBucket(detailsRoot, lbId) {
  if (!detailsRoot) return null;
  const toggles = Array.from(detailsRoot.querySelectorAll(".lb-toggle"));
  const toggle = toggles.find(t => (t.textContent || "").trim() === lbId);
  if (toggle) {
    toggle.click(); // reveal nested item list
    const targetId = toggle.getAttribute("data-target");
    if (targetId) {
      const row = detailsRoot.querySelector(`#${CSS?.escape ? CSS.escape(targetId) : targetId}`);
      return row || detailsRoot;
    }
  }
  return detailsRoot;
}

// If we have an LTID but no LBID, resolve the *effective* LB with current sliders
function resolveLbFromLtForCurrentLevel(ltId) {
  const playerLevel = clampPlayerLevel(document.getElementById("playerLevelInput").value);
  const trackLevel  = clampTrackLevel(document.getElementById("trackLevelInput").value);

  // Use your existing function to pick the tier/subTable for current values:
  const model = getEffectiveLootTableModel(ltId, playerLevel, trackLevel); // returns {entries:[{raw:"[LBID]..."}, ...]}
  const entry = (model?.entries || [])[0];
  const raw = entry?.raw || "";
  if (raw.startsWith("[LBID]")) return raw.replace(/^\[LBID\]/, "");
  return null;
}

// Jump to the reward row, open details, open bucket, then try to highlight the item
function jumpTo({ rewardId, ltId, lbId, itemName, itemId }) {
  // Ensure DOM matches current sliders
  onCalc();

  const tbody = document.getElementById("resultsBodyAll");
  if (!tbody) return;

  // 1) Find the reward row
  const rewardRow = tbody.querySelector(`[data-reward-id="${rewardId}"]`);
  if (!rewardRow) {
    alert("No visible result for this PvP Track level.");
    return;
  }
  smoothScrollIntoView(rewardRow);
  highlight(rewardRow);

  // 2) Open details (name cell toggler)
  const clickableNameCell = rewardRow.querySelector('[role="button"], .cursor-pointer');
  if (clickableNameCell) clickableNameCell.click();

  // 3) Wait one frame so the details row gets injected
  requestAnimationFrame(() => {
    const detailsRow = rewardRow.nextElementSibling?.classList?.contains("bg-slate-900/60")
      ? rewardRow.nextElementSibling : null;
    const detailsTd = detailsRow ? detailsRow.querySelector("td") : null;
    if (!detailsTd) return;

    // If we have an LT but not LB, compute the LB actually used at this level
    if (ltId && !lbId) {
      lbId = resolveLbFromLtForCurrentLevel(ltId);
    }

    if (lbId) {
      const bucketRow = expandBucket(detailsTd, lbId);
      let finalTarget = bucketRow || detailsTd;
      let scrollTarget = finalTarget;

      // Try to highlight a specific item line (if present & eligible for level)
      if (itemName || itemId) {
        const needle = normalize(itemName || itemId);
        const scopeEl = bucketRow || detailsTd;
        const itemRows = Array.from(scopeEl.querySelectorAll("tbody tr"));
        const match = itemRows.find(tr => normalize(tr.textContent).includes(needle));
        if (match) {
          finalTarget = match;
          scrollTarget = match;
        }
      }

      smoothScrollIntoView(scrollTarget);
      highlight(finalTarget);

    } else if (ltId) {
      // No bucket resolved → just highlight the LootTable header
      const header = Array.from(detailsTd.querySelectorAll("div,span"))
        .find(el => (el.textContent || "").includes(`LootTable ${ltId}`));
      if (header) {
        smoothScrollIntoView(header);
        highlight(header);
      }
    }
  });
}

// Helper: parmi une liste de RewardIds candidats, renvoie celui qui est VISIBLE
function firstVisibleRewardIdFrom(candidates) {
  const tbody = document.getElementById("resultsBodyAll");
  if (!tbody) return null;
  for (const rid of candidates || []) {
    if (tbody.querySelector(`[data-reward-id="${rid}"]`)) {
      return rid;
    }
  }
  return null;
}

function runSearch() {
  const input = document.getElementById("searchInput");
  if (!input) return;

  const q = input.value || "";
  const target = findBestSearchTarget(q);

  if (!target) {
    alert("No match. Try a RewardId, LTID, LBID, ItemId, or part of an item name.");
    return;
  }

  // IMPORTANT: on force un render AVANT de choisir le reward visible
  onCalc();

  let rewardId = null;
  let ltId     = null;
  let lbId     = null;
  let itemName = null;
  let itemId   = null;

  // petit util local pour éviter de répéter le code
  function pickVisibleRewardFromLbList(lbList) {
    for (const candidateLb of lbList || []) {
      const candidates = SEARCH_INDEX.lbToRewards[candidateLb] || [];
      const vis = firstVisibleRewardIdFrom(candidates);
      if (vis) {
        lbId = candidateLb;
        return vis;
      }
    }
    return null;
  }

  if (target.kind === "reward") {
    // On vérifie que CE rewardId est visible
    rewardId = firstVisibleRewardIdFrom([target.rewardId]);

  } else if (target.kind === "lt") {
    ltId = target.ltId;
    // Tous les rewards qui utilisent cette LootTable
    const cands = SEARCH_INDEX.ltToRewards[ltId] || [];
    rewardId = firstVisibleRewardIdFrom(cands);

  } else if (target.kind === "lb") {
    // Tous les rewards qui finissent par dropper ce bucket
    const cands = SEARCH_INDEX.lbToRewards[target.lbId] || [];
    lbId = target.lbId;
    rewardId = firstVisibleRewardIdFrom(cands);

  } else if (target.kind === "item") {
    itemId = target.itemId;
    // Tous les LB qui contiennent cet ItemId
    const lbs = Array.from(SEARCH_INDEX.itemIdToLb[normalize(itemId)] || []);
    rewardId = pickVisibleRewardFromLbList(lbs);

  } else if (target.kind === "itemByName") {
    itemName = target.itemName;
    // Tous les LB qui contiennent un item dont le nom correspond
    const lbs = Array.from(SEARCH_INDEX.itemNameToLb[normalize(itemName)] || []);
    rewardId = pickVisibleRewardFromLbList(lbs);
  }

  if (!rewardId) {
    alert("Found that item/name, but it's not obtainable with the current Track level / Player level.");
    return;
  }

  // Dernier détail :
  // si l'utilisateur a tapé un LT mais pas de lbId,
  // on peut dériver le bon LB actif pour ce niveau:
  if (!lbId && ltId) {
    const resolvedLb = resolveLbFromLtForCurrentLevel(ltId);
    if (resolvedLb) {
      lbId = resolvedLb;
    }
  }

  jumpTo({ rewardId, ltId, lbId, itemName, itemId });
}


// Wire up Search UI (keep as you already have)
function wireSearchUI() {
  const btn = document.getElementById("searchBtn");
  const inp = document.getElementById("searchInput");
  if (btn) btn.addEventListener("click", runSearch);
  if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
}


  // Recalculate button
  document.getElementById("calcBtn").addEventListener("click", onCalc);

  // Initial render + hook search
  onCalc();
  wireSearchUI();
  initMainHeaderSort();

})();
