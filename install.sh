#!/bin/sh
# OmnySSH installation script
# Usage: curl -fsSL https://raw.githubusercontent.com/AnonyJcy/omnyssh-cn/zh-cn/install.sh | sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# GitHub repository
REPO="AnonyJcy/omnyssh-cn"
BINARY_NAME="omny"

# Print colored messages
print_info() {
    printf "${BLUE}[INFO]${NC} %s\n" "$1"
}

print_success() {
    printf "${GREEN}[SUCCESS]${NC} %s\n" "$1"
}

print_error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
}

print_warning() {
    printf "${YELLOW}[WARNING]${NC} %s\n" "$1"
}

# Detect OS and architecture
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    IS_TERMUX=0

    # Termux reports OS=Linux from uname but uses Bionic libc and a
    # non-standard prefix. Detect it first so we pick a static musl build
    # and install into $PREFIX/bin instead of /usr/local/bin.
    if [ -n "${TERMUX_VERSION:-}" ] || \
       { [ -n "${PREFIX:-}" ] && [ -d "${PREFIX}/bin" ] && \
         [ "${PREFIX#*/com.termux/}" != "${PREFIX}" ]; }; then
        IS_TERMUX=1
        PLATFORM="unknown-linux-musl"
        INSTALL_DIR="$PREFIX/bin"
        print_info "Termux detected"
    else
        case "$OS" in
            Linux*)
                PLATFORM="unknown-linux-gnu"
                INSTALL_DIR="/usr/local/bin"
                ;;
            Darwin*)
                PLATFORM="apple-darwin"
                INSTALL_DIR="/usr/local/bin"
                ;;
            MINGW*|MSYS*|CYGWIN*)
                PLATFORM="pc-windows-msvc"
                INSTALL_DIR="$HOME/bin"
                EXT=".exe"
                print_warning "Windows detected. Manual PATH configuration may be required."
                ;;
            *)
                print_error "Unsupported OS: $OS"
                exit 1
                ;;
        esac
    fi

    case "$ARCH" in
        x86_64|amd64)
            ARCH="x86_64"
            ;;
        aarch64|arm64)
            ARCH="aarch64"
            ;;
        *)
            print_error "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    # aarch64 Linux ships only as a static musl build — one binary that runs on
    # every ARM64 Linux distro (glibc or not). No gnu archive is released.
    if [ "$PLATFORM" = "unknown-linux-gnu" ] && [ "$ARCH" = "aarch64" ]; then
        PLATFORM="unknown-linux-musl"
    fi

    TARGET="${ARCH}-${PLATFORM}"
    print_info "Detected platform: $TARGET"
}

# Get latest release version
get_latest_release() {
    print_info "Fetching latest release version..."

    # Try using curl first, then wget.
    # GitHub may return compact (single-line) JSON, so the regex must anchor
    # on the "tag_name" field — otherwise a greedy match captures the last
    # quoted string on the line (e.g. inside the release body).
    TAG_RE='s/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/'
    if command -v curl >/dev/null 2>&1; then
        VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | \
                  tr ',' '\n' | grep '"tag_name":' | sed -E "$TAG_RE")
    elif command -v wget >/dev/null 2>&1; then
        VERSION=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" | \
                  tr ',' '\n' | grep '"tag_name":' | sed -E "$TAG_RE")
    else
        print_error "Neither curl nor wget found. Please install one of them."
        exit 1
    fi

    if [ -z "$VERSION" ]; then
        print_error "Failed to fetch latest release version"
        exit 1
    fi

    print_info "Latest version: $VERSION"
}

# Download and extract binary
download_and_install() {
    ARCHIVE_NAME="${BINARY_NAME}-${TARGET}"

    if [ "$PLATFORM" = "pc-windows-msvc" ]; then
        ARCHIVE_EXT="zip"
    else
        ARCHIVE_EXT="tar.gz"
    fi

    DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/${ARCHIVE_NAME}.${ARCHIVE_EXT}"

    print_info "Downloading from: $DOWNLOAD_URL"

    ARCHIVE_FILE="$TMP_DIR/${ARCHIVE_NAME}.${ARCHIVE_EXT}"

    # Download the archive
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE_FILE"
    else
        wget -qO "$ARCHIVE_FILE" "$DOWNLOAD_URL"
    fi

    if [ ! -f "$ARCHIVE_FILE" ]; then
        print_error "Failed to download archive"
        exit 1
    fi

    # Verify download integrity
    SHA_URL="https://github.com/$REPO/releases/download/$VERSION/SHA256SUMS"
    echo "Verifying checksum..."
    # Pick whichever checksum tool is present: sha256sum on Linux, shasum on macOS.
    if command -v sha256sum >/dev/null 2>&1; then
        SHA_CHECK="sha256sum -c -"
    elif command -v shasum >/dev/null 2>&1; then
        SHA_CHECK="shasum -a 256 -c -"
    else
        SHA_CHECK=""
    fi
    if [ -z "$SHA_CHECK" ]; then
        echo "WARNING: no sha256 tool found — skipping verification"
    elif curl -fsSL "$SHA_URL" -o "$TMP_DIR/SHA256SUMS" 2>/dev/null; then
        (cd "$TMP_DIR" && grep "${ARCHIVE_NAME}.${ARCHIVE_EXT}" SHA256SUMS | $SHA_CHECK) || {
            echo "ERROR: Checksum verification failed!"
            rm -rf "$TMP_DIR"
            exit 1
        }
        echo "Checksum verified ✓"
    else
        echo "WARNING: Could not download SHA256SUMS — skipping verification"
    fi

    print_info "Extracting archive..."

    # Extract based on archive type
    if [ "$ARCHIVE_EXT" = "zip" ]; then
        unzip -q "$ARCHIVE_FILE" -d "$TMP_DIR"
    else
        tar -xzf "$ARCHIVE_FILE" -C "$TMP_DIR"
    fi

    # Find the binary
    BINARY_PATH="$(find "$TMP_DIR" -name "${BINARY_NAME}${EXT}" -type f | head -n 1)"

    if [ ! -f "$BINARY_PATH" ]; then
        print_error "Binary not found in archive"
        exit 1
    fi

    # Create install directory if it doesn't exist
    if [ ! -d "$INSTALL_DIR" ]; then
        print_info "Creating install directory: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi

    # Install the binary
    print_info "Installing to $INSTALL_DIR..."

    if [ -w "$INSTALL_DIR" ]; then
        mv "$BINARY_PATH" "$INSTALL_DIR/$BINARY_NAME${EXT}"
        chmod +x "$INSTALL_DIR/$BINARY_NAME${EXT}"
    elif [ "$IS_TERMUX" = "1" ]; then
        # Termux has no sudo; $PREFIX/bin should already be writable.
        print_error "Install directory $INSTALL_DIR is not writable"
        exit 1
    else
        # Need sudo for system directories
        print_warning "Installing to system directory requires sudo privileges"
        sudo mv "$BINARY_PATH" "$INSTALL_DIR/$BINARY_NAME${EXT}"
        sudo chmod +x "$INSTALL_DIR/$BINARY_NAME${EXT}"
    fi

    print_success "Binary installed to: $INSTALL_DIR/$BINARY_NAME${EXT}"
}

# Check if installation was successful
verify_installation() {
    print_info "Verifying installation..."

    # Check if binary is in PATH
    if command -v "$BINARY_NAME" >/dev/null 2>&1; then
        INSTALLED_VERSION=$($BINARY_NAME --version | head -n 1)
        print_success "Installation successful! $INSTALLED_VERSION"
        print_info "Run '$BINARY_NAME' to get started"
    else
        print_warning "$BINARY_NAME installed but not found in PATH"
        print_info "Add $INSTALL_DIR to your PATH or run: $INSTALL_DIR/$BINARY_NAME"

        # Suggest PATH configuration
        SHELL_NAME="$(basename "$SHELL")"
        case "$SHELL_NAME" in
            bash)
                CONFIG_FILE="$HOME/.bashrc"
                ;;
            zsh)
                CONFIG_FILE="$HOME/.zshrc"
                ;;
            fish)
                CONFIG_FILE="$HOME/.config/fish/config.fish"
                ;;
            *)
                CONFIG_FILE="$HOME/.profile"
                ;;
        esac

        print_info "To add to PATH, run:"
        print_info "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> $CONFIG_FILE"
        print_info "  source $CONFIG_FILE"
    fi
}

# Install man page
install_man_page() {
    # Skip man page installation on Windows
    if [ "$PLATFORM" = "pc-windows-msvc" ]; then
        return
    fi

    print_info "Installing man page..."

    MAN_URL="https://raw.githubusercontent.com/$REPO/$VERSION/doc/omny.1"
    if [ "$IS_TERMUX" = "1" ]; then
        MAN_DIR="$PREFIX/share/man/man1"
    else
        MAN_DIR="/usr/local/share/man/man1"
    fi

    if ! command -v curl >/dev/null 2>&1; then
        print_info "Man page installation skipped (curl not found)"
        return
    fi

    # Download to a temp file first — needs no privileges. Placing it into a
    # system man directory may require sudo, mirroring the binary install above.
    MAN_TMP="$TMP_DIR/omny.1"
    if ! curl -fsSL "$MAN_URL" -o "$MAN_TMP" 2>/dev/null; then
        print_info "Man page installation skipped (download failed)"
        return
    fi

    if mkdir -p "$MAN_DIR" 2>/dev/null && cp "$MAN_TMP" "$MAN_DIR/omny.1" 2>/dev/null; then
        print_success "Man page installed. Run 'man omny' for documentation"
    elif [ "$IS_TERMUX" != "1" ] && sudo mkdir -p "$MAN_DIR" 2>/dev/null && sudo cp "$MAN_TMP" "$MAN_DIR/omny.1" 2>/dev/null; then
        print_success "Man page installed. Run 'man omny' for documentation"
    else
        print_info "Man page installation skipped (optional)"
    fi
}

# Download a release asset into $TMP_DIR and verify it against SHA256SUMS.
# Args: <asset-name>. On success sets $ASSET_PATH to the file; returns 1 on failure.
download_release_asset() {
    _name="$1"
    _url="https://github.com/$REPO/releases/download/$VERSION/$_name"
    ASSET_PATH="$TMP_DIR/$_name"
    print_info "Downloading $_name..."
    if command -v curl >/dev/null 2>&1; then
        curl -fL "$_url" -o "$ASSET_PATH" || { print_error "Download failed: $_name"; return 1; }
    else
        wget -qO "$ASSET_PATH" "$_url" || { print_error "Download failed: $_name"; return 1; }
    fi

    if command -v sha256sum >/dev/null 2>&1; then
        _sha_check="sha256sum -c -"
    elif command -v shasum >/dev/null 2>&1; then
        _sha_check="shasum -a 256 -c -"
    else
        _sha_check=""
    fi
    if [ -z "$_sha_check" ]; then
        print_warning "no sha256 tool found — skipping verification"
    elif curl -fsSL "https://github.com/$REPO/releases/download/$VERSION/SHA256SUMS" -o "$TMP_DIR/SHA256SUMS" 2>/dev/null; then
        (cd "$TMP_DIR" && grep " ${_name}\$" SHA256SUMS | $_sha_check) || {
            print_error "Checksum verification failed for $_name"
            return 1
        }
        print_success "Checksum verified"
    else
        print_warning "Could not download SHA256SUMS — skipping verification"
    fi
}

# Install the GUI desktop app. Returns non-zero when unavailable for the platform.
install_gui() {
    # Set when no desktop build exists for this platform at all, as opposed to one
    # that exists and failed to install. The caller falls back to the TUI on the
    # first and reports failure on the second.
    GUI_UNAVAILABLE=0

    # Public GUI asset names (match the release table): macOS keeps the full
    # target triple, Linux/Windows are x86_64-only so they use the short arch.
    case "$PLATFORM" in
        apple-darwin)      GUI_ASSET="OmnySSH-${TARGET}.dmg" ;;
        unknown-linux-gnu) GUI_ASSET="OmnySSH-${ARCH}.AppImage" ;;
        pc-windows-msvc)   GUI_ASSET="OmnySSH-${ARCH}-setup.exe" ;;
        *)
            GUI_UNAVAILABLE=1
            print_warning "The desktop GUI is not available for $TARGET."
            return 1
            ;;
    esac

    case "$PLATFORM" in
        apple-darwin)      install_gui_macos ;;
        unknown-linux-gnu) install_gui_linux ;;
        pc-windows-msvc)   install_gui_windows ;;
    esac
}

install_gui_macos() {
    download_release_asset "$GUI_ASSET" || return 1
    DMG="$ASSET_PATH"
    print_info "Mounting disk image..."
    # hdiutil prints tab-separated fields, and a volume name already taken is mounted
    # as "OmnySSH 1" — so anything that stops at the first space picks up whatever the
    # user left mounted and installs that instead. Take the last field of the last row.
    _attach=$(hdiutil attach -nobrowse -readonly "$DMG" 2>/dev/null || true)
    MOUNT=$(printf '%s\n' "$_attach" \
            | awk -F'\t' '$NF ~ /^\/Volumes\//{m=$NF} END{print m}')
    if [ -z "$MOUNT" ]; then
        # The image may be attached even when its mount point cannot be read, and an
        # orphan left in /Volumes is what makes the next run pick the wrong volume.
        _dev=$(printf '%s\n' "$_attach" | awk '/^\/dev\//{d=$1} END{print d}')
        [ -z "$_dev" ] || hdiutil detach "$_dev" >/dev/null 2>&1 || true
        print_error "Failed to mount $GUI_ASSET"
        return 1
    fi
    APP=$(find "$MOUNT" -maxdepth 1 -name '*.app' | head -n 1 || true)
    if [ -z "$APP" ]; then
        print_error "No .app found in $GUI_ASSET"
        hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
        return 1
    fi
    APP_NAME=$(basename "$APP")
    print_info "Installing $APP_NAME to /Applications..."
    # Guard the copy explicitly: in `--both` mode set -e is suppressed (the call
    # is left of `||`), so an unguarded failure would fall through to a false
    # "installed" message. Always detach the image on the way out.
    _copy_failed=0
    if [ -w /Applications ]; then
        rm -rf "/Applications/$APP_NAME"
        cp -R "$APP" /Applications/ || _copy_failed=1
    else
        print_warning "Installing into /Applications requires sudo privileges"
        sudo rm -rf "/Applications/$APP_NAME"
        sudo cp -R "$APP" /Applications/ || _copy_failed=1
    fi
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
    if [ "$_copy_failed" = "1" ]; then
        print_error "Failed to copy $APP_NAME to /Applications"
        return 1
    fi
    # The app is unsigned; clearing quarantine lets it open without a Gatekeeper
    # prompt (a curl download carries none, so this is just belt-and-suspenders).
    xattr -dr com.apple.quarantine "/Applications/$APP_NAME" 2>/dev/null || true
    print_success "$APP_NAME installed. Launch it from Applications or Launchpad."
}

# Removes an AppImage install this script left behind. A native package brings its
# own binary and menu entry under different names, so an earlier AppImage survives as
# a second, older launcher — and $INSTALL_DIR precedes /usr/bin on the default PATH,
# so `omnyssh` on the command line keeps running it.
drop_appimage_install() {
    sudo rm -f "$INSTALL_DIR/omnyssh" 2>/dev/null || true
    rm -f "$HOME/.local/share/applications/omnyssh.desktop" 2>/dev/null || true
    rm -f "$HOME/.local/share/icons/omnyssh.png" 2>/dev/null || true
}

install_gui_linux() {
    # Prefer a native package where one exists — it integrates into the app menu,
    # needs no FUSE, and links the distro's own WebKit instead of the runtime the
    # AppImage ships (which black-screens on some Wayland setups). Fall back to
    # the portable AppImage everywhere else.
    _rpm_host=0
    if command -v rpm >/dev/null 2>&1 && command -v dnf >/dev/null 2>&1; then
        _rpm_host=1
        if download_release_asset "OmnySSH-${ARCH}.rpm"; then
            print_info "Installing the .rpm package..."
            if sudo dnf install -y "$ASSET_PATH"; then
                drop_appimage_install
                print_success "OmnySSH installed. Launch it from your application menu."
                return 0
            fi
        fi
        # A release that predates the .rpm, or a dnf host that has no WebKitGTK 4.1 to
        # satisfy it (RHEL 9 and its rebuilds), must not end the install here. The
        # AppImage is portable, but it needs FUSE and a new enough glibc — hence the
        # hedge rather than a promise.
        print_warning "The .rpm could not be installed — trying the AppImage instead"
    fi

    # Never on an RPM host, even one that happens to have dpkg: unpacking a .deb onto
    # an RPM-managed filesystem is worse than the portable AppImage.
    if [ "$_rpm_host" = 0 ] && command -v dpkg >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
        if download_release_asset "OmnySSH-${ARCH}.deb"; then
            print_info "Installing the .deb package..."
            sudo dpkg -i "$ASSET_PATH" || sudo apt-get install -f -y || true
            # `apt-get install -f` resolves an unsatisfiable dependency by removing the
            # package dpkg just unpacked, and exits 0 having done it — so the exit status
            # is no answer. Neither is `dpkg -s`, which succeeds for a package left
            # half-configured, removed-but-not-purged, or still at its previous version.
            # Ask the file what it is, then ask dpkg whether exactly that is installed.
            _pkg=$(dpkg-deb -f "$ASSET_PATH" Package 2>/dev/null || true)
            _pkg_version=$(dpkg-deb -f "$ASSET_PATH" Version 2>/dev/null || true)
            _installed=$(dpkg-query -W -f='${db:Status-Status} ${Version}' \
                         "$_pkg" 2>/dev/null || true)
            if [ -n "$_pkg" ] && [ "$_installed" = "installed $_pkg_version" ]; then
                drop_appimage_install
                print_success "OmnySSH installed. Launch it from your application menu."
                return 0
            fi
        fi
        # Same hedge as the rpm branch above: a host too old for the package still
        # gets a shot at the portable AppImage rather than a failed install.
        print_warning "The .deb could not be installed — trying the AppImage instead"
    fi

    download_release_asset "$GUI_ASSET" || return 1
    APPIMAGE="$ASSET_PATH"
    TARGET_BIN="$INSTALL_DIR/omnyssh"
    print_info "Installing the AppImage to $TARGET_BIN..."
    # Guarded rather than left to `set -e`: the caller runs this inside an `if`, which
    # suspends errexit, and an AppImage that is not executable installs to silence.
    chmod +x "$APPIMAGE" || { print_error "Failed to make the AppImage executable"; return 1; }
    if [ -w "$INSTALL_DIR" ]; then
        mv "$APPIMAGE" "$TARGET_BIN" || { print_error "Failed to install AppImage to $TARGET_BIN"; return 1; }
    else
        sudo mv "$APPIMAGE" "$TARGET_BIN" || { print_error "Failed to install AppImage to $TARGET_BIN"; return 1; }
        sudo chmod +x "$TARGET_BIN"
    fi
    # Best-effort menu integration (no root needed).
    APPS_DIR="$HOME/.local/share/applications"
    ICON_DIR="$HOME/.local/share/icons"
    mkdir -p "$APPS_DIR" "$ICON_DIR"
    curl -fsSL "https://raw.githubusercontent.com/$REPO/$VERSION/crates/omnyssh-gui/icons/128x128.png" \
        -o "$ICON_DIR/omnyssh.png" 2>/dev/null || true
    cat > "$APPS_DIR/omnyssh.desktop" <<EOF
[Desktop Entry]
Name=OmnySSH
Comment=SSH dashboard, terminal, and SFTP file manager
Exec=$TARGET_BIN
Icon=omnyssh
Type=Application
Categories=Utility;Network;
Terminal=false
EOF
    print_success "OmnySSH installed to $TARGET_BIN and added to your app menu."
    print_info "AppImages need FUSE; if it won't start, install 'libfuse2' or run with --appimage-extract-and-run."
}

install_gui_windows() {
    download_release_asset "$GUI_ASSET" || return 1
    SETUP="$ASSET_PATH"
    print_info "Launching the installer..."
    if command -v cygpath >/dev/null 2>&1; then
        cmd //c start "" "$(cygpath -w "$SETUP")" || true
    else
        "$SETUP" || true
    fi
    print_info "Follow the installer prompts — OmnySSH will appear in the Start Menu."
}

usage() {
    cat <<EOF
OmnySSH installer

Usage: install.sh [--gui | --tui | --both]

  --gui    Install the desktop GUI app (default)
  --tui    Install the terminal app 'omny'
  --both   Install both

Environment: OMNYSSH_INSTALL=gui|tui|both has the same effect.
Piped runs (curl | sh) default to --gui; pick another with:
  curl -fsSL .../install.sh | sh -s -- --tui
EOF
}

# Decide what to install: CLI flag > OMNYSSH_INSTALL env > interactive prompt >
# 'gui' default (the flagship app; the TUI has its own cargo/brew/nix channels).
select_components() {
    COMPONENTS="${OMNYSSH_INSTALL:-}"
    while [ $# -gt 0 ]; do
        case "$1" in
            --tui) COMPONENTS="tui" ;;
            --gui) COMPONENTS="gui" ;;
            --both|--all) COMPONENTS="both" ;;
            -h|--help) usage; exit 0 ;;
            *) print_warning "Ignoring unknown option: $1" ;;
        esac
        shift
    done

    if [ -z "$COMPONENTS" ]; then
        if [ -t 0 ]; then
            printf "Install which component? [1] GUI (desktop)  [2] TUI (omny)  [3] Both  (default 1): "
            read -r _choice
            case "$_choice" in
                2) COMPONENTS="tui" ;;
                3) COMPONENTS="both" ;;
                *) COMPONENTS="gui" ;;
            esac
        else
            COMPONENTS="gui"
        fi
    fi
}

# Main installation flow
main() {
    select_components "$@"

    echo ""
    echo "╔═══════════════════════════════════════╗"
    echo "║                                       ║"
    echo "║   OmnySSH Installation Script         ║"
    echo "║   SSH Dashboard & Server Manager      ║"
    echo "║                                       ║"
    echo "╚═══════════════════════════════════════╝"
    echo ""

    detect_platform
    get_latest_release

    # One temp dir for every download; cleaned up on exit.
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT

    case "$COMPONENTS" in
        gui)
            # aarch64 Linux and Termux run the TUI but have no desktop build, and a
            # piped run defaults to the GUI — so the command the README prints would
            # otherwise install nothing at all there. A GUI that exists and fails
            # still fails: only the unsupported platform falls back.
            if ! install_gui; then
                [ "$GUI_UNAVAILABLE" = "1" ] || exit 1
                print_info "Installing the terminal app instead."
                COMPONENTS="tui"
                download_and_install
                install_man_page
                verify_installation
            fi
            ;;
        both)
            download_and_install
            install_man_page
            verify_installation
            install_gui || print_warning "GUI install skipped/failed; the TUI is installed."
            ;;
        *)
            download_and_install
            install_man_page
            verify_installation
            ;;
    esac

    echo ""
    print_success "Installation complete!"
    echo ""
    case "$PLATFORM" in
        apple-darwin)    CONFIG_DIR="~/Library/Application Support/omnyssh/" ;;
        pc-windows-msvc) CONFIG_DIR="%APPDATA%\\omnyssh\\" ;;
        *)               CONFIG_DIR="~/.config/omnyssh/" ;;
    esac

    print_info "Next steps:"
    if [ "$COMPONENTS" != "gui" ]; then
        print_info "  1. Run 'omny' to start the terminal app"
        print_info "  2. Configure your servers in $CONFIG_DIR"
        print_info "  3. Check 'man omny' for documentation (Linux/macOS)"
    fi
    if [ "$COMPONENTS" = "gui" ] || [ "$COMPONENTS" = "both" ]; then
        print_info "  • Launch the OmnySSH desktop app from your applications menu"
    fi
    print_info "  • Visit https://github.com/$REPO for more info"
    echo ""
}

main "$@"
