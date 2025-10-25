// pvp.js

(function () {

  // ----------------------
  // Gestion du "déjà reçu"
  // ----------------------

  function loadOwned() {
    try {
      return JSON.parse(localStorage.getItem("ownedRewards") || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveOwned(arr) {
    localStorage.setItem("ownedRewards", JSON.stringify(arr));
  }

  function isOwned(ownedList, rewardId) {
    return ownedList.includes(rewardId);
  }

  function toggleOwned(rewardId) {
    const owned = loadOwned();
    const idx = owned.indexOf(rewardId);
    if (idx === -1) {
      owned.push(rewardId);
    } else {
      owned.splice(idx, 1);
    }
    saveOwned(owned);
  }

  // helper : est-ce un item "unique" qu'on peut marquer ?
  function isUniqueEligible(rewardId) {
    const meta = window.PVP_REWARD_META?.[rewardId];
    return !!(meta && meta.uniqueEligible);
  }

  // ----------------------
  // Helpers généraux
  // ----------------------

  function clampPlayerLevel(lvl) {
    if (lvl < 1) return 1;
    if (lvl > 70) return 70; // marge haute
    return lvl;
  }

  function clampTrackLevel(lvl) {
    if (lvl < 0) return 0;
    if (lvl > 230) return 230; // plage pré-calculée dans data.js
    return lvl;
  }

  function getNotchData(trackLevel, notch) {
    const lvlKey = String(trackLevel);
    const notchKey = String(notch);

    if (!window.PVP_DATA[lvlKey]) return null;
    if (!window.PVP_DATA[lvlKey][notchKey]) return null;
    return window.PVP_DATA[lvlKey][notchKey];
  }

  function fmtPct(x) {
    return x.toFixed(2) + " %";
  }

  // ----------------------
  // Lecture des métadonnées RewardId
  // ----------------------

  // Nom lisible pour la colonne "Item"
  function getDisplayName(rewardId) {
    const meta = window.PVP_REWARD_META?.[rewardId];
    if (!meta) {
      // pas d'info -> fallback brut
      return rewardId;
    }

    const qty = meta.quantity ?? 1;

    // 1. Nom lisible (et pas une clé @loc)
    if (meta.name && meta.name.trim() !== "" && !meta.name.startsWith("@")) {
      if (!meta.rollOnPresent && qty > 1) {
        return `${meta.name} x${qty}`;
      }
      return meta.name;
    }

    // 2. Champ "Item" brut du datasheet
    if (meta.rawItemField && meta.rawItemField.trim() !== "") {
      return meta.rawItemField;
    }

    // 3. GameEvent fallback (ex: donne de l'or, umbral...)
    if (meta.gameEvent && meta.gameEvent.trim() !== "") {
      if (!meta.rollOnPresent && qty > 1) {
        return `${meta.gameEvent} x${qty}`;
      }
      return meta.gameEvent;
    }

    // 4. Fallback ultime
    return rewardId;
  }

  // Coût en Azoth Salt (BuyCategoricalProgressionCost)
  function getAzothCost(rewardId) {
    const meta = window.PVP_REWARD_META?.[rewardId];
    if (!meta) return "—";

    // meta.cost vient de BuyCategoricalProgressionCost
    if (meta.cost === null || meta.cost === undefined) {
      return "—";
    }

    // On affiche juste le nombre, pas l'unité
    return meta.cost.toString();
  }

  // ----------------------
  // Loot table resolution / Gear Score
  // ----------------------

  function pickTierForValue(tableDef, playerLevel, trackLevel) {
    if (!tableDef) return null;

    const cond = tableDef.condition;
    let value;

    if (cond === "Level") {
      value = playerLevel;
    } else if (cond === "PvP_XP") {
      value = trackLevel;
    } else {
      // fallback : considère que ça scale avec le Track Level
      value = trackLevel;
    }

    const tiersSorted = [...tableDef.tiers].sort((a, b) => a.min - b.min);

    let chosen = null;
    for (const t of tiersSorted) {
        if (value >= t.min) {
            chosen = t;
        }
    }
    return chosen;
  }

  function resolveGsRangeFromLootTable(lootTableId, playerLevel, trackLevel, seen = new Set()) {
    if (!lootTableId) return null;
    if (seen.has(lootTableId)) return null; // anti-boucle
    seen.add(lootTableId);

    const tableDef = window.PVP_LOOT_TABLES[lootTableId];
    if (!tableDef) return null;

    const tier = pickTierForValue(tableDef, playerLevel, trackLevel);
    if (!tier) return null;

    // sous-table (souvent *_Rank)
    if (tier.subTable) {
      return resolveGsRangeFromLootTable(tier.subTable, playerLevel, trackLevel, seen);
    }

    return tier.gsRange || null;
  }

  function getGsRangeForReward(rewardId, playerLevel, trackLevel) {
    const meta = window.PVP_REWARD_META?.[rewardId];
    if (!meta) return "—";

    // Récompense fixe (or, emote, skin,...)
    if (!meta.rollOnPresent) {
      return "fixe / pas de roll";
    }

    // Coffre rollé => loot table
    const lootTableId = meta.lootTableId;
    if (!lootTableId) return "—";

    const gsRange = resolveGsRangeFromLootTable(lootTableId, playerLevel, trackLevel);
    return gsRange || "—";
  }

  // ----------------------
  // Recalcul des probabilités après filtre utilisateur
  // ----------------------

  function recomputeDistributionAfterFilter(allRewards, ownedList) {
    // 1. On retire du pool les récompenses marquées comme "déjà reçues"
    //    UNIQUEMENT si ce sont des récompenses uniques (emote/skin/artefact).
    const filtered = allRewards.filter(r => {
      if (isUniqueEligible(r.rewardId) && isOwned(ownedList, r.rewardId)) {
        return false; // tu l'as déjà débloqué, on le retire
      }
      return true;
    });

    // 2. Nouveau total de poids
    const totalWeight = filtered.reduce((acc, r) => acc + r.weight, 0);

    // 3. On recalcule les pourcentages
    const enriched = filtered.map(r => {
      const p = totalWeight > 0 ? (r.weight / totalWeight) : 0;
      const pAtLeastOne = 1 - Math.pow(1 - p, 3); // approx tirage avec remise

      return {
        rewardId: r.rewardId,
        weight: r.weight,
        selectOnceOnly: r.selectOnceOnly,
        percentSingle: p * 100,
        percentAtLeastOneOfThree: pAtLeastOne * 100,
      };
    });

    // 4. Tri par % mono-tirage décroissant
    enriched.sort((a, b) => b.percentSingle - a.percentSingle);

    return {
      totalWeight,
      rewards: enriched,
    };
  }

  // ----------------------
  // Rendu de la liste "déjà reçues"
  // ----------------------

  function renderOwnedList() {
    const wrapper = document.getElementById("ownedWrapper");
    const tbody = document.getElementById("ownedBody");
    const countSpan = document.getElementById("ownedCount");

    const ownedListRaw = loadOwned();

    // On ne veut afficher ici QUE les récompenses uniques (entitlement / artefact)
    const ownedList = ownedListRaw.filter(rid => isUniqueEligible(rid));

    if (!ownedList || ownedList.length === 0) {
      wrapper.classList.add("hidden");
      tbody.innerHTML = "";
      countSpan.textContent = "0";
      return;
    }

    wrapper.classList.remove("hidden");
    tbody.innerHTML = "";
    countSpan.textContent = ownedList.length.toString();

    ownedList.forEach(rewardId => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-800/40 transition";

      // RewardId brut
      const tdReward = document.createElement("td");
      tdReward.className = "px-4 py-3 font-mono text-[10px] text-indigo-300 break-all align-top";
      tdReward.textContent = rewardId;

      // Nom lisible
      const tdItem = document.createElement("td");
      tdItem.className = "px-4 py-3 text-slate-100 text-sm align-top";
      tdItem.textContent = getDisplayName(rewardId);

      // Action -> bouton "Retirer"
      const tdAction = document.createElement("td");
      tdAction.className = "px-4 py-3 text-right text-slate-100 text-sm align-top";

      const btn = document.createElement("button");
      btn.className =
        "bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-xs font-semibold px-3 py-1 rounded-lg shadow";
      btn.textContent = "Retirer";

      btn.addEventListener("click", () => {
        toggleOwned(rewardId); // enlève du localStorage
        onCalc();             // rerender global
      });

      tdAction.appendChild(btn);

      tr.appendChild(tdReward);
      tr.appendChild(tdItem);
      tr.appendChild(tdAction);

      tbody.appendChild(tr);
    });
  }

  // ----------------------
  // Rendu du tableau principal
  // ----------------------

  function renderTable(originalData, playerLevel, trackLevel, notch) {
    const tbody = document.getElementById("resultsBody");
    tbody.innerHTML = "";

    const metaElem = document.getElementById("resultMeta");
    const totalW = document.getElementById("totalWeight");
    const uniq = document.getElementById("uniqueCount");

    if (!originalData || !originalData.rewards || originalData.rewards.length === 0) {
      metaElem.textContent =
        `Aucune donnée éligible pour Track ${trackLevel}, notch ${notch}.`;
      totalW.textContent = "-";
      uniq.textContent = "-";

      renderOwnedList();
      return;
    }

    const ownedList = loadOwned();

    // recalcul en retirant ce que le joueur a déjà débloqué (uniques seulement)
    const filteredData = recomputeDistributionAfterFilter(originalData.rewards, ownedList);

    metaElem.textContent =
      `Player Lvl ${playerLevel} | PvP Track ${trackLevel} | Notch ${notch} | `
      + `${filteredData.rewards.length} entrées après filtres`;

    totalW.textContent = filteredData.totalWeight;
    uniq.textContent = filteredData.rewards.length;

    filteredData.rewards.forEach(row => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-800/40 transition";

      // RewardId
      const tdReward = document.createElement("td");
      tdReward.className = "px-4 py-3 font-mono text-[10px] text-indigo-300 break-all align-top";
      tdReward.textContent = row.rewardId;

      // Item lisible
      const tdItem = document.createElement("td");
      tdItem.className = "px-4 py-3 text-slate-100 text-sm align-top";
      tdItem.textContent = getDisplayName(row.rewardId);

      // Azoth Salt (cost)
      const tdCost = document.createElement("td");
      tdCost.className = "px-4 py-3 text-right text-slate-100 text-sm align-top";
      tdCost.textContent = getAzothCost(row.rewardId);

      // GS estimé
      const tdGs = document.createElement("td");
      tdGs.className = "px-4 py-3 text-slate-100 text-sm align-top";
      tdGs.textContent = getGsRangeForReward(row.rewardId, playerLevel, trackLevel);

      // Poids brut
      const tdWeight = document.createElement("td");
      tdWeight.className = "px-4 py-3 text-right text-slate-100 text-sm align-top";
      tdWeight.textContent = row.weight;

      // % mono-tirage
      const tdSingle = document.createElement("td");
      tdSingle.className = "px-4 py-3 text-right text-slate-100 text-sm align-top";
      tdSingle.textContent = row.percentSingle.toFixed(2) + " %";

      // % ≥1 sur 3
      const tdAtLeast = document.createElement("td");
      tdAtLeast.className = "px-4 py-3 text-right text-slate-100 text-sm align-top";
      tdAtLeast.textContent = row.percentAtLeastOneOfThree.toFixed(2) + " %";

      // Checkbox "déjà reçu ?"
      const tdOwned = document.createElement("td");
      tdOwned.className = "px-4 py-3 text-right text-slate-100 text-sm align-top";

      if (isUniqueEligible(row.rewardId)) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = isOwned(ownedList, row.rewardId);
        checkbox.className = "w-4 h-4 cursor-pointer accent-indigo-600";
        checkbox.addEventListener("click", () => {
          toggleOwned(row.rewardId); // maj localStorage
          onCalc();                 // rerender global
        });
        tdOwned.appendChild(checkbox);
      } else {
        tdOwned.textContent = "—";
        tdOwned.className += " text-slate-500";
      }

      tr.appendChild(tdReward);
      tr.appendChild(tdItem);
      tr.appendChild(tdCost);
      tr.appendChild(tdGs);
      tr.appendChild(tdWeight);
      tr.appendChild(tdSingle);
      tr.appendChild(tdAtLeast);
      tr.appendChild(tdOwned);

      tbody.appendChild(tr);
    });


    // mettre à jour la carte du bas
    renderOwnedList();
  }

  // ----------------------
  // Gestion du bouton
  // ----------------------

  function onCalc() {
    const rawPlayer = parseInt(document.getElementById("playerLevelInput").value, 10);
    const rawTrack  = parseInt(document.getElementById("trackLevelInput").value, 10);
    const notch     = parseInt(document.getElementById("notchSelect").value, 10);

    const playerLevel = clampPlayerLevel(isNaN(rawPlayer) ? 1 : rawPlayer);
    const trackLevel  = clampTrackLevel(isNaN(rawTrack)  ? 0 : rawTrack);

    const data = getNotchData(trackLevel, notch);
    renderTable(data, playerLevel, trackLevel, notch);
  }

  document.getElementById("calcBtn").addEventListener("click", onCalc);

  // affichage initial
  onCalc();

})();
