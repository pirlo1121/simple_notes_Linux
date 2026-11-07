# QuickNotes — tareas habituales. `make help` para ver la lista.

.PHONY: help deps dev check test build pkg install close uninstall shortcut clean

help:
	@echo "make deps      Instala dependencias del sistema (sudo pacman) y de npm"
	@echo "make dev       Ejecuta la app en modo desarrollo"
	@echo "make check     Typecheck + cargo check"
	@echo "make test      Tests de Rust"
	@echo "make pkg       Genera el paquete de pacman (packaging/quicknotes-*.pkg.tar.zst)"
	@echo "make install   Instala el paquete generado (sudo pacman -U)"
	@echo "make uninstall Desinstala el paquete (sudo pacman -R)"
	@echo "make close     Cierra la app guardando todo"
	@echo "make shortcut  Configura Ctrl+Espacio en el escritorio (Hyprland o GNOME)"

deps:
	sudo pacman -S --needed base-devel nodejs npm rust webkit2gtk-4.1 gtk3 librsvg
	npm ci || npm install

dev:
	npm run tauri dev

check:
	npm run typecheck
	cd src-tauri && cargo check

test:
	cd src-tauri && cargo test

build pkg:
	cd packaging && makepkg -f
	@ls -1 packaging/quicknotes-*.pkg.tar.zst

install:
	sudo pacman -U --noconfirm $$(ls -1t packaging/quicknotes-*.pkg.tar.zst | head -1)

close:
	quicknotes --quit || true

uninstall:
	sudo pacman -R quicknotes

shortcut:
	sh packaging/setup-shortcut.sh

clean:
	rm -rf dist src-tauri/target packaging/src packaging/pkg packaging/*.pkg.tar.zst
