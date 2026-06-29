// ============================================================
//  CONFIGURATION — À adapter à votre environnement
// ============================================================
const CONFIG = {
  INVENTAIRE_TAB:  "Inventaire serveurs",
  EXTRACT_TAB:     "Feuille 1",

  INVENTAIRE_KEY_COL: 1,
  INVENTAIRE_NOM_COL: 2,

  EXTRACT_KEY_COL: 1,
  EXTRACT_CAS_COL: 2,
  EXTRACT_NOM_COL: 3,

  GOOGLE_CHAT_WEBHOOK:      "https://chat.googleapis.com/v1/spaces/XXXXXXX/messages?key=XXXXXX&token=XXXXXX",
  GOOGLE_CHAT_WEBHOOK_CAS5: "https://chat.googleapis.com/v1/spaces/XXXXXXX/messages?key=XXXXXX&token=XXXXXX",

  RAPPORT_TAB: "Rapport_Sync",

  MAPPING: {
    "Nom":                 { col: 4  },
    "Fabriquant":          { col: 7  },
    "Modèle":              { col: 10 },
    "Numero de Serie":     { col: 13 },
    "Domaine":             { col: 16 },
    "FQDN":                { col: 19 },
    "Environement":        { col: 22 },
    "Hébergement ":        { col: 25 },
    "Statut":              { col: 28 },
    "PCI DSS":             { col: 31 },
    "OS ":                 { col: 34 },
    "OS Build":            { col: 37 },
    "Cpu":                 { col: 43 },
    "Memory":              { col: 46 },
    "DiskSizeGb":          { col: 49 },
    "IP":                  { col: 52 },
    "Adresse MAC":         { col: 55 },
    "type":                { col: 58 },
    "Blacklist Discovery": { col: 61 },
  },

  MATCH_COLS: {
    "Nom":                 5,
    "Fabriquant":          8,
    "Modèle":              11,
    "Numero de Serie":     14,
    "Domaine":             17,
    "FQDN":                20,
    "Environement":        23,
    "Hébergement ":        26,
    "Statut":              29,
    "PCI DSS":             32,
    "OS ":                 35,
    "OS Build":            38,
    "Cpu":                 44,
    "Memory":              47,
    "DiskSizeGb":          50,
    "IP":                  53,
    "Adresse MAC":         56,
    "type":                59,
    "Blacklist Discovery": 62,
  },

  INVENTAIRE_COLS: {
    "Nom":                 2,
    "Fabriquant":          5,
    "Modèle":              6,
    "Numero de Serie":     7,
    "Domaine":             8,
    "FQDN":                9,
    "Environement":        11,
    "Hébergement ":        18,
    "Statut":              30,
    "PCI DSS":             12,
    "OS ":                 13,
    "OS Build":            14,
    "Cpu":                 23,
    "Memory":              24,
    "DiskSizeGb":          25,
    "IP":                  15,
    "Adresse MAC":         16,
    "type":                34,
    "Blacklist Discovery": 31,
  },
};

// Valeurs non significatives à ignorer (toutes variantes de N/A)
const VALEURS_IGNOREES = ["N/A", "NA", "#N/A", "-", "--", "NONE", "NULL", "UNKNOWN", "N.A.", "N.A"];

// ============================================================
//  MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔄 Sync Inventaire")
    .addItem("▶️ Lancer la synchronisation", "lancerSync")
    .addItem("👁️ Aperçu sans modification",  "lancerApercu")
    .addToUi();
}

function lancerSync()   { _executer(false); }
function lancerApercu() { _executer(true);  }

// ============================================================
//  SAISIE DE L'EXTRACT
// ============================================================
function _demanderExtract() {
  const ui = SpreadsheetApp.getUi();

  const intro = ui.alert(
    "📂 Nouvel extract hebdomadaire",
    "Vous allez indiquer où se trouve le fichier extract reçu ce lundi.\n\n" +
    "Options :\n  • Coller l'URL complète du fichier Google Sheets\n  • Coller uniquement l'ID du fichier\n\n" +
    "Cliquez sur OK pour continuer.",
    ui.ButtonSet.OK_CANCEL
  );
  if (intro === ui.Button.CANCEL) return null;

  const reponse = ui.prompt(
    "📋 Fichier extract du lundi",
    "Collez ici l'URL ou l'ID du fichier extract Google Sheets :",
    ui.ButtonSet.OK_CANCEL
  );
  if (reponse.getSelectedButton() === ui.Button.CANCEL) return null;

  const saisie = reponse.getResponseText().trim();
  if (!saisie) {
    ui.alert("❌ Saisie vide", "Aucun fichier renseigné. Opération annulée.", ui.ButtonSet.OK);
    return null;
  }

  const matchId   = saisie.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const extractId = matchId ? matchId[1] : saisie;

  const ongletReponse = ui.prompt(
    "📑 Nom de l'onglet dans l'extract",
    `Nom de l'onglet à utiliser (OK = valeur par défaut : "${CONFIG.EXTRACT_TAB}") :`,
    ui.ButtonSet.OK_CANCEL
  );
  if (ongletReponse.getSelectedButton() === ui.Button.CANCEL) return null;

  const extractTab = ongletReponse.getResponseText().trim() || CONFIG.EXTRACT_TAB;

  try {
    const testSS    = SpreadsheetApp.openById(extractId);
    const testSheet = testSS.getSheetByName(extractTab);
    if (!testSheet) {
      ui.alert(
        "❌ Onglet introuvable",
        `Le fichier est accessible mais l'onglet "${extractTab}" n'existe pas.\n\nOnglets disponibles : ${testSS.getSheets().map(s => s.getName()).join(", ")}`,
        ui.ButtonSet.OK
      );
      return null;
    }

    const confirm = ui.alert(
      "✅ Fichier trouvé — Confirmer ?",
      `Fichier : ${testSS.getName()}\nOnglet  : ${extractTab}\nLignes  : ${testSheet.getLastRow() - 1} enregistrement(s)\n\nLancer la synchronisation avec ce fichier ?`,
      ui.ButtonSet.YES_NO
    );
    if (confirm !== ui.Button.YES) return null;

    return { extractId, extractTab };

  } catch (e) {
    ui.alert("❌ Fichier inaccessible", `Impossible d'ouvrir le fichier.\n\nErreur : ${e.message}`, ui.ButtonSet.OK);
    return null;
  }
}

// ============================================================
//  EXÉCUTION PRINCIPALE
// ============================================================
function _executer(apercuSeulement) {
  const ui    = SpreadsheetApp.getUi();
  const label = apercuSeulement ? "APERÇU" : "SYNCHRONISATION";

  try {
    Logger.log(`=== Début ${label} ===`);

    const extractInfo = _demanderExtract();
    if (!extractInfo) { Logger.log("Annulé par l'utilisateur."); return; }
    const { extractId, extractTab } = extractInfo;

    const invSS    = SpreadsheetApp.getActiveSpreadsheet();
    const extSS    = SpreadsheetApp.openById(extractId);
    const invSheet = invSS.getSheetByName(CONFIG.INVENTAIRE_TAB);
    const extSheet = extSS.getSheetByName(extractTab);

    if (!invSheet) throw new Error(`Onglet inventaire "${CONFIG.INVENTAIRE_TAB}" introuvable.`);
    if (!extSheet) throw new Error(`Onglet extract "${extractTab}" introuvable.`);

    const invData = invSheet.getDataRange().getValues();
    const extData = extSheet.getDataRange().getValues();

    // ── Indexer l'inventaire ──
    const invIndexParId  = {};
    const invIndexParNom = {};
    for (let i = 1; i < invData.length; i++) {
      const id  = String(invData[i][CONFIG.INVENTAIRE_KEY_COL - 1]).trim();
      const nom = String(invData[i][CONFIG.INVENTAIRE_NOM_COL - 1]).trim().toLowerCase();
      if (id)  invIndexParId[id]   = i;
      if (nom) invIndexParNom[nom] = i;
    }

    // ── Parcourir l'extract ──
    const actions    = [];
    const nonTrouves = [];

    for (let e = 1; e < extData.length; e++) {
      const row = extData[e];
      const key = String(row[CONFIG.EXTRACT_KEY_COL - 1]).trim();
      if (!key) continue;

      const cas = parseInt(String(row[CONFIG.EXTRACT_CAS_COL - 1]).trim(), 10);

      // Cas 5 : machine absente de l'inventaire
      if (cas === 5) {
        const nomDiscovery  = String(row[CONFIG.MAPPING["Nom"].col - 1] ?? "").trim();
        const nomInventaire = String(row[CONFIG.EXTRACT_NOM_COL - 1]).trim();
        const nomMachine    = nomDiscovery || nomInventaire || key;

        const valeursDiscovery = {};
        for (const [champ, def] of Object.entries(CONFIG.MAPPING)) {
          const val  = String(row[def.col - 1] ?? "").trim();
          valeursDiscovery[champ] = VALEURS_IGNOREES.includes(val.toUpperCase()) ? "" : val;
        }
        nonTrouves.push({ key, nom: nomMachine, valeursDiscovery });
        Logger.log(`CAS 5 : "${key}" — nom="${nomMachine}"`);
        continue;
      }

      // Cas 3 & 4 : absent de discovery → rien à faire
      if (cas === 3 || cas === 4) {
        Logger.log(`CAS ${cas} : "${key}" absent de discovery — aucune modification`);
        continue;
      }

      // Cas 1 & 2 : réconciliation normale
      let invRowIdx = undefined;
      let modeMatch = "";

      if (/^INV-/i.test(key) && invIndexParId[key] !== undefined) {
        invRowIdx = invIndexParId[key];
        modeMatch = "id";
      } else {
        const nomExtract = String(row[CONFIG.EXTRACT_NOM_COL - 1]).trim().toLowerCase();
        if (nomExtract && invIndexParNom[nomExtract] !== undefined) {
          invRowIdx = invIndexParNom[nomExtract];
          modeMatch = "nom";
          Logger.log(`INFO : "${key}" non trouvé par ID, correspondance par nom "${nomExtract}"`);
        }
      }

      if (invRowIdx === undefined) {
        Logger.log(`SKIP : "${key}" (cas ${cas}) — introuvable dans l'inventaire`);
        continue;
      }

      for (const [champ, matchCol] of Object.entries(CONFIG.MATCH_COLS)) {
        const matchVal = String(row[matchCol - 1] ?? "").trim();

        const estOk    = ["✅","☑","✔","✓"].includes(matchVal);
        const estTiret = ["–","-","—",""].includes(matchVal);
        const estEcart = ["❌","✗","✘","×"].includes(matchVal);

        if (estOk || estTiret) continue;
        if (!estEcart) {
          Logger.log(`⚠️ Match inconnu pour "${champ}" (clé ${key}) : "${matchVal}" — ignoré`);
          continue;
        }

        let discoveryVal = String(row[CONFIG.MAPPING[champ].col - 1] ?? "").trim();
        if (!discoveryVal) continue;

        const discoveryNorm = discoveryVal.toUpperCase().trim();
        if (VALEURS_IGNOREES.includes(discoveryNorm)) {
          Logger.log(`SKIP N/A : ${key} / ${champ} — "${discoveryVal}" ignorée`);
          continue;
        }

        if (discoveryNorm === "DISCOVERED") discoveryVal = "1";

        const invColIdx   = CONFIG.INVENTAIRE_COLS[champ] - 1;
        const invActuelle = String(invData[invRowIdx][invColIdx] ?? "").trim();

        if (discoveryVal.toLowerCase() === invActuelle.toLowerCase()) continue;

        const nomDisc = String(row[CONFIG.MAPPING["Nom"].col - 1] ?? "").trim();
        const nomInv  = String(row[CONFIG.EXTRACT_NOM_COL - 1]).trim();

        actions.push({
          key,
          nom:         nomDisc || nomInv || key,
          cas,
          champ,
          ancienne:    invActuelle,
          nouvelle:    discoveryVal,
          invRowSheet: invRowIdx + 1,
          invColSheet: CONFIG.INVENTAIRE_COLS[champ],
          modeMatch,
        });
      }
    }

    // ── Alerte Cas 5 ──
    if (nonTrouves.length > 0) {
      const listeMachines = nonTrouves
        .map(m => `  • ${m.nom}${m.nom !== m.key ? "  (ID : " + m.key + ")" : ""}`)
        .join("\n");
      ui.alert(
        "🆕 Cas 5 — Nouvelles machines à créer",
        `${nonTrouves.length} machine(s) absente(s) de l'inventaire :\n\n${listeMachines}\n\nCes entrées sont listées dans le rapport. La synchronisation continue.`,
        ui.ButtonSet.OK
      );
    }

    if (actions.length === 0) {
      ui.alert("✅ Déjà à jour", "Aucune différence détectée.", ui.ButtonSet.OK);
      _ecrireRapport(invSS, actions, false, nonTrouves);
      return;
    }

    const resume = _genererResume(actions);

    if (apercuSeulement) {
      ui.alert("👁️ Aperçu des mises à jour", resume + "\n\nAucune modification effectuée.", ui.ButtonSet.OK);
      _ecrireRapport(invSS, actions, false, nonTrouves);
      return;
    }

    const conf = ui.alert(
      "⚠️ Confirmer la synchronisation",
      resume + "\n\nCes modifications seront appliquées à l'inventaire.\nContinuer ?",
      ui.ButtonSet.YES_NO
    );
    if (conf !== ui.Button.YES) {
      ui.alert("Annulé", "Aucune modification effectuée.", ui.ButtonSet.OK);
      return;
    }

    _appliquerModifications(invSheet, actions);
    _ecrireRapport(invSS, actions, true, nonTrouves);
    _envoyerGoogleChatCard(actions);
    if (nonTrouves.length > 0) _envoyerGoogleChatCardCas5(nonTrouves);

    ui.alert(
      "✅ Synchronisation terminée",
      `${actions.length} champ(s) mis à jour.\n\nRapport disponible dans l'onglet "${CONFIG.RAPPORT_TAB}".\nNotification envoyée sur Google Chat.`,
      ui.ButtonSet.OK
    );

  } catch (e) {
    Logger.log("ERREUR : " + e.message);
    ui.alert("❌ Erreur", e.message, ui.ButtonSet.OK);
  }
}

// ============================================================
//  APPLIQUER LES MODIFICATIONS
// ============================================================
function _appliquerModifications(invSheet, actions) {
  const ss      = invSheet.getParent();
  const dateMAJ = new Date().toLocaleString("fr-FR");

  ss.toast("Lecture de l'inventaire...", "Synchronisation en cours", 10);

  const lastRow  = invSheet.getLastRow();
  const lastCol  = invSheet.getLastColumn();
  const plage    = invSheet.getRange(1, 1, lastRow, lastCol);
  const valeurs  = plage.getValues();
  const couleurs = plage.getBackgrounds();
  const notes    = plage.getNotes();

  // ── Lire les validations DDL par colonne ──
  // CORRECTIF : on scanne les 20 premières lignes pour trouver une cellule
  // avec validation, au cas où la ligne 2 serait vide (ex: colonne Hébergement)
  ss.toast("Lecture des validations...", "Synchronisation en cours", 10);
  const colsUniques      = [...new Set(actions.map(a => a.invColSheet))];
  const validationParCol = {};
  for (const col of colsUniques) {
    validationParCol[col] = null;
    for (let r = 2; r <= Math.min(20, lastRow); r++) {
      const v = invSheet.getRange(r, col).getDataValidation();
      if (v) { validationParCol[col] = v; break; }
    }
  }

  // ── Calculer les valeurs finales en mémoire ──
  ss.toast("Calcul des modifications...", "Synchronisation en cours", 5);

  for (const action of actions) {
    const validation = validationParCol[action.invColSheet];
    const rowIdx     = action.invRowSheet - 1;
    const colIdx     = action.invColSheet - 1;

    try {
      let valeurAEcrire = action.nouvelle;
      action.horsListe  = false;

      if (validation) {
        const criteria = validation.getCriteriaType();
        const isDdl    = criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST
                      || criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE;

        if (isDdl && criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
          const valeursAutorisees = validation.getCriteriaValues()[0] || [];
          const valeurDansListe   = valeursAutorisees.find(
            v => String(v).trim().toLowerCase() === String(action.nouvelle).trim().toLowerCase()
          );

          if (valeurDansListe !== undefined) {
            // Normalisation de casse : on prend la valeur exacte de la liste (ex: "Claranet")
            valeurAEcrire = String(valeurDansListe).trim();
            if (valeurAEcrire !== action.nouvelle) {
              action.avertissement = `Casse normalisée : "${action.nouvelle}" → "${valeurAEcrire}"`;
              action.nouvelle      = valeurAEcrire;
            }
          } else {
            action.horsListe     = true;
            action.avertissement = `"${action.nouvelle}" hors liste déroulante — écrit quand même`;
            Logger.log(`HORS LISTE DDL : ${action.key} / ${action.champ} = "${action.nouvelle}"`);
          }
        }
      }

      valeurs[rowIdx][colIdx]  = valeurAEcrire;
      action.valeurFinale      = valeurAEcrire;
      action.statut            = action.horsListe ? "OK_HORS_LISTE" : "OK";
      couleurs[rowIdx][colIdx] = action.horsListe ? "#FFE0B2" : "#FFF59D";

      let note = `Mis à jour par Discovery le ${dateMAJ}\nAncienne valeur : "${action.ancienne}"`;
      if (action.avertissement) note += `\n⚠️ ${action.avertissement}`;
      notes[rowIdx][colIdx] = note;

    } catch (e) {
      action.statut            = "ECHEC";
      action.erreur            = e.message;
      action.valeurFinale      = null;
      couleurs[rowIdx][colIdx] = "#FFCDD2";
      notes[rowIdx][colIdx]    = `Échec le ${dateMAJ} : ${e.message}`;
      Logger.log(`ECHEC : ${action.key} / ${action.champ} - ${e.message}`);
    }
  }

  // ── Écriture globale ──
  ss.toast("Écriture dans l'inventaire...", "Synchronisation en cours", 15);

  // Désactiver les validations avant setValues pour éviter tout rejet de casse
  const colsModifiees = [...new Set(actions.map(a => a.invColSheet))];
  for (const col of colsModifiees) {
    invSheet.getRange(2, col, lastRow - 1, 1).clearDataValidations();
  }

  plage.setValues(valeurs);
  plage.setBackgrounds(couleurs);
  plage.setNotes(notes);

  // Remettre les validations
  for (const col of colsModifiees) {
    const validation = validationParCol[col];
    if (validation) invSheet.getRange(2, col, lastRow - 1, 1).setDataValidation(validation);
  }

  const ok        = actions.filter(a => a.statut === "OK").length;
  const horsListe = actions.filter(a => a.statut === "OK_HORS_LISTE").length;
  const echecs    = actions.filter(a => a.statut === "ECHEC").length;

  let bilanMsg = `${ok} mise(s) à jour OK`;
  if (horsListe > 0) bilanMsg += ` | ${horsListe} hors liste DDL`;
  if (echecs    > 0) bilanMsg += ` | ${echecs} échec(s)`;
  ss.toast(bilanMsg, "Synchronisation terminée", 8);
}

// ============================================================
//  RÉSUMÉ TEXTE
// ============================================================
function _genererResume(actions) {
  const parCle  = {};
  for (const a of actions) {
    if (!parCle[a.key]) parCle[a.key] = { nom: a.nom || a.key, items: [] };
    parCle[a.key].items.push(a);
  }

  const nbCles = Object.keys(parCle).length;
  let msg = `📊 ${actions.length} différence(s) sur ${nbCles} serveur(s) :\n${"─".repeat(45)}\n`;

  let shown = 0;
  for (const [key, { nom, items }] of Object.entries(parCle)) {
    if (shown >= 10) { msg += `\n... et ${nbCles - shown} autre(s) serveur(s)`; break; }
    msg += `\n🖥️ ${nom} (${items.length} champ(s))\n`;
    for (const item of items.slice(0, 4)) {
      msg += `   • ${item.champ}: "${item.ancienne}" → "${item.nouvelle}"\n`;
    }
    if (items.length > 4) msg += `   ... +${items.length - 4} autre(s)\n`;
    shown++;
  }
  return msg;
}

// ============================================================
//  RAPPORT
// ============================================================
function _ecrireRapport(invSS, actions, applique, nonTrouves) {
  let sheet = invSS.getSheetByName(CONFIG.RAPPORT_TAB);
  if (sheet) { sheet.clearContents(); sheet.clearFormats(); }
  else sheet = invSS.insertSheet(CONFIG.RAPPORT_TAB);

  const now           = new Date();
  const statut        = applique ? "✅ APPLIQUÉ" : "👁️ APERÇU (non appliqué)";
  const couleurStatut = applique ? "#34A853" : "#FBBC05";

  sheet.getRange("A1:G1").merge()
    .setValue("Rapport de synchronisation Discovery → Inventaire")
    .setFontSize(14).setFontWeight("bold")
    .setBackground("#1a73e8").setFontColor("white")
    .setHorizontalAlignment("center");

  sheet.getRange("A2:G2").merge()
    .setValue(`${now.toLocaleString("fr-FR")}   |   Statut : ${statut}`)
    .setBackground(couleurStatut).setFontColor("white")
    .setHorizontalAlignment("center").setFontWeight("bold");

  const parCle   = {};
  const parChamp = {};
  for (const a of actions) {
    parCle[a.key]     = (parCle[a.key]     || 0) + 1;
    parChamp[a.champ] = (parChamp[a.champ] || 0) + 1;
  }

  sheet.getRange("A4:B4").setValues([["Serveurs impactés",  Object.keys(parCle).length]]).setFontWeight("bold");
  sheet.getRange("A5:B5").setValues([["Champs mis à jour",  actions.length]]);
  sheet.getRange("A6:B6").setValues([["Date de traitement", now.toLocaleDateString("fr-FR")]]);

  const headers = ["Nom machine","Identifiant","Champ modifié","Ancienne valeur","Nouvelle valeur","Correspondance","Statut"];
  const hRow    = 9;
  sheet.getRange(hRow, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold").setBackground("#E8F0FE")
    .setBorder(true, true, true, true, true, true);

  const rows = actions.map(a => [
    a.nom || a.key,
    a.key,
    a.champ,
    a.ancienne,
    a.nouvelle,
    a.modeMatch === "nom" ? "Par nom" : "Par ID",
    !applique                       ? "En attente"
    : a.statut === "ECHEC"          ? "ECHEC - " + (a.erreur || "")
    : a.statut === "OK_HORS_LISTE"  ? "Hors liste DDL"
    : "OK",
  ]);

  if (rows.length > 0) {
    sheet.getRange(hRow + 1, 1, rows.length, headers.length).setValues(rows);
    for (let i = 0; i < rows.length; i++) {
      sheet.getRange(hRow + 1 + i, 1, 1, headers.length)
        .setBackground(i % 2 === 0 ? "#FFFFFF" : "#F8F9FA");
    }
  }

  // Répartition par champ (colonne I)
  sheet.getRange(4, 9).setValue("Champ").setFontWeight("bold").setBackground("#E8F0FE");
  sheet.getRange(4, 10).setValue("Nb écarts").setFontWeight("bold").setBackground("#E8F0FE");
  let r = 5;
  for (const [champ, nb] of Object.entries(parChamp).sort((a, b) => b[1] - a[1])) {
    sheet.getRange(r, 9).setValue(champ);
    sheet.getRange(r, 10).setValue(nb);
    r++;
  }

  // Section Cas 5
  if (nonTrouves && nonTrouves.length > 0) {
    let lastRow       = sheet.getLastRow() + 2;
    const champsCas5  = Object.keys(CONFIG.MAPPING);
    const nbColsCas5  = champsCas5.length + 2;

    sheet.getRange(lastRow, 1, 1, nbColsCas5).merge()
      .setValue("🆕 Cas 5 — Machines absentes de l'inventaire (à créer manuellement)")
      .setFontWeight("bold").setBackground("#FFCDD2");
    lastRow++;

    sheet.getRange(lastRow, 1, 1, champsCas5.length + 2)
      .setValues([["Nom machine","Clé Discovery", ...champsCas5]])
      .setFontWeight("bold").setBackground("#FFEBEE");
    lastRow++;

    for (const m of nonTrouves) {
      const ligne = [m.nom, m.key, ...champsCas5.map(c => m.valeursDiscovery?.[c] || "")];
      sheet.getRange(lastRow, 1, 1, ligne.length).setValues([ligne]);
      lastRow++;
    }
    sheet.autoResizeColumns(1, champsCas5.length + 2);
  }

  sheet.autoResizeColumns(1, headers.length + 2);
  Logger.log(`Rapport écrit : ${rows.length} ligne(s) dans "${CONFIG.RAPPORT_TAB}"`);
}

// ============================================================
//  NOTIFICATION GOOGLE CHAT — SYNC PRINCIPALE
// ============================================================
function _envoyerGoogleChatCard(actions) {
  const now      = new Date();
  const parCle   = {};
  const parChamp = {};

  for (const a of actions) {
    if (!parCle[a.key]) parCle[a.key] = [];
    parCle[a.key].push(a);
    parChamp[a.champ] = (parChamp[a.champ] || 0) + 1;
  }

  const champWidgets = Object.entries(parChamp)
    .sort((a, b) => b[1] - a[1])
    .map(([champ, nb]) => ({
      decoratedText: { topLabel: champ, text: `${nb} mise(s) à jour`, startIcon: { knownIcon: "BOOKMARK" } }
    }));

  const detailWidgets = actions.slice(0, 15).map(a => ({
    decoratedText: {
      topLabel: `${a.nom || a.key} — ${a.champ}`,
      text: `<font color="#c62828">${a.ancienne || "(vide)"}</font>  →  <font color="#2e7d32">${a.nouvelle}</font>`,
    }
  }));

  if (actions.length > 15) {
    detailWidgets.push({
      textParagraph: { text: `<i>... et ${actions.length - 15} autre(s). Consultez l'onglet "${CONFIG.RAPPORT_TAB}".</i>` }
    });
  }

  const card = {
    cardsV2: [{
      cardId: "sync-rapport",
      card: {
        header: {
          title: "🔄 Sync Discovery → Inventaire",
          subtitle: now.toLocaleString("fr-FR"),
          imageUrl: "https://fonts.gstatic.com/s/i/googlematerialicons/sync/v6/googlematerialicons-sync-48dp.png",
          imageType: "CIRCLE",
        },
        sections: [
          {
            header: "📊 Résumé",
            widgets: [
              { decoratedText: { topLabel: "Serveurs impactés", text: String(Object.keys(parCle).length), startIcon: { knownIcon: "COMPUTER" } } },
              { decoratedText: { topLabel: "Champs mis à jour",  text: String(actions.length), startIcon: { knownIcon: "EDIT" } } },
            ]
          },
          { header: "📈 Répartition par champ",      collapsible: true, uncollapsibleWidgetsCount: 3, widgets: champWidgets },
          { header: "📋 Détail des modifications",   collapsible: true, uncollapsibleWidgetsCount: 3, widgets: detailWidgets },
          {
            widgets: [{
              buttonList: { buttons: [{
                text: "Ouvrir l'inventaire",
                icon: { knownIcon: "OPEN_IN_NEW" },
                onClick: { openLink: { url: SpreadsheetApp.getActiveSpreadsheet().getUrl() } }
              }]}
            }]
          }
        ]
      }
    }]
  };

  const resp = UrlFetchApp.fetch(CONFIG.GOOGLE_CHAT_WEBHOOK, {
    method: "post", contentType: "application/json",
    payload: JSON.stringify(card), muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`⚠️ Webhook Chat — HTTP ${resp.getResponseCode()} : ${resp.getContentText()}`);
  } else {
    Logger.log("Notification Google Chat envoyée.");
  }
}

// ============================================================
//  NOTIFICATION GOOGLE CHAT — CAS 5
// ============================================================
function _envoyerGoogleChatCardCas5(nonTrouves) {
  const now = new Date();

  const machineWidgets = nonTrouves.map(m => ({
    decoratedText: {
      topLabel: m.key,
      text: m.nom !== m.key ? m.nom : "(nom non disponible)",
      startIcon: { knownIcon: "COMPUTER" },
    }
  }));

  const card = {
    cardsV2: [{
      cardId: "cas5-rapport",
      card: {
        header: {
          title: "🆕 Nouvelles machines à créer",
          subtitle: `${nonTrouves.length} machine(s) détectée(s) — ${now.toLocaleString("fr-FR")}`,
          imageUrl: "https://fonts.gstatic.com/s/i/googlematerialicons/add_circle/v6/googlematerialicons-add_circle-48dp.png",
          imageType: "CIRCLE",
        },
        sections: [
          { header: "🖥️ Machines absentes de l'inventaire (Cas 5)", widgets: machineWidgets },
          {
            widgets: [{
              buttonList: { buttons: [{
                text: "Ouvrir l'inventaire",
                icon: { knownIcon: "OPEN_IN_NEW" },
                onClick: { openLink: { url: SpreadsheetApp.getActiveSpreadsheet().getUrl() } }
              }]}
            }]
          }
        ]
      }
    }]
  };

  const resp = UrlFetchApp.fetch(CONFIG.GOOGLE_CHAT_WEBHOOK_CAS5, {
    method: "post", contentType: "application/json",
    payload: JSON.stringify(card), muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`⚠️ Webhook Cas 5 — HTTP ${resp.getResponseCode()} : ${resp.getContentText()}`);
  } else {
    Logger.log(`Notification Cas 5 envoyée : ${nonTrouves.length} machine(s).`);
  }
}
