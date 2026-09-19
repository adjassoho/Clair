#!/bin/bash

# Script de test complet du système de transcription
# Usage: ./test-complet.sh

set -e

echo "═══════════════════════════════════════════════════════════"
echo "    TEST COMPLET DU SYSTÈME DE TRANSCRIPTION CLAIR"
echo "═══════════════════════════════════════════════════════════"
echo ""

COLOR_RESET="\033[0m"
COLOR_GREEN="\033[32m"
COLOR_RED="\033[31m"
COLOR_YELLOW="\033[33m"
COLOR_BLUE="\033[34m"

ERRORS=0

function success() {
  echo -e "${COLOR_GREEN}✅ $1${COLOR_RESET}"
}

function error() {
  echo -e "${COLOR_RED}❌ $1${COLOR_RESET}"
  ERRORS=$((ERRORS + 1))
}

function warning() {
  echo -e "${COLOR_YELLOW}⚠️  $1${COLOR_RESET}"
}

function info() {
  echo -e "${COLOR_BLUE}ℹ️  $1${COLOR_RESET}"
}

function section() {
  echo ""
  echo -e "${COLOR_BLUE}───────────────────────────────────────────────────────────${COLOR_RESET}"
  echo -e "${COLOR_BLUE}  $1${COLOR_RESET}"
  echo -e "${COLOR_BLUE}───────────────────────────────────────────────────────────${COLOR_RESET}"
}

# Test 1 : Vérifier que les fichiers existent
section "1. VÉRIFICATION DES FICHIERS"

if [ -f "package.json" ]; then
  success "package.json trouvé"
else
  error "package.json manquant"
fi

if [ -f ".env" ]; then
  success "Fichier .env trouvé"
else
  error "Fichier .env manquant"
fi

if [ -d "server" ]; then
  success "Répertoire server/ trouvé"
else
  error "Répertoire server/ manquant"
fi

if [ -d "extension" ]; then
  success "Répertoire extension/ trouvé"
else
  error "Répertoire extension/ manquant"
fi

if [ -d "dist/extension" ]; then
  success "Extension buildée (dist/extension/)"
else
  warning "Extension non buildée - Exécutez: npm run build"
fi

# Test 2 : Vérifier la configuration
section "2. CONFIGURATION"

if grep -q "^GATEWAY_TOKEN=" .env; then
  TOKEN=$(grep "^GATEWAY_TOKEN=" .env | cut -d= -f2)
  if [ ${#TOKEN} -ge 16 ]; then
    success "GATEWAY_TOKEN configuré (${#TOKEN} caractères)"
  else
    error "GATEWAY_TOKEN trop court (${#TOKEN} caractères, min 16)"
  fi
else
  error "GATEWAY_TOKEN manquant dans .env"
fi

if grep -q "^GEMINI_API_KEY=" .env; then
  API_KEY=$(grep "^GEMINI_API_KEY=" .env | cut -d= -f2)
  if [ ${#API_KEY} -ge 20 ]; then
    success "GEMINI_API_KEY configuré (${#API_KEY} caractères)"
  else
    warning "GEMINI_API_KEY semble court (${#API_KEY} caractères)"
  fi
else
  error "GEMINI_API_KEY manquant dans .env"
fi

if grep -q "^GEMINI_LIVE_MODEL=" .env; then
  MODEL=$(grep "^GEMINI_LIVE_MODEL=" .env | cut -d= -f2)
  success "GEMINI_LIVE_MODEL = $MODEL"
else
  warning "GEMINI_LIVE_MODEL non défini (utilisera la valeur par défaut)"
fi

if grep -q "^PORT=" .env; then
  PORT=$(grep "^PORT=" .env | cut -d= -f2)
  success "PORT = $PORT"
else
  PORT=8787
  info "PORT non défini, utilisation par défaut: 8787"
fi

# Test 3 : Vérifier le serveur
section "3. SERVEUR BACKEND"

if pgrep -f "node.*server" > /dev/null; then
  success "Serveur Node.js en cours d'exécution"
  PID=$(pgrep -f "node.*server")
  info "PID: $PID"
else
  error "Serveur Node.js non lancé"
  echo ""
  echo "Pour le lancer:"
  echo "  cd $(pwd)"
  echo "  npm start"
  echo ""
fi

if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
  success "Port $PORT ouvert"
else
  error "Port $PORT fermé"
fi

# Test 4 : Health check
section "4. HEALTH CHECK"

if command -v curl > /dev/null; then
  if curl -s -f http://127.0.0.1:$PORT/health > /dev/null; then
    success "Endpoint /health accessible"

    HEALTH=$(curl -s http://127.0.0.1:$PORT/health)
    echo ""
    echo "Réponse du serveur:"
    echo "$HEALTH" | jq . 2>/dev/null || echo "$HEALTH"
    echo ""

    if echo "$HEALTH" | jq -e '.ok == true' > /dev/null 2>&1; then
      success "Serveur en bonne santé"
    else
      error "Serveur signale un problème"
    fi

    if echo "$HEALTH" | jq -e '.audioProvider' > /dev/null 2>&1; then
      PROVIDER=$(echo "$HEALTH" | jq -r '.audioProvider')
      success "Audio provider configuré: $PROVIDER"
    else
      warning "Audio provider non rapporté"
    fi
  else
    error "Endpoint /health inaccessible"
  fi
else
  warning "curl non installé, impossible de tester /health"
fi

# Test 5 : Extension Chrome
section "5. EXTENSION CHROME"

if [ -f "dist/extension/manifest.json" ]; then
  success "Extension buildée"

  NAME=$(cat dist/extension/manifest.json | jq -r '.name' 2>/dev/null)
  VERSION=$(cat dist/extension/manifest.json | jq -r '.version' 2>/dev/null)

  if [ -n "$NAME" ]; then
    info "Nom: $NAME"
  fi

  if [ -n "$VERSION" ]; then
    info "Version: $VERSION"
  fi

  # Vérifier les permissions
  if cat dist/extension/manifest.json | jq -e '.permissions | index("tabCapture")' > /dev/null 2>&1; then
    success "Permission 'tabCapture' présente"
  else
    error "Permission 'tabCapture' manquante"
  fi

  if cat dist/extension/manifest.json | jq -e '.permissions | index("audioCapture")' > /dev/null 2>&1; then
    success "Permission 'audioCapture' présente"
  else
    error "Permission 'audioCapture' manquante"
  fi
else
  error "Extension non buildée"
  echo ""
  echo "Pour la builder:"
  echo "  npm run build"
  echo ""
fi

# Test 6 : Dépendances
section "6. DÉPENDANCES"

if [ -d "node_modules" ]; then
  success "node_modules/ présent"

  if [ -f "node_modules/.package-lock.json" ]; then
    info "Dépendances verrouillées"
  fi
else
  error "node_modules/ manquant"
  echo ""
  echo "Pour installer les dépendances:"
  echo "  npm install"
  echo ""
fi

# Test 7 : Connexion WebSocket (optionnel)
section "7. TEST WEBSOCKET (Optionnel)"

if command -v node > /dev/null && pgrep -f "node.*server" > /dev/null; then
  echo "Test de connexion WebSocket depuis Node.js..."
  echo "(Retourne 403 = NORMAL car la connexion ne vient pas de l'extension Chrome)"
  echo ""

  node << 'EOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:8787');
let connected = false;

ws.on('open', () => {
  connected = true;
  console.log('  ✅ WebSocket ouvert (inattendu depuis Node.js)');
  ws.close();
});

ws.on('error', (err) => {
  if (err.message.includes('403')) {
    console.log('  ✅ Erreur 403 reçue (comportement attendu)');
    console.log('     Le serveur refuse les connexions non-Chrome (sécurité OK)');
  } else {
    console.log('  ⚠️  Erreur:', err.message);
  }
});

ws.on('close', () => {
  if (!connected) {
    console.log('  ℹ️  Connexion fermée sans avoir été ouverte (normal)');
  }
  process.exit(0);
});

setTimeout(() => {
  if (!connected) {
    console.log('  ⏱️  Timeout - Pas de réponse');
  }
  process.exit(0);
}, 2000);
EOF

else
  info "Test WebSocket ignoré (serveur non lancé ou Node.js absent)"
fi

# Résumé
echo ""
echo "═══════════════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
  echo -e "${COLOR_GREEN}     ✅ TOUS LES TESTS PASSÉS${COLOR_RESET}"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "Prochaines étapes:"
  echo "  1. Ouvrez Chrome et allez sur chrome://extensions/"
  echo "  2. Activez le mode développeur"
  echo "  3. Chargez l'extension depuis: $(pwd)/dist/extension"
  echo "  4. Ouvrez Teams et lancez une session"
  echo ""
  echo "Pour déboguer:"
  echo "  - Consultez COMMENCER_ICI.md"
  echo "  - Activez les logs debug dans l'extension"
  echo ""
else
  echo -e "${COLOR_RED}     ❌ $ERRORS ERREUR(S) DÉTECTÉE(S)${COLOR_RESET}"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "Corrigez les erreurs ci-dessus avant de continuer."
  echo ""
fi

exit $ERRORS
