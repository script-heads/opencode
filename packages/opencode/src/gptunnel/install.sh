#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

BASE_URL="https://code.gptunnel.ru/releases"
BIN_NAME="tunnelcode"
INSTALL_DIR="$HOME/.tunnelcode/bin"

info()  { echo -e "${GREEN}[info]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET} $*"; }
error() { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }

detect_platform() {
  local os arch
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)

  case "$os" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)      error "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             error "Unsupported architecture: $arch" ;;
  esac
}

detect_version() {
  if [ -n "${TUNNELCODE_VERSION:-}" ]; then
    VERSION="$TUNNELCODE_VERSION"
  else
    VERSION=$(curl -fsSL "$BASE_URL/latest.txt" 2>/dev/null) \
      || error "Failed to fetch latest version from $BASE_URL/latest.txt"
  fi
}

download_and_install() {
  local ext="zip"
  [ "$OS" = "linux" ] && ext="tar.gz"

  local archive="tunnelcode-${OS}-${ARCH}.${ext}"
  local url="${BASE_URL}/v${VERSION}/${archive}"

  info "Downloading TunnelCode v${VERSION} for ${OS}/${ARCH}..."
  info "URL: $url"

  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  curl -fsSL "$url" -o "$tmp/$archive" \
    || error "Download failed. Check that version $VERSION exists for your platform."

  mkdir -p "$INSTALL_DIR"

  info "Extracting..."
  if [ "$ext" = "tar.gz" ]; then
    tar -xzf "$tmp/$archive" -C "$INSTALL_DIR"
  else
    unzip -oq "$tmp/$archive" -d "$INSTALL_DIR"
  fi

  chmod +x "$INSTALL_DIR/$BIN_NAME"
  info "Installed to $INSTALL_DIR/$BIN_NAME"
}

setup_path() {
  if echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    return
  fi

  local shell_name
  shell_name=$(basename "${SHELL:-bash}")
  local rc_file

  case "$shell_name" in
    zsh)  rc_file="$HOME/.zshrc" ;;
    fish) rc_file="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish" ;;
    *)    rc_file="$HOME/.bashrc" ;;
  esac

  if [ -f "$rc_file" ] && grep -q ".tunnelcode/bin" "$rc_file"; then
    return
  fi

  info "Adding $INSTALL_DIR to PATH in $rc_file"
  if [ "$shell_name" = "fish" ]; then
    echo "" >> "$rc_file"
    echo "# tunnelcode" >> "$rc_file"
    echo "fish_add_path $INSTALL_DIR" >> "$rc_file"
  else
    echo "" >> "$rc_file"
    echo "# tunnelcode" >> "$rc_file"
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$rc_file"
  fi

  warn "Restart your shell or run:  source $rc_file"
}

main() {
  echo -e "${BOLD}TunnelCode Installer${RESET}"
  echo ""

  detect_platform
  detect_version
  download_and_install
  setup_path

  echo ""
  info "TunnelCode v${VERSION} installed successfully!"
  echo ""
  echo -e "  Run: ${BOLD}tunnelcode${RESET}"
  echo ""
}

main "$@"
