#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then
  echo "Error: this installer requires bash. Run: curl -fsSL https://code.gptunnel.ru/install.sh | bash" >&2
  exit 1
fi

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

BASE_URL="${TUNNELCODE_RELEASE_BASE_URL:-https://code.gptunnel.ru/releases}"
INSTALL_DIR="${TUNNELCODE_INSTALL_DIR:-$HOME/.tunnelcode/bin}"
BIN="tunnelcode"
VERSION="${TUNNELCODE_VERSION:-}"
BINARY=""
NO_PATH=0
OS=""
ARCH=""
LIBC=""
TMP_DIR=""

cleanup() {
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"
}
trap cleanup EXIT

info() { echo -e "${GREEN}[info]${RESET} $*"; }
warn() { echo -e "${YELLOW}[warn]${RESET} $*"; }
error() {
  echo -e "${RED}[error]${RESET} $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
TunnelCode installer

Options:
  --version <version>      Install a specific version.
  --binary <path>          Install a local binary instead of downloading.
  --no-modify-path         Do not modify shell startup files.
  --help                   Show this help.

Environment:
  TUNNELCODE_RELEASE_BASE_URL  Override release base URL.
  TUNNELCODE_INSTALL_DIR       Override install bin directory.
  TUNNELCODE_VERSION           Install a specific version.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      [ -n "$VERSION" ] || error "--version requires a value"
      shift 2
      ;;
    --binary)
      BINARY="${2:-}"
      [ -n "$BINARY" ] || error "--binary requires a path"
      shift 2
      ;;
    --no-modify-path)
      NO_PATH=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      error "Unknown option: $1"
      ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || error "$1 is required"
}

detect_platform() {
  local sys machine
  sys="$(uname -s | tr '[:upper:]' '[:lower:]')"
  machine="$(uname -m | tr '[:upper:]' '[:lower:]')"

  case "$sys" in
    linux) OS="linux" ;;
    darwin) OS="darwin" ;;
    mingw*|msys*|cygwin*) OS="windows" ;;
    *) error "Unsupported OS: $sys" ;;
  esac

  case "$machine" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) error "Unsupported architecture: $machine" ;;
  esac

  if [ "$OS" = "darwin" ] && [ "$ARCH" = "x64" ]; then
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
      ARCH="arm64"
    fi
  fi

  if [ "$OS" = "linux" ]; then
    if ldd --version 2>&1 | grep -qi musl || ls /lib/ld-musl-* >/dev/null 2>&1; then
      LIBC="musl"
    fi
  fi
}

has_avx2() {
  [ "$ARCH" = "x64" ] || return 0
  if [ "$OS" = "darwin" ]; then
    sysctl -n machdep.cpu.leaf7_features 2>/dev/null | grep -q AVX2
    return $?
  fi
  if [ "$OS" = "linux" ]; then
    grep -q '\bavx2\b' /proc/cpuinfo 2>/dev/null
    return $?
  fi
  return 0
}

detect_version() {
  [ -n "$VERSION" ] && return
  need curl
  VERSION="$(curl -fsSL "$BASE_URL/latest.txt" 2>/dev/null)" || error "Failed to fetch latest version from $BASE_URL/latest.txt"
}

archive_name() {
  local target="tunnelcode-${OS}-${ARCH}"
  if [ "$ARCH" = "x64" ] && ! has_avx2; then
    target="${target}-baseline"
  fi
  if [ "$OS" = "linux" ] && [ "$LIBC" = "musl" ]; then
    target="${target}-musl"
  fi
  if [ "$OS" = "linux" ]; then
    echo "${target}.tar.gz"
    return
  fi
  echo "${target}.zip"
}

install_binary() {
  mkdir -p "$INSTALL_DIR"
  if [ "$OS" = "windows" ]; then
    BIN="tunnelcode.exe"
  fi

  if [ -n "$BINARY" ]; then
    [ -f "$BINARY" ] || error "Binary not found: $BINARY"
    cp "$BINARY" "$INSTALL_DIR/$BIN"
    chmod +x "$INSTALL_DIR/$BIN" 2>/dev/null || true
    return
  fi

  local archive url ext
  archive="$(archive_name)"
  url="$BASE_URL/v$VERSION/$archive"
  ext="zip"
  [ "$OS" = "linux" ] && ext="tar.gz"

  need curl
  if [ "$ext" = "tar.gz" ]; then
    need tar
  else
    need unzip
  fi

  TMP_DIR="$(mktemp -d)"
  info "Downloading TunnelCode v$VERSION for $OS/$ARCH"
  info "URL: $url"
  curl -fsSL "$url" -o "$TMP_DIR/$archive" || error "Download failed: $url"

  if [ "$ext" = "tar.gz" ]; then
    tar -xzf "$TMP_DIR/$archive" -C "$INSTALL_DIR"
  else
    unzip -oq "$TMP_DIR/$archive" -d "$INSTALL_DIR"
  fi

  [ -f "$INSTALL_DIR/$BIN" ] || error "Archive did not contain $BIN"
  chmod +x "$INSTALL_DIR/$BIN" 2>/dev/null || true
}

path_line() {
  if [ "$(basename "${SHELL:-}")" = "fish" ]; then
    echo "fish_add_path $INSTALL_DIR"
    return
  fi
  echo "export PATH=\"$INSTALL_DIR:\$PATH\""
}

path_contains() {
  echo "$PATH" | tr ':' '\n' | grep -Fqx "$INSTALL_DIR"
}

setup_path() {
  [ "$NO_PATH" = "1" ] && return
  path_contains && return

  local shell_name line files file
  shell_name="$(basename "${SHELL:-bash}")"
  line="$(path_line)"

  case "$shell_name" in
    zsh) files="$HOME/.zshrc $HOME/.zshenv" ;;
    fish)
      mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/fish"
      files="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
      ;;
    bash) files="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile" ;;
    *) files="$HOME/.profile" ;;
  esac

  for file in $files; do
    mkdir -p "$(dirname "$file")"
    touch "$file"
    if grep -Fq "$INSTALL_DIR" "$file"; then
      return
    fi
    {
      echo ""
      echo "# tunnelcode"
      echo "$line"
    } >> "$file"
    info "Added $INSTALL_DIR to PATH in $file"
    return
  done

  warn "Could not update PATH automatically. Run: export PATH=\"$INSTALL_DIR:\$PATH\""
}

self_check() {
  if "$INSTALL_DIR/$BIN" --version >/dev/null 2>&1; then
    info "Installed to $INSTALL_DIR/$BIN"
    return
  fi
  warn "Installed to $INSTALL_DIR/$BIN, but the version check failed"
}

main() {
  echo -e "${BOLD}TunnelCode Installer${RESET}"
  echo ""
  detect_platform
  detect_version
  install_binary
  setup_path
  self_check
  echo ""
  info "TunnelCode v$VERSION installed successfully"
  echo -e "  Run: ${BOLD}tunnelcode${RESET}"
  if ! path_contains; then
    echo -e "  ${YELLOW}PATH not updated in this shell.${RESET}"
    echo -e "  Run now: ${BOLD}export PATH=\"$INSTALL_DIR:\$PATH\"${RESET}"
  fi
}

main "$@"
