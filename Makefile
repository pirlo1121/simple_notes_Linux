# QuickNotes — tareas habituales. `make help` para ver la lista.

.PHONY: help deps dev check test build deb install update close uninstall shortcut clean

help:
	@echo "make deps      Instala dependencias del sistema (sudo) y de npm"
	@echo "make dev       Ejecuta la app en modo desarrollo"
	@echo "make check     Typecheck + cargo check"
	@echo "make test      Tests de Rust"
	@echo "make deb       Genera el paquete .deb"
	@echo "make install   Instala el .deb generado (sudo)"
	@echo "make update    Compila, cierra, instala y reabre la app"
	@echo "make close     Cierra la app guardando todo"
	@echo "make shortcut  Configura Ctrl+Espacio en el escritorio (GNOME)"

deps:
	sudo apt-get update
	sudo apt-get install -y build-essential curl wget file pkg-config libssl-dev \
		libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev
	@command -v cargo >/dev/null || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
	npm ci || npm install

dev:
	npm run tauri dev

check:
	npm run typecheck
	cd src-tauri && cargo check

test:
	cd src-tauri && cargo test

build deb:
	npm run tauri build -- --bundles deb
	@ls -1 src-tauri/target/release/bundle/deb/*.deb

install:
	sudo apt install -y ./src-tauri/target/release/bundle/deb/QuickNotes_*_amd64.deb

update:
	sh scripts/actualizar.sh

close:
	sh scripts/actualizar.sh cerrar

uninstall:
	sudo apt remove -y $$(dpkg-deb -f src-tauri/target/release/bundle/deb/*.deb Package)

shortcut:
	sh packaging/setup-shortcut.sh

clean:
	rm -rf dist src-tauri/target
