// ============================================================
//  BMC DISCOVERY → GOOGLE SHEETS — Synchronisation Inventaire
//  À coller dans : Extensions > Apps Script
// ============================================================

// ─────────────────────────────────────────────────────────────
//  CONFIGURATION  (à adapter avant déploiement)
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  // URL de base de votre instance BMC Discovery (sans slash final)
  BMC_BASE_URL: "https://VOTRE_INSTANCE_BMC_DISCOVERY",

  // Token API BMC Discovery
  BMC_TOKEN: "VOTRE_TOKEN_API_BMC",

  // Nom de l'onglet inventaire principal
  SHEET_INVENTAIRE: "Production IT - Inventaire serv",

  // Nom de l'onglet journal des changements (créé automatiquement s'il n'existe pas)
  SHEET_LOG: "Journal des changements",

  // Couleur de surlignage des lignes modifiées (jaune pâle)
  COLOR_MODIFIED: "#FFF2CC",

  // Couleur de surlignage des nouvelles machines (vert pâle)
  COLOR_NEW: "#D9EAD3",

  // Couleur de surlignage des machines non trouvées dans BMC (rouge pâle)
  COLOR_NOT_FOUND: "#F4CCCC",

  // Colonne identifiant unique dans le sheet (0-indexé → colonne A = 0)
  COL_ID: 0,            // Identifiant        (col A)
  COL_NOM: 1,           // Nom                (col B)
  COL_DESCRIPTION: 2,   // Description        (col C)
  COL_FAMILLE: 3,       // Famille            (col D)
  COL_FABRICANT: 4,     // Fabriquant         (col E)
  COL_MODELE: 5,        // Modèle             (col F)
  COL_SERIAL: 6,        // Numéro de Série    (col G)
  COL_DOMAINE: 7,       // Domaine            (col H)
  COL_FQDN: 8,          // FQDN               (col I)
  COL_MANAGEMENT: 9,    // Management         (col J)
  COL_ENV: 10,          // Environnement      (col K)
  COL_PCIDSS: 11,       // PCI DSS            (col L)
  COL_OS: 12,           // OS                 (col M)
  COL_OS_BUILD: 13,     // OS Build           (col N)
  COL_IP: 14,           // IP                 (col O)
  COL_MAC: 15,          // Adresse MAC        (col P)
  COL_ZONE_RESEAU: 16,  // Zone Réseau        (col Q)
  COL_HEBERGEMENT: 17,  // Hébergement        (col R)
  COL_DATACENTER: 18,   // Datacenter         (col S)
  COL_PR: 19,           // PR                 (col T)
  COL_ENTREE: 20,       // Entrée dans le parc (col U)
  COL_MAJ: 21,          // Mise à jour OS/HW  (col V)
  COL_CPU: 22,          // CPU                (col W)
  COL_MEMORY: 23,       // Memory             (col X)
  COL_DISK: 24,         // DiskSizeGb         (col Y)
  COL_DATE_COM: 25,     // Date Commercialisation (col Z)
  COL_DATE_FIN: 26,     // Date fin de support (col AA)
  COL_PROPRIO: 27,      // Propriétaire       (col AB)
  COL_GESTIONNAIRE: 28, // Gestionnaire       (col AC)
  COL_STATUT: 29,       // Statut             (col AD)
  COL_BLACKLIST: 30,    // Blacklist Discovery (col AE)
  COL_CATEGORIE: 31,    // Catégorie          (col AF)
  COL_CRITICITE: 32,    // Criticité          (col AG)
  COL_TYPE: 33,         // Type               (col AH)
  COL_RECORD_PROD: 34,  // Record Producer    (col AI)
  COL_GROUPE_SUP: 35,   // Groupe de support  (col AJ)
  COL_CLOUD: 36,        // Cloud              (col AK)
  COL_VIRTUEL: 37,      // Virtuel            (col AL)
  COL_CLASSE: 38,       // Classe d'actif     (col AM)
  COL_MONITORING: 39,   // Monitoring         (col AN)
  COL_GROUPE_SUP2: 40,  // Groupe de support 2 (col AO)
};

// ─────────────────────────────────────────────────────────────
//  MAPPING  BMC Discovery → colonnes Google Sheets
//  Clé   = attribut retourné par l'API BMC
//  Valeur = index de colonne dans CONFIG
// ─────────────────────────────────────────────────────────────
const BMC_FIELD_MAP = {
  "name":                CONFIG.COL_NOM,
  "fqdn":                CONFIG.COL_FQDN,
  "os":                  CONFIG.COL_OS,
  "os_version":          CONFIG.COL_OS_BUILD,
  "ip_address":          CONFIG.COL_IP,
  "mac_address":         CONFIG.COL_MAC,
  "cpu_count":           CONFIG.COL_CPU,
  "ram":                 CONFIG.COL_MEMORY,
  "disk_total":          CONFIG.COL_DISK,
  "serial_no":           CONFIG.COL_SERIAL,
  "model":               CONFIG.COL_MODELE,
  "manufacturer":        CONFIG.COL_FABRICANT,
  "domain":              CONFIG.COL_DOMAINE,
  "virtual":             CONFIG.COL_VIRTUEL,
  // Ajoutez ici d'autres attributs BMC selon votre configuration
};

// ─────────────────────────────────────────────────────────────
//  POINT D'ENTRÉE PRINCIPAL
//  Appelé par le trigger automatique OU par le bouton manuel
// ─────────────────────────────────────────────────────────────
function syncBMCDiscovery() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  try {
    Logger.log("=== Démarrage synchronisation BMC Discovery ===");

    // 1. Récupérer les changements des dernières 24h depuis BMC
    const changedNodes = getBMCChangesLast24h();
    if (!changedNodes || changedNodes.length === 0) {
      Logger.log("Aucun changement détecté dans les dernières 24h.");
      ui.alert("BMC Sync", "✅ Aucun changement détecté dans les dernières 24h.", ui.ButtonSet.OK);
      return;
    }

    Logger.log(`${changedNodes.length} machine(s) modifiée(s) détectée(s).`);

    // 2. Charger l'inventaire existant
    const sheetInv = ss.getSheetByName(CONFIG.SHEET_INVENTAIRE);
    if (!sheetInv) throw new Error(`Onglet "${CONFIG.SHEET_INVENTAIRE}" introuvable.`);

    const dataRange = sheetInv.getDataRange();
    const allData   = dataRange.getValues();
    const allBg     = dataRange.getBackgrounds();

    // Construire un index Hostname → numéro de ligne (1-indexé, ligne 1 = headers)
    const hostIndex = buildHostIndex(allData);

    // 3. Préparer le journal
    const sheetLog = getOrCreateLogSheet(ss);
    const logEntries = [];
    const now = new Date();

    let countUpdated = 0;
    let countNew     = 0;

    // 4. Traiter chaque machine modifiée
    for (const node of changedNodes) {
      const hostname = (node.name || "").toUpperCase().trim();
      if (!hostname) continue;

      const existingRow = hostIndex[hostname]; // numéro de ligne 1-indexé (inclut header)

      if (existingRow !== undefined) {
        // ── Machine existante → mise à jour des cellules ──
        const rowIndex = existingRow; // ligne réelle dans le sheet (1-indexé)
        const changes  = updateExistingRow(sheetInv, rowIndex, allData[rowIndex - 1], node);

        if (changes.length > 0) {
          // Surligner en jaune
          sheetInv.getRange(rowIndex, 1, 1, allData[0].length)
            .setBackground(CONFIG.COLOR_MODIFIED);

          // Logger
          for (const c of changes) {
            logEntries.push([
              now,
              hostname,
              "MISE À JOUR",
              c.field,
              c.oldVal,
              c.newVal,
              rowIndex,
            ]);
          }
          countUpdated++;
        }

      } else {
        // ── Machine inconnue → ajout d'une nouvelle ligne ──
        const newRow = buildNewRow(node, allData[0].length);
        sheetInv.appendRow(newRow);

        // Surligner en vert
        const newRowIndex = sheetInv.getLastRow();
        sheetInv.getRange(newRowIndex, 1, 1, allData[0].length)
          .setBackground(CONFIG.COLOR_NEW);

        logEntries.push([
          now,
          hostname,
          "NOUVELLE MACHINE",
          "—",
          "—",
          "Machine ajoutée depuis BMC Discovery",
          newRowIndex,
        ]);
        countNew++;
      }
    }

    // 5. Écrire le journal
    if (logEntries.length > 0) {
      appendLogEntries(sheetLog, logEntries);
    }

    // 6. Résumé
    const msg = `✅ Synchronisation terminée !\n\n` +
                `• ${countUpdated} machine(s) mise(s) à jour\n` +
                `• ${countNew} nouvelle(s) machine(s) ajoutée(s)\n\n` +
                `Consultez l'onglet "${CONFIG.SHEET_LOG}" pour le détail.`;
    Logger.log(msg);
    ui.alert("BMC Sync", msg, ui.ButtonSet.OK);

  } catch (err) {
    Logger.log("ERREUR : " + err.message);
    ui.alert("BMC Sync — Erreur", "❌ " + err.message, ui.ButtonSet.OK);
  }
}

// ─────────────────────────────────────────────────────────────
//  API BMC DISCOVERY — Récupérer les nœuds modifiés (24h)
// ─────────────────────────────────────────────────────────────
function getBMCChangesLast24h() {
  // Calcul de la borne temporelle (ISO 8601)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Requête TDL (Tideway Discovery Language) sur l'endpoint /data/search
  // On cherche tous les Host modifiés depuis `since`
  const query = encodeURIComponent(
    `search Host where _last_update_time > "${since}" show name, fqdn, os, os_version, ` +
    `ip_address, mac_address, cpu_count, ram, disk_total, serial_no, model, manufacturer, domain, virtual`
  );

  const url = `${CONFIG.BMC_BASE_URL}/api/v1.2/data/search?query=${query}`;

  const options = {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${CONFIG.BMC_TOKEN}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const code     = response.getResponseCode();
  const body     = response.getContentText();

  if (code !== 200) {
    throw new Error(`BMC API HTTP ${code} : ${body.substring(0, 300)}`);
  }

  const json = JSON.parse(body);

  // L'API BMC retourne { results: [...], headings: [...] }
  // On reconstruit un tableau d'objets à partir des headings et des résultats
  const headings = json.headings || [];
  const results  = json.results  || [];

  return results.map(row => {
    const node = {};
    headings.forEach((h, i) => { node[h] = row[i]; });
    return node;
  });
}

// ─────────────────────────────────────────────────────────────
//  OUTILS SHEET
// ─────────────────────────────────────────────────────────────

/** Construit un index { HOSTNAME_UPPER → rowIndex (1-based) } à partir de allData */
function buildHostIndex(allData) {
  const index = {};
  // On commence à la ligne 2 (index 1) pour sauter l'en-tête
  for (let i = 1; i < allData.length; i++) {
    const nom = (allData[i][CONFIG.COL_NOM] || "").toUpperCase().trim();
    if (nom) index[nom] = i + 1; // +1 car rowIndex est 1-based dans Sheets
  }
  return index;
}

/**
 * Met à jour les cellules d'une ligne existante selon les données BMC.
 * Retourne la liste des changements { field, oldVal, newVal }.
 */
function updateExistingRow(sheet, rowIndex, currentRowData, bmcNode) {
  const changes = [];

  for (const [bmcField, colIndex] of Object.entries(BMC_FIELD_MAP)) {
    const newVal = bmcNode[bmcField];
    if (newVal === undefined || newVal === null) continue;

    const newValStr = String(newVal).trim();
    const oldValStr = String(currentRowData[colIndex] || "").trim();

    if (newValStr !== oldValStr) {
      // Écrire la nouvelle valeur (colIndex est 0-based, Sheets attend 1-based)
      sheet.getRange(rowIndex, colIndex + 1).setValue(newVal);
      changes.push({
        field:  bmcField,
        oldVal: oldValStr,
        newVal: newValStr,
      });
    }
  }

  return changes;
}

/**
 * Construit un tableau représentant une nouvelle ligne pour une machine inconnue.
 * Les colonnes non mappées restent vides.
 */
function buildNewRow(bmcNode, totalCols) {
  const row = new Array(totalCols).fill("");

  // Identifiant auto-généré (peut être ajusté selon votre convention)
  row[CONFIG.COL_ID]  = "BMC-" + (bmcNode.name || "UNKNOWN").toUpperCase();
  row[CONFIG.COL_MAJ] = new Date(); // Date de mise à jour = maintenant

  for (const [bmcField, colIndex] of Object.entries(BMC_FIELD_MAP)) {
    if (bmcNode[bmcField] !== undefined && bmcNode[bmcField] !== null) {
      row[colIndex] = bmcNode[bmcField];
    }
  }

  return row;
}

// ─────────────────────────────────────────────────────────────
//  JOURNAL DES CHANGEMENTS
// ─────────────────────────────────────────────────────────────

/** Retourne l'onglet journal, le crée s'il n'existe pas encore */
function getOrCreateLogSheet(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_LOG);
    // En-têtes du journal
    const headers = ["Date", "Machine", "Type", "Champ", "Ancienne valeur", "Nouvelle valeur", "Ligne Inventaire"];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold")
      .setBackground("#CFE2F3");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Ajoute les entrées de log dans l'onglet journal */
function appendLogEntries(sheetLog, entries) {
  const lastRow = sheetLog.getLastRow();
  sheetLog.getRange(lastRow + 1, 1, entries.length, entries[0].length)
    .setValues(entries);
}

// ─────────────────────────────────────────────────────────────
//  TRIGGER AUTOMATIQUE — Installer / Désinstaller
// ─────────────────────────────────────────────────────────────

/**
 * Installe un trigger horaire toutes les heures.
 * À exécuter UNE FOIS manuellement depuis l'éditeur Apps Script.
 */
function installTrigger() {
  // Supprimer les anciens triggers pour éviter les doublons
  removeTrigger();

  ScriptApp.newTrigger("syncBMCDiscovery")
    .timeBased()
    .everyHours(1)    // ← modifier ici : everyHours(6), everyDays(1)…
    .create();

  SpreadsheetApp.getUi().alert(
    "Trigger installé",
    "✅ La synchronisation tournera automatiquement toutes les heures.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/** Supprime tous les triggers existants liés à syncBMCDiscovery */
function removeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "syncBMCDiscovery")
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// ─────────────────────────────────────────────────────────────
//  MENU PERSONNALISÉ dans Google Sheets
// ─────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔄 BMC Discovery")
    .addItem("Synchroniser maintenant",     "syncBMCDiscovery")
    .addSeparator()
    .addItem("Activer la synchro auto",     "installTrigger")
    .addItem("Désactiver la synchro auto",  "removeTrigger")
    .addToUi();
}
