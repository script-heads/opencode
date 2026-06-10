// TunnelCode distribution URLs
// Used by installation/index.ts for upgrade and version checks

export const TUNNELCODE = {
  BASE_URL: "https://code.gptunnel.ru",
  INSTALL_URL: "https://code.gptunnel.ru/install.sh",
  /** Native Windows (PowerShell) installer: irm <url> | iex */
  INSTALL_PS1_URL: "https://code.gptunnel.ru/install.ps1",
  LATEST_URL: "https://code.gptunnel.ru/releases/latest.txt",
  /** Root install directory: ~/.tunnelcode (contains bin/tunnelcode inside) */
  INSTALL_DIR: ".tunnelcode",
} as const
