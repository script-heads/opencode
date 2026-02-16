// TunnelCode distribution URLs
// Used by installation/index.ts for upgrade and version checks

export const TUNNELCODE = {
  BASE_URL: "https://code.gptunnel.ru",
  INSTALL_URL: "https://code.gptunnel.ru/install.sh",
  LATEST_URL: "https://code.gptunnel.ru/releases/latest.txt",
  /** Root install directory: ~/.tunnelcode (contains bin/tunnelcode inside) */
  INSTALL_DIR: ".tunnelcode",
} as const
