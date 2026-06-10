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
  // On Windows a previous auto-update renames the in-use binary to tunnelcode.old.exe.
  // It's no longer locked after the restart, so clear it best-effort on launch.
  if (process.platform === "win32") {
    const stale = path.join(os.homedir(), TUNNELCODE.INSTALL_DIR, "bin", "tunnelcode.old.exe")
    $`cmd /c del /f /q ${stale}`.quiet().nothrow()
  }
  doCheck().catch(() => {})
}

export type Target = {
  platform?: NodeJS.Platform
  arch?: "arm64" | "x64"
  avx2?: boolean
  libc?: "glibc" | "musl"
}

export function archiveForTarget(target: Target = {}) {
  const platform = target.platform ?? process.platform
  const os = platform === "win32" ? "windows" : platform
  const arch = target.arch ?? (process.arch === "arm64" ? "arm64" : "x64")
  const base = ["tunnelcode", os, arch, arch === "x64" && target.avx2 === false ? "baseline" : undefined, platform === "linux" ? target.libc : undefined]
    .filter(Boolean)
    .join("-")
  return `${base}.${platform === "linux" ? "tar.gz" : "zip"}`
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
  const platform =
    process.platform === "darwin" || process.platform === "linux" || process.platform === "win32"
      ? process.platform
      : null
  if (!platform) {
    printNotice(latest)
    return
  }

  const archive = archiveForTarget(await target())
  const ext = archive.endsWith(".tar.gz") ? "tar.gz" : "zip"
  const url = `${TUNNELCODE.BASE_URL}/releases/v${latest}/${archive}`
  const installDir = path.join(os.homedir(), TUNNELCODE.INSTALL_DIR, "bin")
  const bin = platform === "win32" ? "tunnelcode.exe" : "tunnelcode"

  try {
    process.stderr.write(`\n  Updating ${CURRENT_VERSION} → ${latest}...`)

    const tmpFile = path.join(os.tmpdir(), `tunnelcode-update.${ext}`)
    const dl = await fetch(url)
    if (!dl.ok) throw new Error(`HTTP ${dl.status}`)
    await Bun.write(tmpFile, dl)

    await $`mkdir -p ${installDir}`.quiet().nothrow()

    if (platform === "win32") {
      // Windows ships no `unzip`; extract with the built-in Expand-Archive.
      // It also can't overwrite a running .exe, so extract to a temp dir and
      // swap: move the in-use binary aside, then drop the fresh one in place.
      const extractDir = path.join(os.tmpdir(), `tunnelcode-update-${latest}`)
      await $`cmd /c rmdir /s /q ${extractDir}`.quiet().nothrow()
      const r =
        await $`powershell -NoProfile -NonInteractive -Command ${`Expand-Archive -LiteralPath '${tmpFile}' -DestinationPath '${extractDir}' -Force`}`
          .quiet()
          .nothrow()
      if (r.exitCode !== 0) throw new Error("extract failed")

      const cur = path.join(installDir, bin)
      const stale = path.join(installDir, "tunnelcode.old.exe")
      const fresh = path.join(extractDir, bin)
      await $`cmd /c del /f /q ${stale}`.quiet().nothrow()
      await $`cmd /c move /y ${cur} ${stale}`.quiet().nothrow()
      const mv = await $`cmd /c move /y ${fresh} ${cur}`.quiet().nothrow()
      if (mv.exitCode !== 0) {
        // Swap failed — restore the original binary so the install isn't left broken.
        await $`cmd /c move /y ${stale} ${cur}`.quiet().nothrow()
        throw new Error("swap failed")
      }
      await $`cmd /c rmdir /s /q ${extractDir}`.quiet().nothrow()
    } else if (ext === "tar.gz") {
      const r = await $`tar -xzf ${tmpFile} -C ${installDir}`.quiet().nothrow()
      if (r.exitCode !== 0) throw new Error("extract failed")
    } else {
      const r = await $`unzip -oq ${tmpFile} -d ${installDir}`.quiet().nothrow()
      if (r.exitCode !== 0) throw new Error("extract failed")
    }

    await $`rm -f ${tmpFile}`.quiet().nothrow()
    if (platform !== "win32") await $`chmod +x ${path.join(installDir, bin)}`.quiet().nothrow()

    await writeCache({ timestamp: Date.now(), latest, upgraded: true })
    process.stderr.write(` done. Restart to use the new version.\n\n`)
  } catch {
    printNotice(latest)
  }
}

async function target(): Promise<Target> {
  return {
    platform: process.platform,
    arch: process.arch === "arm64" ? "arm64" : "x64",
    avx2: await hasAvx2(),
    libc: await libc(),
  }
}

async function hasAvx2() {
  if (process.arch !== "x64") return true
  if (process.platform === "darwin") {
    const out = await $`sysctl -n machdep.cpu.leaf7_features`.quiet().text().catch(() => "")
    return /\bAVX2\b/.test(out)
  }
  if (process.platform === "linux") {
    const out = await Bun.file("/proc/cpuinfo").text().catch(() => "")
    return /\bavx2\b/.test(out)
  }
  return true
}

async function libc() {
  if (process.platform !== "linux") return undefined
  const report = (process as unknown as { report?: { getReport?: () => { header?: { glibcVersionRuntime?: string } } } }).report
  if (report?.getReport?.().header?.glibcVersionRuntime) return "glibc"
  const out = await $`ldd --version`.quiet().text().catch(() => "")
  if (out.toLowerCase().includes("musl")) return "musl"
  return "glibc"
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
