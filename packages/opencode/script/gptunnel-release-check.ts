#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"
import { readdir } from "node:fs/promises"

export const releaseArtifactNames = [
  "tunnelcode-linux-arm64.tar.gz",
  "tunnelcode-linux-x64.tar.gz",
  "tunnelcode-linux-x64-baseline.tar.gz",
  "tunnelcode-linux-arm64-musl.tar.gz",
  "tunnelcode-linux-x64-musl.tar.gz",
  "tunnelcode-linux-x64-baseline-musl.tar.gz",
  "tunnelcode-darwin-arm64.zip",
  "tunnelcode-darwin-x64.zip",
  "tunnelcode-darwin-x64-baseline.zip",
  "tunnelcode-windows-arm64.zip",
  "tunnelcode-windows-x64.zip",
  "tunnelcode-windows-x64-baseline.zip",
] as const

export function missingReleaseArtifacts(names: string[]) {
  const set = new Set(names)
  return releaseArtifactNames.filter((name) => !set.has(name))
}

export function releaseArtifactBinaryName(name: string) {
  if (name.includes("-windows-")) return "tunnelcode.exe"
  return "tunnelcode"
}

export async function checkReleaseArtifactContents(dir: string) {
  return (
    await Promise.all(
      (await releaseArtifacts(dir)).map(async (name) => {
        const names = (await archiveEntries(path.join(dir, name)))
          .map((entry) => path.basename(entry.replace(/\/$/, "")))
          .filter(Boolean)
        const bin = releaseArtifactBinaryName(name)
        return [
          ...(names.includes(bin) ? [] : [`${name} does not contain ${bin}`]),
          ...names
            .filter((entry) => entry === "opencode" || entry === "opencode.exe")
            .map((entry) => `${name} contains upstream binary ${entry}`),
        ]
      }),
    )
  ).flat()
}

export async function checkOpenTuiNativeVersions(dir = path.join(process.cwd(), "node_modules")) {
  const list = roots(dir)
  const core = (
    await Promise.all(
      list.map(async (root) => ({
        pkg: await json(path.join(root, "core/package.json")),
      })),
    )
  ).find((item) => item.pkg)?.pkg
  if (!core) return ["@opentui/core is not installed"]

  const pkgs = new Map<string, string>()
  for (const root of list) {
    for (const name of await readdir(root).catch(() => [])) {
      if (name.startsWith("core-") && !pkgs.has(name)) pkgs.set(name, path.join(root, name, "package.json"))
    }
  }
  const native = [...pkgs.keys()].sort()
  if (native.length === 0) return ["no @opentui/core native packages are installed"]

  return (
    await Promise.all(
      native.map(async (name) => {
        const pkg = await json(pkgs.get(name)!)
        if (!pkg) return [`@opentui/${name} package.json is missing`]
        if (pkg.version !== core.version) {
          return [`@opentui/${name} version ${pkg.version} does not match @opentui/core ${core.version}`]
        }
        return []
      }),
    )
  ).flat()
}

function roots(dir: string) {
  const seen = new Set<string>()
  const list: string[] = []
  let root = path.resolve(dir)

  for (let i = 0; i < 6; i++) {
    for (const item of [
      path.join(root, "@opentui"),
      path.join(root, ".bun/node_modules/@opentui"),
      path.join(root, "node_modules/@opentui"),
      path.join(root, "node_modules/.bun/node_modules/@opentui"),
    ]) {
      if (seen.has(item)) continue
      seen.add(item)
      list.push(item)
    }
    const parent = path.dirname(root)
    if (parent === root) return list
    root = parent
  }

  return list
}

async function releaseArtifacts(dir: string) {
  return (await readdir(dir))
    .filter((name) => name.endsWith(".zip") || name.endsWith(".tar.gz"))
    .sort()
}

async function archiveEntries(file: string) {
  const out = file.endsWith(".tar.gz") ? await $`tar -tzf ${file}`.quiet().text() : await $`unzip -Z1 ${file}`.quiet().text()
  return out.split(/\r?\n/).filter(Boolean)
}

async function json(file: string) {
  return Bun.file(file)
    .json()
    .catch(() => undefined)
}

function arg(name: string) {
  const i = Bun.argv.indexOf(name)
  if (i === -1) return
  return Bun.argv[i + 1]
}

if (import.meta.main) {
  const dir = arg("--release-dir")
  const partial = Bun.argv.includes("--allow-partial")
  const errors = [
    ...(Bun.argv.includes("--skip-opentui-native-check") ? [] : await checkOpenTuiNativeVersions(arg("--node-modules"))),
    ...(dir
      ? [
          ...(partial
            ? []
            : missingReleaseArtifacts(await releaseArtifacts(dir)).map((name) => `release artifact missing: ${name}`)),
          ...(await checkReleaseArtifactContents(dir)),
        ]
      : []),
  ]

  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exit(1)
  }
  console.log("gptunnel release checks passed")
}
