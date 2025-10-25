(function () {
  "use strict";

  // ----------------- STATE & HELPERS -----------------

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

  // cosmetic / artifact etc.
  function isUniqueEligible(rewardId) {
    const meta = window.PVP_REWARD_META?.[rewardId];
    if (!meta) return false;
    if (meta.uniqueEligible !== undefined) return !!meta.uniqueEligible;
    return rewardId.startsWith("ENT_") || rewardId.startsWith("ITM_Artifacts");
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
    return x.toFixed(2) + " %";
  }

  function getDisplayName(rewardId) {
    const meta = window.PVP_REWARD_META?.[rewardId];
    if (!meta) return rewardId;
    if (meta.name && meta.name.trim() && meta.name !== rewardId) return meta.name;
    if (meta.rawItemField && meta.rawItemField.trim()) return meta.rawItemField;
    return rewardId;
  }

  function getAzothCost(rewardId) {
    const meta = window.PVP_REWARD_META?.[rewardId];
    if (!meta) return "—";
    if (meta.buyCost === null || meta.buyCost === undefined) return "—";
    return meta.buyCost;
  }

  function pickTierForValue(def, value) {
    if (!def?.tiers) return null;
    let best = null;
    for (const t of def.tiers) {
      if (value >= t.min && (!best || t.min > best.min)) best = t;
    }
    return best;
  }

  function resolveGsRangeFromLootTable(tableId, playerLevel, trackLevel, seen = new Set()) {
    if (!tableId || !window.PVP_LOOT_TABLES) return null;
    if (seen.has(tableId)) return null;
    seen.add(tableId);

    const def = window.PVP_LOOT_TABLES[tableId];
    if (!def) return null;

    const cond = def.condition || "Level";
    const val = /pvp.*xp/i.test(cond) ? trackLevel : playerLevel;
    return (function pick(tid, seen2) {
      const table = window.PVP_LOOT_TABLES[tid];
      if (!table) return null;
      const tier = pickTierForValue(table, val);
      if (!tier) return null;
      if (tier.gsRange && tier.gsRange !== "None") return tier.gsRange;
      if (tier.subTable && !seen2.has(tier.subTable)) {
        seen2.add(tier.subTable);
        return pick(tier.subTable, seen2);
      }
      return null;
    })(tableId, new Set([tableId]));
  }

  function getGsRangeForReward(rewardId, playerLevel, trackLevel) {
    const lt = window.PVP_REWARD_META?.[rewardId]?.lootTableId;
    if (!lt) return "—";
    return resolveGsRangeFromLootTable(lt, playerLevel, trackLevel) || "—";
  }

  function recomputeDistributionAfterFilter(levelData, ownedList) {
    if (!levelData) return { totalWeight: 0, rewards: [] };

    let total = 0;
    const kept = [];

    for (const row of levelData.reards ?? levelData.rewards ?? []) {
      const rid = row.rewardId;
      if (!rid) continue;

      // hide owned uniques
      if (isUniqueEligible(rid) && ownedList.includes(rid)) continue;

      total += row.weight;
      kept.push({
        rewardId: rid,
        weight: row.weight,
        percentSingle: 0,
        percentAtLeastOneOfThree: 0,
      });
    }

    for (const k of kept) {
      if (total > 0) {
        const p = k.weight / total;
        k.percentSingle = p * 100;
        k.percentAtLeastOneOfThree = (1 - Math.pow(1 - p, 3)) * 100;
      }
    }

    kept.sort((a, b) => b.percentSingle - a.percentSingle);
    return { totalWeight: total, rewards: kept };
  }

  function trackAnyFromArray(pcts) {
    let prod = 1;
    for (const p of pcts) {
      prod *= 1 - (p || 0) / 100;
    }
    return (1 - prod) * 100;
  }

  // ---------- Loot tables / buckets ----------

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

    const tierIdx = getTierIndexForValue(lootTableId, playerLevel, trackLevel);
    if (tierIdx !== null) {
      const tier = def.tiers[tierIdx];
      if (tier?.subTable) {
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

  function computeLBIDProbabilities(model, parentSinglePct, parentAtLeastPct) {
    const entries = model.entries || [];
    let maxRoll = parseInt(model.maxRoll, 10);
    if (isNaN(maxRoll) || maxRoll < 0) maxRoll = 0;

    function wrap(pBucket) {
      const pS = (parentSinglePct || 0) / 100;
      const pA = (parentAtLeastPct || 0) / 100;
      return {
        bucketPct: pBucket * 100,
        monoGlobal: pS * pBucket * 100,
        atLeastGlobal: pA * pBucket * 100,
      };
    }

    // SINGLE / AND : guaranteed entry
    if (model.mode === "SINGLE" || model.mode === "AND") {
      return entries.map(e => ({
        raw: e.raw,
        qty: e.qty,
        minRoll: e.minRoll,
        ...wrap(1),
      }));
    }

    // OR with thresholds / minRoll logic
    const arr = entries
      .map((e, i) => ({
        i,
        thr: Math.max(0, parseInt(e.minRoll ?? 0, 10) || 0),
      }))
      .sort((a, b) => b.thr - a.thr);

    const probs = new Array(entries.length).fill(0);
    for (let k = 0; k < arr.length; k++) {
      const Ti = arr[k].thr;
      const Tprev = (k === 0) ? (maxRoll + 1) : arr[k - 1].thr;
      const hi = Math.min(Tprev - 1, maxRoll);
      const lo = Ti;
      const count = Math.max(0, hi - lo + 1);
      const denom = (maxRoll + 1) || 1;
      probs[arr[k].i] = count / denom;
    }

    return entries.map((e, idx) => ({
      raw: e.raw,
      qty: e.qty,
      minRoll: e.minRoll,
      ...wrap(probs[idx] || 0),
    }));
  }

  function cleanBucketNameFromLBID(s) {
    return (typeof s === "string") ? s.replace(/^\[LBID\]/, "") : "";
  }

  // Level tags in loot buckets: "Level:0-19" etc
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

  // pretty % spans
  function pctSpan(val, notchIdx) {
    const cls = notchIdx === 1 ? "pct pct-n1"
              : notchIdx === 2 ? "pct pct-n2"
              : "pct pct-n3";
    return `<span class="${cls}">${fmtPct(val)}</span>`;
  }

  function pctTrackSpan(val) {
    return `<span class="pct-track">${fmtPct(val)}</span>`;
  }

  // -------- final items inside a bucket (LBID) --------
  function buildBucketItemsHTMLMulti(bucketName, playerLevel, bucketStatsPerNotch) {
    const items = getEligibleBucketItems(bucketName, playerLevel);
    const n = items.length;

    const rows = items.map(it => {
      const perNotch = { 1: null, 2: null, 3: null };
      for (const notch of [1, 2, 3]) {
        const bn = bucketStatsPerNotch[notch];
        if (!bn) continue;
        const monoBucket = bn.monoGlobalPct || 0;
        const atleastBucket = bn.atLeastGlobalPct || 0;
        perNotch[notch] = {
          mono: n ? monoBucket / n : 0,
          atLeast: n ? atleastBucket / n : 0,
        };
      }
      const trackPct = trackAnyFromArray([
        perNotch[1]?.atLeast || 0,
        perNotch[2]?.atLeast || 0,
        perNotch[3]?.atLeast || 0,
      ]);
      return {
        itemId: it.itemId,
        qty: it.qty ?? "—",
        perNotch,
        trackPct,
      };
    });

    let html = `
      <div class="mt-2 rounded-lg border border-slate-700/60 bg-slate-900/40">
        <div class="px-3 py-2 text-[10px] text-slate-400">
          Final items from bucket <span class="font-mono text-indigo-300">${bucketName}</span>
          · ${n || 0} eligible
        </div>
        <div>
          <table class="w-full table-auto text-left text-[11px] text-slate-200">
            <thead class="uppercase text-[10px] text-slate-300 bg-slate-900 sticky top-0 z-10">
              <tr>
                <th rowspan="2" class="px-2 py-1 font-semibold border-b border-slate-700/60">
                  Item
                </th>
                <th rowspan="2" class="px-2 py-1 font-semibold text-center border-b border-slate-700/60">
                  Qty
                </th>
                <th colspan="2" class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n1">
                  Notch&nbsp;1
                </th>
                <th colspan="2" class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n2">
                  Notch&nbsp;2
                </th>
                <th colspan="2" class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n3">
                  Notch&nbsp;3
                </th>
                <th rowspan="2" class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 th-track">
                  %Track1/9
                </th>
              </tr>
              <tr>
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
          <td colspan="9" class="px-2 py-2 text-slate-500 italic text-center">
            No item in this bucket is valid for your Player Level.
          </td>
        </tr>`;
    } else {
      for (const r of rows) {
        html += `
          <tr class="odd:bg-slate-800/40 even:bg-slate-800/20">
            <td class="px-2 py-1 font-mono text-[10px] text-emerald-300 break-all align-top">
              ${r.itemId}
            </td>
            <td class="px-2 py-1 text-center align-top">${r.qty}</td>

            <td class="px-2 py-1 text-right align-top">${
              r.perNotch[1] ? pctSpan(r.perNotch[1].mono, 1) : "—"
            }</td>
            <td class="px-2 py-1 text-right align-top">${
              r.perNotch[1] ? pctSpan(r.perNotch[1].atLeast, 1) : "—"
            }</td>

            <td class="px-2 py-1 text-right align-top">${
              r.perNotch[2] ? pctSpan(r.perNotch[2].mono, 2) : "—"
            }</td>
            <td class="px-2 py-1 text-right align-top">${
              r.perNotch[2] ? pctSpan(r.perNotch[2].atLeast, 2) : "—"
            }</td>

            <td class="px-2 py-1 text-right align-top">${
              r.perNotch[3] ? pctSpan(r.perNotch[3].mono, 3) : "—"
            }</td>
            <td class="px-2 py-1 text-right align-top">${
              r.perNotch[3] ? pctSpan(r.perNotch[3].atLeast, 3) : "—"
            }</td>

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
      </div>
    `;
    return html;
  }

  let globalBucketDetailIdCounter = 0;

  // -------- loot table (LTID) -> buckets (LBID) --------
  function buildLootDetailsHTMLMulti(lootTableId, playerLevel, trackLevel, perNotchParent) {
    const model = getEffectiveLootTableModel(
      lootTableId,
      playerLevel,
      trackLevel,
      new Set()
    );
    if (!model) {
      return `<div class="ml-10 pl-3 border-l border-slate-700/60 text-xs text-slate-400">No loot table data for ${lootTableId}</div>`;
    }

    // merge bucket stats across 1/2/3
    const bucketMap = {};
    for (const notch of [1, 2, 3]) {
      const parent = perNotchParent[notch];
      if (!parent) continue;

      const arr = computeLBIDProbabilities(
        model,
        parent.percentSingle,
        parent.percentAtLeastOneOfThree
      );

      for (const e of arr) {
        const label = typeof e.raw === "string" ? e.raw : (e.raw ?? "");
        const bucket = cleanBucketNameFromLBID(label);
        if (!bucket) continue;

        if (!bucketMap[bucket]) {
          bucketMap[bucket] = {
            label,
            qty: e.qty ?? "—",
            minRoll: e.minRoll ?? "—",
            notch: { 1: null, 2: null, 3: null },
          };
        }

        bucketMap[bucket].notch[notch] = {
          monoGlobalPct: e.monoGlobal || 0,
          atLeastGlobalPct: e.atLeastGlobal || 0,
          bucketPct: e.bucketPct || 0,
        };
      }
    }

    const rows = Object.keys(bucketMap)
      .map((b) => {
        const d = bucketMap[b];
        const trackPct = trackAnyFromArray([
          d.notch[1]?.atLeastGlobalPct || 0,
          d.notch[2]?.atLeastGlobalPct || 0,
          d.notch[3]?.atLeastGlobalPct || 0,
        ]);

        return {
          bucketName: b,
          label: d.label,
          qty: d.qty,
          minRoll: d.minRoll,
          notch: d.notch,
          trackPct,
        };
      })
      .sort((a, b) => b.trackPct - a.trackPct);

    // inner table HTML
    let inner = `
      <div class="text-[11px] text-slate-300 font-mono mb-2">
        LootTable ${model.tableId}
      </div>
      <div class="rounded-lg border border-slate-700/60 bg-slate-900/40">
        <table class="w-full table-auto text-left text-[11px] text-slate-200">
          <thead class="uppercase text-[10px] text-slate-300 bg-slate-900 sticky top-0 z-10">
            <tr>
              <th rowspan="2" class="px-2 py-1 font-semibold border-b border-slate-700/60">
                Bucket (LBID)
              </th>
              <th rowspan="2" class="px-2 py-1 font-semibold text-center border-b border-slate-700/60">
                Qty
              </th>
              <th rowspan="2" class="px-2 py-1 font-semibold text-right border-b border-slate-700/60">
                MinRoll
              </th>

              <th colspan="2" class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n1">
                Notch&nbsp;1
              </th>
              <th colspan="2" class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n2">
                Notch&nbsp;2
              </th>
              <th colspan="2" class="px-2 py-1 font-semibold text-center border-b border-slate-700/60 th-notch n3">
                Notch&nbsp;3
              </th>

              <th rowspan="2" class="px-2 py-1 font-semibold text-right border-b border-slate-700/60 th-track">
                %Track1/9
              </th>
            </tr>
            <tr>
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
      inner += `
        <tr>
          <td colspan="10" class="px-2 py-2 text-slate-500 italic text-center">
            No valid entries for this loot table.
          </td>
        </tr>`;
    } else {
      for (const r of rows) {
        const detailId = `bucket-items-${globalBucketDetailIdCounter++}`;

        const notch1 = r.notch[1];
        const notch2 = r.notch[2];
        const notch3 = r.notch[3];

        const canDrill = !!window.PVP_BUCKET_CONTENTS?.[r.bucketName];

        const labelHTML = canDrill
          ? `<span
                class="lb-toggle cursor-pointer text-indigo-300 underline decoration-dotted hover:text-indigo-200"
                tabindex="0"
                role="button"
                data-target="${detailId}"
              >${r.label}</span>`
          : `<span class="text-slate-300">${r.label}</span>`;

        inner += `
          <tr class="odd:bg-slate-800/40 even:bg-slate-800/20">
            <td class="px-2 py-1 font-mono text-[10px] break-all align-top">
              ${labelHTML}
            </td>
            <td class="px-2 py-1 text-center align-top">${r.qty}</td>
            <td class="px-2 py-1 text-right align-top">${r.minRoll}</td>

            <td class="px-2 py-1 text-right align-top">${
              notch1 ? pctSpan(notch1.monoGlobalPct, 1) : "—"
            }</td>
            <td class="px-2 py-1 text-right align-top">${
              notch1 ? pctSpan(notch1.atLeastGlobalPct, 1) : "—"
            }</td>

            <td class="px-2 py-1 text-right align-top">${
              notch2 ? pctSpan(notch2.monoGlobalPct, 2) : "—"
            }</td>
            <td class="px-2 py-1 text-right align-top">${
              notch2 ? pctSpan(notch2.atLeastGlobalPct, 2) : "—"
            }</td>

            <td class="px-2 py-1 text-right align-top">${
              notch3 ? pctSpan(notch3.monoGlobalPct, 3) : "—"
            }</td>
            <td class="px-2 py-1 text-right align-top">${
              notch3 ? pctSpan(notch3.atLeastGlobalPct, 3) : "—"
            }</td>

            <td class="px-2 py-1 text-right align-top">
              ${pctTrackSpan(r.trackPct)}
            </td>
          </tr>

          <tr id="${detailId}" class="hidden">
            <td colspan="10" class="px-2 pt-0 pb-2">
              ${
                canDrill
                  ? buildBucketItemsHTMLMulti(r.bucketName, playerLevel, r.notch)
                  : `<div class="text-[10px] text-slate-500">No item list for this bucket.</div>`
              }
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

    // 🔥 important: indent whole loot detail block so it's visually under "Item", not under "Owned?"
    return `
      <div class="ml-10 pl-3 border-l border-slate-700/60">
        ${inner}
      </div>
    `;
  }

  // click handlers for LBID expansion
  function attachBucketRowToggles(root) {
    if (!root) return;

    function escapeSelector(id) {
      if (window.CSS && CSS.escape) {
        return "#" + CSS.escape(id);
      }
      return (
        "#" +
        id.replace(/([ !"#$%&'()*+,.\/:;<=>?@\[\\\]^`{|}~])/g, "\\$1")
      );
    }

    root.querySelectorAll(".lb-toggle").forEach((el) => {
      const target = el.getAttribute("data-target");
      if (!target) return;

      const toggle = () => {
        const sel = escapeSelector(target);
        const row = root.querySelector(sel);
        if (row) {
          row.classList.toggle("hidden");
        }
      };

      el.addEventListener("click", toggle);
      el.addEventListener("keypress", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  // --------------- BUILD PER-NOTCH / MERGED ROWS ---------------

  function buildAllNotchDists(trackLevel, playerLevel) {
    const owned = loadOwned();
    return {
      d1: recomputeDistributionAfterFilter(getNotchData(trackLevel, 1), owned),
      d2: recomputeDistributionAfterFilter(getNotchData(trackLevel, 2), owned),
      d3: recomputeDistributionAfterFilter(getNotchData(trackLevel, 3), owned),
    };
  }

  function buildMergedRows(playerLevel, trackLevel, { d1, d2, d3 }) {
    const merged = {};

    function ingest(dist, notch) {
      for (const r of dist.rewards) {
        merged[r.rewardId] ??= {
          rewardId: r.rewardId,
          perNotch: { 1: null, 2: null, 3: null },
        };
        merged[r.rewardId].perNotch[notch] = {
          weight: r.weight,
          percentSingle: r.percentSingle,
          percentAtLeastOneOfThree: r.percentAtLeastOneOfThree,
        };
      }
    }

    ingest(d1, 1);
    ingest(d2, 2);
    ingest(d3, 3);

    const rows = [];
    for (const rid in merged) {
      const perNotch = merged[rid].perNotch;
      rows.push({
        rewardId: rid,
        perNotch,
        trackPct: trackAnyFromArray([
          perNotch[1]?.percentAtLeastOneOfThree || 0,
          perNotch[2]?.percentAtLeastOneOfThree || 0,
          perNotch[3]?.percentAtLeastOneOfThree || 0,
        ]),
      });
    }

    // sort by how likely across full track
    rows.sort((a, b) => b.trackPct - a.trackPct);

    // decorate with metadata
    for (const row of rows) {
      const meta = window.PVP_REWARD_META?.[row.rewardId] || {};
      row.displayName = getDisplayName(row.rewardId);
      row.cost = getAzothCost(row.rewardId);
      row.gs = getGsRangeForReward(row.rewardId, playerLevel, trackLevel);
      row.uniqueEligible = isUniqueEligible(row.rewardId);
      row.lootTableId = meta.lootTableId || null;
      row.rollOnPresent = !!meta.rollOnPresent;
    }

    return rows;
  }

  // --------------- RENDER OWNED LIST ---------------

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

      const tdId = document.createElement("td");
      tdId.className =
        "px-3 py-2 font-mono text-[11px] text-slate-400 break-all";
      tdId.textContent = rid;

      const tdName = document.createElement("td");
      tdName.className = "px-3 py-2";
      tdName.textContent = getDisplayName(rid);

      const tdAct = document.createElement("td");
      tdAct.className = "px-3 py-2 text-right w-[3rem]";
      const btn = document.createElement("button");
      btn.className =
        "text-red-400 hover:text-red-300 text-[14px] font-bold leading-none px-2 py-1 rounded hover:bg-red-500/10 focus:outline-none";
      btn.setAttribute("aria-label", "Remove from owned");
      btn.textContent = "✕";
      btn.addEventListener("click", () => {
        toggleOwned(rid);
        onCalc();
      });
      tdAct.appendChild(btn);

      tr.appendChild(tdId);
      tr.appendChild(tdName);
      tr.appendChild(tdAct);
      body.appendChild(tr);
    }
  }

  // --------------- RENDER MAIN TABLE ---------------

  function renderMergedRows(playerLevel, trackLevel, rows) {
    const tbody = document.getElementById("resultsBodyAll");
    if (!tbody) return;
    tbody.innerHTML = "";

    const owned = loadOwned();

    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.className = "odd:bg-slate-800/40 even:bg-slate-800/20 align-top";

      // Owned? checkbox
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

      // Item name (click to expand loot table)
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
        detailsTd.colSpan = 14;
        detailsTd.className = "px-6 py-4 text-xs";

        // per-notch probs for THIS reward
        const perNotchParent = {};
        for (const n of [1, 2, 3]) {
          if (row.perNotch[n]) {
            perNotchParent[n] = {
              percentSingle: row.perNotch[n].percentSingle,
              percentAtLeastOneOfThree: row.perNotch[n].percentAtLeastOneOfThree,
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
      tr.appendChild(tdItem);

      // Azoth Salt
      const tdCost = document.createElement("td");
      tdCost.className = "px-2 py-2 text-center align-top";
      tdCost.textContent = row.cost ?? "—";
      tr.appendChild(tdCost);

      // GS
      const tdGs = document.createElement("td");
      tdGs.className = "px-2 py-2 align-top";
      tdGs.textContent = row.gs;
      tr.appendChild(tdGs);

      // Notch 1 / 2 / 3
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

      // %Track1/9 overall
      const tdTrack = document.createElement("td");
      tdTrack.className = "px-2 py-2 text-right align-top";
      tdTrack.innerHTML = pctTrackSpan(row.trackPct);
      tr.appendChild(tdTrack);

      tbody.appendChild(tr);
      if (detailsTr) tbody.appendChild(detailsTr);
    }
  }

  // --------------- MAIN DRIVER ---------------

  function onCalc() {
    const player = document.getElementById("playerLevelInput");
    const track = document.getElementById("trackLevelInput");

    const pLvl = clampPlayerLevel(player.value);
    const tLvl = clampTrackLevel(track.value);
    player.value = pLvl;
    track.value = tLvl;

    const { d1, d2, d3 } = buildAllNotchDists(tLvl, pLvl);

    // build merged rows for table
    const rows = buildMergedRows(pLvl, tLvl, { d1, d2, d3 });

    // unique reward count across all 3 notches (after owned filter)
    const uniqueIds = new Set([
      ...d1.rewards.map(r => r.rewardId),
      ...d2.rewards.map(r => r.rewardId),
      ...d3.rewards.map(r => r.rewardId),
    ]);

    // update summary cards
    const metaTop = document.getElementById("resultMeta");
    if (metaTop) {
      metaTop.innerHTML = `
        <!-- PLAYER CARD -->
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

    // render main and owned list
    renderMergedRows(pLvl, tLvl, rows);
    renderOwnedList();
  }

  document.getElementById("calcBtn").addEventListener("click", onCalc);
  onCalc();
})();
