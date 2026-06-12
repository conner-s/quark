APP_ID         := tel.quark.app
FLATPAK_MANIFEST := flatpak/$(APP_ID).yml
FLATPAK_REPO   := flatpak-repo
FLATPAK_BUILD  := flatpak-build
FLATPAK_BUNDLE := quark.flatpak

CARGO_MANIFEST := src-tauri/Cargo.toml

.DEFAULT_GOAL := help

.PHONY: help
help:
	@awk 'BEGIN {FS = ":.*##"; printf "Targets:\n"} \
		/^[a-zA-Z0-9_.-]+:.*##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' \
		$(MAKEFILE_LIST)

# ---- Frontend / dev -----------------------------------------------------

.PHONY: dev
dev: ## Vite dev server with mock IPC (no Rust)
	pnpm dev

.PHONY: tauri-dev
tauri-dev: ## Full Tauri app with hot reload
	pnpm tauri dev

.PHONY: build
build: ## Frontend production build (tsc + vite)
	pnpm build

.PHONY: tauri-build
tauri-build: ## Release Tauri bundle (.deb / .AppImage / etc)
	pnpm tauri build

# ---- Mobile (Android) ---------------------------------------------------
# Tauri's Android tooling needs ANDROID_HOME, NDK_HOME, and JAVA_HOME on PATH.
# Override these on the command line if your toolchain lives elsewhere.

ANDROID_SDK_ROOT ?= $(HOME)/Library/Android/sdk
ANDROID_NDK_VERSION ?= $(shell ls $(ANDROID_SDK_ROOT)/ndk 2>/dev/null | sort -V | tail -n 1)
ANDROID_JAVA_HOME ?= $(shell /usr/libexec/java_home -v 21 2>/dev/null)

android_env = \
	ANDROID_HOME=$(ANDROID_SDK_ROOT) \
	NDK_HOME=$(ANDROID_SDK_ROOT)/ndk/$(ANDROID_NDK_VERSION) \
	JAVA_HOME=$(ANDROID_JAVA_HOME)

.PHONY: android-init
android-init: ## Generate the Android Studio project under src-tauri/gen/android
	$(android_env) pnpm tauri android init

.PHONY: android-dev
android-dev: ## Run on a connected Android device / emulator (hot reload)
	$(android_env) pnpm tauri android dev

.PHONY: android-build
android-build: ## Release arm64 APK (covers all modern physical devices)
	$(android_env) pnpm tauri android build --apk --target aarch64

.PHONY: android-build-universal
android-build-universal: ## Release APK + AAB for all four ABIs (~4x larger; Play Store / emulators)
	$(android_env) pnpm tauri android build

.PHONY: android-build-debug
android-build-debug: ## Debug APK for arm64 only (fastest dev validation)
	$(android_env) pnpm tauri android build --debug --apk --target aarch64

# ---- Tests / checks -----------------------------------------------------

.PHONY: test
test: test-js test-rust ## Run all tests

.PHONY: test-js
test-js: ## Vitest single run
	pnpm test

.PHONY: test-rust
test-rust: ## cargo test in src-tauri
	cargo test --manifest-path $(CARGO_MANIFEST)

.PHONY: fmt
fmt: ## cargo fmt (Rust)
	cargo fmt --manifest-path $(CARGO_MANIFEST)

.PHONY: clippy
clippy: ## cargo clippy with warnings as errors
	cargo clippy --manifest-path $(CARGO_MANIFEST) --all-targets -- -D warnings

.PHONY: check
check: clippy test ## Lint + tests

# ---- Flatpak ------------------------------------------------------------

.PHONY: flatpak
flatpak: $(FLATPAK_BUNDLE) ## Build the flatpak bundle (quark.flatpak)

$(FLATPAK_BUNDLE): $(FLATPAK_MANIFEST) flatpak/quark-launch.sh
	flatpak-builder --force-clean --repo=$(FLATPAK_REPO) $(FLATPAK_BUILD) $(FLATPAK_MANIFEST)
	flatpak build-bundle $(FLATPAK_REPO) $(FLATPAK_BUNDLE) $(APP_ID)

.PHONY: flatpak-install
flatpak-install: $(FLATPAK_BUNDLE) ## Install (or reinstall) the built bundle system-wide
	flatpak install --reinstall --assumeyes $(FLATPAK_BUNDLE)

.PHONY: flatpak-run
flatpak-run: ## Run the installed flatpak
	flatpak run $(APP_ID)

.PHONY: flatpak-uninstall
flatpak-uninstall: ## Uninstall the flatpak
	flatpak uninstall --assumeyes $(APP_ID)

.PHONY: flatpak-reinstall
flatpak-reinstall: flatpak flatpak-install ## Rebuild + reinstall

# Convenience: build, install, launch in one shot.
.PHONY: ship
ship: flatpak flatpak-install flatpak-run ## Build, install, and run the flatpak

# ---- Cleanup ------------------------------------------------------------

.PHONY: clean
clean: ## Remove frontend + Rust build artifacts
	rm -rf dist
	cargo clean --manifest-path $(CARGO_MANIFEST)

.PHONY: clean-flatpak
clean-flatpak: ## Remove flatpak build dirs and bundle
	rm -rf $(FLATPAK_BUILD) $(FLATPAK_REPO) .flatpak-builder repo build-dir $(FLATPAK_BUNDLE)

.PHONY: distclean
distclean: clean clean-flatpak ## Remove everything reproducible (keeps node_modules)
