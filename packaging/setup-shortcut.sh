#!/bin/sh
# Registra Ctrl+Espacio -> "quicknotes --toggle" como atajo del escritorio.
#
# Es la forma más fiable en GNOME y la única en Wayland, donde una aplicación
# no puede capturar atajos globales por sí misma.
#
#   sh setup-shortcut.sh              instala Ctrl+Espacio
#   sh setup-shortcut.sh '<Super>j'   otra combinación
#   sh setup-shortcut.sh --remove     quita el atajo
set -eu

BINDING="${1:-<Control>space}"
COMMAND="${QUICKNOTES_BIN:-quicknotes} --toggle"
MEDIA=org.gnome.settings-daemon.plugins.media-keys
KPATH=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/quicknotes/
SCHEMA="$MEDIA.custom-keybinding:$KPATH"

has_gnome() {
  command -v gsettings >/dev/null 2>&1 && gsettings list-schemas 2>/dev/null | grep -qx "$MEDIA"
}

if ! has_gnome; then
  cat <<MSG
No se detectó GNOME. Crea el atajo a mano en tu escritorio:

  Comando:  $COMMAND
  Atajo:    Ctrl+Espacio

  KDE Plasma:  Preferencias del sistema > Atajos > Añadir comando
  XFCE:        Configuración > Teclado > Atajos de aplicaciones
  i3 / sway:   bindsym Control+space exec $COMMAND
  Hyprland:    bind = CTRL, SPACE, exec, $COMMAND
MSG
  exit 0
fi

current=$(gsettings get "$MEDIA" custom-keybindings)

if [ "$BINDING" = "--remove" ]; then
  new=$(printf '%s' "$current" | sed "s#, '$KPATH'##; s#'$KPATH', ##; s#'$KPATH'##")
  case "$new" in "[]"|"@as []") new="@as []" ;; esac
  gsettings set "$MEDIA" custom-keybindings "$new"
  gsettings reset-recursively "$SCHEMA" 2>/dev/null || true
  echo "Atajo de QuickNotes eliminado."
  exit 0
fi

# Avisar si otra acción ya usa la misma combinación (no se modifica nada).
if command -v dconf >/dev/null 2>&1; then
  dconf dump / 2>/dev/null | grep -iF "'$BINDING'" | grep -v "^binding=" | while read -r line; do
    echo "Aviso: $BINDING también está asignado a: $line"
  done
fi

case "$current" in
  *"$KPATH"*) ;;
  "@as []"|"[]") gsettings set "$MEDIA" custom-keybindings "['$KPATH']" ;;
  *) gsettings set "$MEDIA" custom-keybindings "${current%]}, '$KPATH']" ;;
esac

gsettings set "$SCHEMA" name 'QuickNotes'
gsettings set "$SCHEMA" command "$COMMAND"
gsettings set "$SCHEMA" binding "$BINDING"
echo "Listo: $BINDING ejecuta \"$COMMAND\"."
