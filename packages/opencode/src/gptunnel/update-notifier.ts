import path from "path"
import os from "os"
import { TUNNELCODE } from "./urls"

const CACHE_FILE = path.join(os.homedir(), TUNNELCODE.INSTALL_DIR, ".last-update-check")
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const FETCH_TIMEOUT_MS = 3000 // 3 seconds — don't slow down startup

const CURRENT_VERSION = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"

interface UpdateCache {
  timestamp: number
  latest: string
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
      if (cache.latest !== CURRENT_VERSION && isNewer(cache.latest, CURRENT_VERSION)) {
        printNotice(cache.latest)
      }
      return
    }
  }

  const res = await fetch(TUNNELCODE.LATEST_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) return
  const latest = (await res.text()).trim()

  await writeCache({ timestamp: Date.now(), latest })

  if (latest !== CURRENT_VERSION && isNewer(latest, CURRENT_VERSION)) {
    printNotice(latest)
  }
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number)
  const c = current.split(".").map(Number)
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false
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
