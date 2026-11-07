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

# ── Hyprland ────────────────────────────────────────────────────────────────
# Añade al final de la configuración un bloque entre marcas (atajo, reglas de
# ventana y arranque con la sesión). Volver a ejecutar el script lo reemplaza.
# En Wayland la app no puede colocarse sola, así que las reglas hacen de
# colocación: panel flotante, fijado en todos los escritorios, en el borde derecho.
HYPR_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hypr"
MARK_BEGIN=">>> quicknotes"
MARK_END="<<< quicknotes"
CLASS='^(quicknotes|dev\.quicknotes\.app)$'

has_hyprland() {
  [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ] || [ -f "$HYPR_DIR/hyprland.lua" ] || [ -f "$HYPR_DIR/hyprland.conf" ]
}

# '<Super><Shift>j' -> modificadores "SUPER SHIFT" y tecla "J" ('space' -> "SPACE").
hypr_mods() {
  printf '%s' "$1" | grep -o '<[^>]*>' | tr -d '<>' | tr '[:lower:]' '[:upper:]' |
    sed 's/^CONTROL$/CTRL/; s/^PRIMARY$/CTRL/' | tr '\n' ' ' | sed 's/ $//'
}
hypr_key() {
  printf '%s' "$1" | sed 's/<[^>]*>//g' | tr '[:lower:]' '[:upper:]'
}

hypr_setup() {
  if [ -f "$HYPR_DIR/hyprland.lua" ]; then
    file="$HYPR_DIR/hyprland.lua"; c="--"
  else
    file="$HYPR_DIR/hyprland.conf"; c="#"
  fi
  [ -f "$file" ] || { echo "No se encontró $file"; exit 1; }

  # Quitar el bloque anterior, si lo hay.
  if grep -qF -e "$c $MARK_BEGIN" "$file"; then
    cp "$file" "$file.quicknotes.bak"
    sed -i "/^$c $MARK_BEGIN/,/^$c $MARK_END/d" "$file"
  fi

  if [ "$BINDING" = "--remove" ]; then
    echo "Atajo y reglas de QuickNotes eliminados de $file."
  else
    mods=$(hypr_mods "$BINDING")
    key=$(hypr_key "$BINDING")
    [ -n "$key" ] || { echo "Atajo no válido: $BINDING"; exit 1; }
    if [ "$c" = "--" ]; then
      combo=$(printf '%s' "$mods" | sed 's/ / + /g')
      [ -n "$combo" ] && combo="$combo + "
      cat >>"$file" <<EOF

-- $MARK_BEGIN (lo gestiona setup-shortcut.sh; quitar con: sh /usr/share/quicknotes/setup-shortcut.sh --remove)
hl.bind("$combo$key", hl.dsp.exec_cmd("$COMMAND"))
hl.window_rule({
    name  = "quicknotes-panel",
    match = { class = [[$CLASS]] },
    float = true,
    pin   = true,
    size  = "440 monitor_h-60",
    move  = "monitor_w-450 50",
})
hl.on("hyprland.start", function ()
  hl.exec_cmd("${QUICKNOTES_BIN:-quicknotes} --hidden")
end)
-- $MARK_END
EOF
    else
      cat >>"$file" <<EOF

# $MARK_BEGIN (lo gestiona setup-shortcut.sh; quitar con: sh /usr/share/quicknotes/setup-shortcut.sh --remove)
bind = $mods, $key, exec, $COMMAND
windowrule = float, class:$CLASS
windowrule = pin, class:$CLASS
windowrule = size 440 monitor_h-60, class:$CLASS
windowrule = move monitor_w-450 50, class:$CLASS
exec-once = ${QUICKNOTES_BIN:-quicknotes} --hidden
# $MARK_END
EOF
    fi
    echo "Listo: $BINDING ejecuta \"$COMMAND\" (añadido a $file)."
  fi
  command -v hyprctl >/dev/null 2>&1 && hyprctl reload >/dev/null 2>&1 || true
}

if has_hyprland; then
  hypr_setup
  exit 0
fi

# ── GNOME y otros ───────────────────────────────────────────────────────────

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
