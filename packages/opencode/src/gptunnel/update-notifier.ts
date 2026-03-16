import path from "path"
import os from "os"
import { $ } from "bun"
import { TUNNELCODE } from "./urls"

const CACHE_FILE = path.join(os.homedir(), TUNNELCODE.INSTALL_DIR, ".last-update-check")
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const FETCH_TIMEOUT_MS = 3000 // 3 seconds — don't slow down startup

const CURRENT_VERSION = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"

interface UpdateCache {
  timestamp: number
  latest: string
  upgraded?: boolean
}

export function notifyIfUpdateAvailable() {
  if (CURRENT_VERSION === "local") return
  doCheck().catch(() => {})
}

async function doCheck() {
  const cache = await readCache()

  if (cache) {
    const age = Date.now() - cache.timestamp

    if (age < CHECK_INTERVAL_MS) {
      // Already upgraded to this version — nothing to do
      if (cache.upgraded) return
      // Cached latest is newer — try auto-upgrade
      if (cache.latest && isNewer(cache.latest, CURRENT_VERSION)) {
        await autoUpgrade(cache.latest)
      }
      return
    }
  }

  const res = await fetch(TUNNELCODE.LATEST_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) return
  const latest = (await res.text()).trim()

  if (latest !== CURRENT_VERSION && isNewer(latest, CURRENT_VERSION)) {
    await writeCache({ timestamp: Date.now(), latest, upgraded: false })
    await autoUpgrade(latest)
  } else {
    await writeCache({ timestamp: Date.now(), latest, upgraded: true })
  }
}

async function autoUpgrade(latest: string) {
  const platform = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null
  if (!platform) {
    printNotice(latest)
    return
  }

  const arch = process.arch === "arm64" ? "arm64" : "x64"
  const ext = platform === "linux" ? "tar.gz" : "zip"
  const archive = `tunnelcode-${platform}-${arch}.${ext}`
  const url = `${TUNNELCODE.BASE_URL}/releases/v${latest}/${archive}`
  const installDir = path.join(os.homedir(), TUNNELCODE.INSTALL_DIR, "bin")

  try {
    process.stderr.write(`\n  Updating ${CURRENT_VERSION} → ${latest}...`)

    const tmpFile = path.join(os.tmpdir(), `tunnelcode-update.${ext}`)
    const dl = await fetch(url)
    if (!dl.ok) throw new Error(`HTTP ${dl.status}`)
    await Bun.write(tmpFile, dl)

    await $`mkdir -p ${installDir}`.quiet().nothrow()

    if (ext === "tar.gz") {
      const r = await $`tar -xzf ${tmpFile} -C ${installDir}`.quiet().nothrow()
      if (r.exitCode !== 0) throw new Error("extract failed")
    } else {
      const r = await $`unzip -oq ${tmpFile} -d ${installDir}`.quiet().nothrow()
      if (r.exitCode !== 0) throw new Error("extract failed")
    }

    await $`rm -f ${tmpFile}`.quiet().nothrow()
    await $`chmod +x ${path.join(installDir, "tunnelcode")}`.quiet().nothrow()

    await writeCache({ timestamp: Date.now(), latest, upgraded: true })
    process.stderr.write(` done. Restart to use the new version.\n\n`)
  } catch {
    printNotice(latest)
  }
}

function isNewer(latest: string, current: string): boolean {
  // Strip prerelease suffix (e.g. "0.0.0-dev-202603..." → "0.0.0")
  const parse = (v: string) => v.split("-")[0].split(".").map(Number)
  const l = parse(latest)
  const c = parse(current)
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true
    if ((l[i] || 0) < (c[i] || 0)) return false
  }
  return false
}

function printNotice(latest: string) {
  const msg = `  Update available: ${CURRENT_VERSION} → ${latest}  Run: tunnelcode upgrade`
  process.stderr.write("\n" + msg + "\n\n")
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    const text = await Bun.file(CACHE_FILE).text()
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function writeCache(cache: UpdateCache) {
  try {
    await Bun.write(CACHE_FILE, JSON.stringify(cache))
  } catch {}
}
