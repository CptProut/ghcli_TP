#!/usr/bin/env bash
# ============================================================
#  BMC Discovery v1.14 — Export CSV des changements
#  Gère la pagination, filtre par date côté local
#  Usage : ./bmc_export.sh
#  Prérequis : curl, python3  (brew install python3 si absent)
# ============================================================

# ─────────────────────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────────────────────
BMC_URL="https://VOTRE_INSTANCE_BMC"   # sans slash final
BMC_TOKEN="VOTRE_TOKEN_API"
OUTPUT_DIR="$HOME/Desktop"             # dossier de sortie du CSV
JOURS=7                                # fenêtre temporelle (jours)
PAGE_SIZE=100                          # nb de résultats par page

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
command -v curl    &>/dev/null || error "curl non trouvé : brew install curl"
command -v python3 &>/dev/null || error "python3 non trouvé : brew install python3"

# ── Calcul date seuil ─────────────────────────────────────────
SEUIL_TS=$(python3 -c "import time; print(int(time.time()) - ${JOURS} * 86400)")
SEUIL_DATE=$(python3 -c "import datetime; print(datetime.datetime.fromtimestamp(${SEUIL_TS}).strftime('%Y-%m-%d %H:%M:%S'))")

# ── Fichiers de travail ───────────────────────────────────────
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="${OUTPUT_DIR}/bmc_changes_${TIMESTAMP}.csv"
TMP_DIR=$(mktemp -d /tmp/bmc_XXXXXX)
TMP_PAGES="${TMP_DIR}/pages.json"  # fichier JSON combiné de toutes les pages

info "Connexion à BMC Discovery : ${BMC_URL}"
info "Fenêtre temporelle        : ${JOURS} derniers jours (depuis ${SEUIL_DATE})"
info "Fichier de sortie         : ${OUTPUT_FILE}"
echo ""

# ── Requête TDL ───────────────────────────────────────────────
TDL_QUERY="search Host show name, fqdn, os, os_version, ip_address, mac_address, cpu_count, ram, disk_total, serial_no, model, manufacturer, domain, virtual, _update_time, _change_time, _last_update_time"

# ── Fonction appel API avec gestion code HTTP ─────────────────
fetch_page() {
  local offset=$1
  local url="${BMC_URL}/api/v1.14/data/search"

  # Encodage de la query + paramètres de pagination
  local encoded
  encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${TDL_QUERY}'))")

  local full_url="${url}?query=${encoded}&offset=${offset}&results_id=&format=json"

  local response
  response=$(curl --silent --show-error --write-out "HTTPSTATUS:%{http_code}" \
    --max-time 120 \
    --insecure \
    -X GET \
    "$full_url" \
    -H "Authorization: Bearer ${BMC_TOKEN}" \
    -H "Accept: application/json")

  local body code
  body=$(echo "$response" | sed -e 's/HTTPSTATUS:[0-9]*$//')
  code=$(echo "$response" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')

  case "$code" in
    200) echo "$body" ;;
    401) error "Authentification refusée (401). Vérifie ton BMC_TOKEN." ;;
    403) error "Accès interdit (403). Droits insuffisants." ;;
    404) error "Endpoint introuvable (404). Vérifie BMC_URL." ;;
    *)   error "Erreur HTTP ${code} : ${body}" ;;
  esac
}

# ── Récupération paginée ──────────────────────────────────────
info "Récupération des hosts (pagination par ${PAGE_SIZE})..."

# Première page pour connaître le total
FIRST_PAGE=$(fetch_page 0)
TOTAL=$(echo "$FIRST_PAGE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count', 0))")
info "Total hosts dans BMC : ${TOTAL}"

# Écrire la première page dans le fichier combiné
echo "$FIRST_PAGE" > "${TMP_DIR}/page_0.json"

# Pages suivantes si nécessaire
OFFSET=${PAGE_SIZE}
PAGE=1
while [ "$OFFSET" -lt "$TOTAL" ]; do
  info "  Récupération page ${PAGE} (offset ${OFFSET})..."
  fetch_page "$OFFSET" > "${TMP_DIR}/page_${PAGE}.json"
  OFFSET=$((OFFSET + PAGE_SIZE))
  PAGE=$((PAGE + 1))
done

info "Toutes les pages récupérées. Traitement en cours..."

# ── Traitement Python : fusion pages + filtrage date + CSV ────
python3 - <<PYEOF
import json, csv, datetime, os, glob

seuil_ts    = ${SEUIL_TS}
output_file = "${OUTPUT_FILE}"
tmp_dir     = "${TMP_DIR}"
page_size   = ${PAGE_SIZE}

# Charger toutes les pages
all_results = []
headings    = []

page_files = sorted(glob.glob(f"{tmp_dir}/page_*.json"))
for pf in page_files:
    with open(pf) as f:
        data = json.load(f)
    if not headings:
        headings = data.get("headings", [])
    all_results.extend(data.get("results", []))

print(f"[INFO]  Total hosts chargés   : {len(all_results)}")

# Index des colonnes de date
date_cols = [headings.index(n) for n in ["_update_time", "_change_time", "_last_update_time"] if n in headings]

if not date_cols:
    print("[WARN]  Aucune colonne de date trouvée — export de tous les hosts")

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

for row in all_results:
    keep = not date_cols
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

print(f"[INFO]  Machines modifiées     : {len(filtered)}")
print(f"[INFO]  Machines ignorées      : {skipped}")

# Écriture CSV
with open(output_file, "w", newline="", encoding="utf-8") as csvf:
    writer = csv.writer(csvf, quoting=csv.QUOTE_ALL)
    writer.writerow(headings)
    for row in filtered:
        writer.writerow([
            "" if cell is None
            else ("true" if cell else "false") if isinstance(cell, bool)
            else str(cell)
            for cell in row
        ])

print(f"[INFO]  CSV généré : {output_file}")
PYEOF

# ── Nettoyage ─────────────────────────────────────────────────
rm -rf "$TMP_DIR"

# ── Résumé ────────────────────────────────────────────────────
echo ""
info "✅ Export terminé !"
info "   Fichier : ${OUTPUT_FILE}"
echo ""
open "$OUTPUT_DIR"
