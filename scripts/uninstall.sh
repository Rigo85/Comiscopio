#!/usr/bin/env bash
# uninstall.sh — Comiscopio uninstaller
#
# Removes everything created by Comiscopio at runtime:
#   - Application data and database  (~/.comiscopio/)
#   - Desktop entry                  (~/.local/share/applications/comiscopio.desktop)
#   - Application icon               (~/.local/share/icons/hicolor/1024x1024/apps/comiscopio.png)
#
# Does NOT remove the AppImage itself (the user placed it wherever they want).
#
# Usage:
#   bash uninstall.sh           # interactive — asks for confirmation
#   bash uninstall.sh --yes     # non-interactive

set -euo pipefail

FORCE=false
for arg in "$@"; do
  [[ "$arg" == "--yes" || "$arg" == "-y" ]] && FORCE=true
done

# ── paths ────────────────────────────────────────────────────────────────────
DATA_DIR="${HOME}/.comiscopio"
DESKTOP_FILE="${HOME}/.local/share/applications/comiscopio.desktop"
ICON_FILE="${HOME}/.local/share/icons/hicolor/1024x1024/apps/comiscopio.png"

# ── confirm ───────────────────────────────────────────────────────────────────
if [[ "$FORCE" == false ]]; then
  echo "Esto eliminará:"
  [[ -d "$DATA_DIR"    ]] && echo "  $DATA_DIR"
  [[ -f "$DESKTOP_FILE" ]] && echo "  $DESKTOP_FILE"
  [[ -f "$ICON_FILE"   ]] && echo "  $ICON_FILE"
  echo ""
  read -r -p "¿Continuar? [s/N] " reply
  [[ "$reply" =~ ^[ssSy]$ ]] || { echo "Cancelado."; exit 0; }
fi

# ── remove ────────────────────────────────────────────────────────────────────
removed=false

if [[ -d "$DATA_DIR" ]]; then
  rm -rf "$DATA_DIR"
  echo "Eliminado: $DATA_DIR"
  removed=true
fi

if [[ -f "$DESKTOP_FILE" ]]; then
  rm -f "$DESKTOP_FILE"
  echo "Eliminado: $DESKTOP_FILE"
  removed=true
  # Refresh desktop database so the entry disappears from launchers
  update-desktop-database "${HOME}/.local/share/applications" 2>/dev/null || true
fi

if [[ -f "$ICON_FILE" ]]; then
  rm -f "$ICON_FILE"
  echo "Eliminado: $ICON_FILE"
  removed=true
  gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" 2>/dev/null || true
fi

if [[ "$removed" == false ]]; then
  echo "Nada que eliminar — Comiscopio no parece haber sido ejecutado en este sistema."
else
  echo ""
  echo "Comiscopio desinstalado correctamente."
fi
