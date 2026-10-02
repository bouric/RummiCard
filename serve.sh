#!/bin/bash
# Sert le jeu sur le réseau local, pour y jouer depuis un iPad ou un téléphone.
# Le Mac doit rester allumé et sur le même Wi-Fi que la tablette.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8777}"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '')"

echo "RummiCard — serveur local"
if [ -n "$IP" ]; then
  echo "  Sur l'iPad, ouvrez dans Safari :  http://${IP}:${PORT}"
  echo "  puis Partager ▸ « Sur l'écran d'accueil » pour l'avoir en icône."
else
  echo "  Adresse introuvable : vérifiez que le Mac est connecté au Wi-Fi."
fi
echo "  Ctrl-C pour arrêter."
echo
exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory Resources/web
