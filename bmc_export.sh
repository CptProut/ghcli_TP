#!/usr/bin/env bash
# ============================================================
#  BMC Discovery v1.14 — Export CSV des changements
#  Filtre les machines modifiées dans les N derniers jours
#  Usage : ./bmc_export.sh
#  Prérequis : curl, jq  (brew install jq si absent)
# ============================================================

# ─────────────────────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────────────────────
BMC_URL="https://VOTRE_INSTANCE_BMC"   # sans slash final
BMC_TOKEN="VOTRE_TOKEN_API"
OUTPUT_DIR="$HOME/Desktop"             # dossier de sortie du CSV
JOURS=7                                # fenêtre temporelle (jours)

# ─────────────────────────────────────────────────────────────
#  NE PAS MODIFIER EN DESSOUS
# ─────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Vérification des dépendances ──────────────────────────────
info "Vérification des dépendances..."
command -v curl    &>/dev/null || error "curl non trouvé. Installe-le avec : brew install curl"
command -v jq      &>/dev/null || error "jq non trouvé. Installe-le avec : brew install jq"
command -v python3 &>/dev/null || error "python3 non trouvé. Installe-le avec : brew install python3"

# ── Calcul de la date seuil (timestamp Unix, N jours en arrière) ──
SEUIL_TS=$(python3 -c "import time; print(int(time.time()) - ${JOURS} * 86400)")
SEUIL_DATE=$(python3 -c "import datetime; print(datetime.datetime.fromtimestamp(${SEUIL_TS}).strftime('%Y-%m-%d %H:%M:%S'))")

# ── Nom du fichier de sortie ──────────────────────────────────
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="${OUTPUT_DIR}/bmc_changes_${TIMESTAMP}.csv"
TMP_FILE=$(mktemp /tmp/bmc_raw_XXXXXX.json)

info "Connexion à BMC Discovery : ${BMC_URL}"
info "Fenêtre temporelle        : ${JOURS} derniers jours (depuis ${SEUIL_DATE})"
info "Fichier de sortie         : ${OUTPUT_FILE}"
echo ""

# ── Requête TDL (GET, encodage URL) ───────────────────────────
TDL_QUERY="search Host show name, fqdn, os, os_version, ip_address, mac_address, cpu_count, ram, disk_total, serial_no, model, manufacturer, domain, virtual, _update_time, _change_time, _last_update_time"

ENCODED_QUERY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${TDL_QUERY}'))")

info "Récupération de tous les hosts depuis BMC..."

HTTP_RESPONSE=$(curl --silent --show-error --write-out "HTTPSTATUS:%{http_code}" \
  --max-time 120 \
  --insecure \
  -X GET \
  "${BMC_URL}/api/v1.14/data/search?query=${ENCODED_QUERY}" \
  -H "Authorization: Bearer ${BMC_TOKEN}" \
  -H "Accept: application/json")

# Séparer body et code HTTP
HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed -e 's/HTTPSTATUS:[0-9]*$//')
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')

# ── Vérification du code HTTP ─────────────────────────────────
case "$HTTP_CODE" in
  200) ;;
  400) error "Requête invalide (400). Détail : $(echo "$HTTP_BODY" | jq -r '.message // .')" ;;
  401) error "Authentification refusée (401). Vérifie ton BMC_TOKEN." ;;
  403) error "Accès interdit (403). Droits insuffisants sur le token." ;;
  404) error "Endpoint introuvable (404). Vérifie BMC_URL." ;;
  *)   error "Erreur HTTP ${HTTP_CODE} : ${HTTP_BODY}" ;;
esac

# Sauvegarder le JSON brut
echo "$HTTP_BODY" > "$TMP_FILE"

NB_TOTAL=$(jq '.results // [] | length' "$TMP_FILE")
info "Hosts récupérés depuis BMC : ${NB_TOTAL}"

# ── Filtrage par date côté bash via python3 ───────────────────
info "Filtrage des machines modifiées depuis ${SEUIL_DATE}..."

python3 - <<PYEOF
import json, csv, datetime

seuil_ts  = ${SEUIL_TS}
output_file = "${OUTPUT_FILE}"

with open("${TMP_FILE}") as f:
    data = json.load(f)

headings  = data.get("headings", [])
results   = data.get("results", [])

# Index des colonnes de date disponibles
date_cols = [headings.index(n) for n in ["_update_time", "_change_time", "_last_update_time"] if n in headings]

def parse_bmc_date(val):
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.datetime.strptime(str(val), fmt).timestamp()
        except ValueError:
            pass
    return None

filtered, skipped = [], 0

for row in results:
    keep = not date_cols  # si aucune colonne date, on garde tout
    for idx in date_cols:
        val = row[idx] if idx < len(row) else None
        ts  = parse_bmc_date(val)
        if ts and ts >= seuil_ts:
            keep = True
            break
    if keep:
        filtered.append(row)
    else:
        skipped += 1

print(f"[INFO]  Machines dans la fenêtre temporelle : {len(filtered)}")
print(f"[INFO]  Machines ignorées (trop anciennes)  : {skipped}")

with open(output_file, "w", newline="", encoding="utf-8") as csvf:
    writer = csv.writer(csvf, quoting=csv.QUOTE_ALL)
    writer.writerow(headings)
    for row in filtered:
        cleaned = []
        for cell in row:
            if cell is None:
                cleaned.append("")
            elif isinstance(cell, bool):
                cleaned.append("true" if cell else "false")
            else:
                cleaned.append(str(cell))
        writer.writerow(cleaned)

print(f"[INFO]  CSV généré : {output_file}")
PYEOF

# ── Nettoyage fichier temporaire ──────────────────────────────
rm -f "$TMP_FILE"

# ── Résumé final ──────────────────────────────────────────────
echo ""
info "✅ Export terminé avec succès !"
info "   Fichier : ${OUTPUT_FILE}"
echo ""

# Ouvrir le dossier dans le Finder
open "$OUTPUT_DIR"
