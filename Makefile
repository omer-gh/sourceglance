UUID := sourceglance@omer-gh.github.io
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
ZIP := dist/$(UUID).shell-extension.zip

.PHONY: install reload pack lint test smoke preview setup setup-payload setup-run setup-test

install:
	mkdir -p $(INSTALL_DIR)
	cp -r src/. $(INSTALL_DIR)/
	glib-compile-schemas $(INSTALL_DIR)/schemas
	@echo "Installed to $(INSTALL_DIR). Log out and back in on Wayland, then run:"
	@echo "  gnome-extensions enable $(UUID)"

# Load the current code into your running session without logging out (development only).
reload:
	./tools/dev-reload.sh

# GNOME Shell 45+ compiles schemas itself, so the zip ships only the XML. The Apache
# License asks for LICENSE and NOTICE to travel with every copy.
pack:
	mkdir -p dist
	cd src && zip -FS -r ../$(ZIP) . -x 'schemas/gschemas.compiled'
	zip -j $(ZIP) LICENSE NOTICE
	@echo "Built $(ZIP)"

lint:
	npx eslint src tests tools desktop/src desktop/vite.config.js

test:
	node --test tests/*.test.js

smoke:
	./tools/shell-smoke.sh

preview:
	./tools/preview.sh

# MSI-style setup wizard (docs/design/installer.md)
setup:
	./tools/build-setup.sh

setup-payload:
	./tools/build-setup.sh payload tools/installer/payload

setup-run: setup-payload
	gjs -m tools/installer/main.js $(ARGS)

setup-test: setup-payload
	./tests/setup-cli.sh
