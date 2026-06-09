import { test, expect } from "bun:test"
import { $ } from "bun"
import { mkdir, mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

async function release() {
  const mod = await import("../../script/gptunnel-release-check").catch(() => undefined)
  expect(mod).toBeDefined()
  return mod!
}

test("releaseArtifactNames keeps every installer-selectable target explicit", async () => {
  const mod = await release()

  expect(mod.releaseArtifactNames).toEqual([
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
  ])
})

test("missingReleaseArtifacts reports installer targets absent from release output", async () => {
  const mod = await release()

  expect(
    mod.missingReleaseArtifacts([
      "tunnelcode-linux-x64.tar.gz",
      "tunnelcode-darwin-arm64.zip",
      "tunnelcode-windows-x64.zip",
    ]),
  ).toContain("tunnelcode-linux-x64-baseline.tar.gz")
})

test("releaseArtifactBinaryName follows platform executable names", async () => {
  const mod = await release()

  expect(mod.releaseArtifactBinaryName("tunnelcode-linux-x64.tar.gz")).toBe("tunnelcode")
  expect(mod.releaseArtifactBinaryName("tunnelcode-darwin-arm64.zip")).toBe("tunnelcode")
  expect(mod.releaseArtifactBinaryName("tunnelcode-windows-x64.zip")).toBe("tunnelcode.exe")
})

test("checkReleaseArtifactContents rejects upstream binary names inside archives", async () => {
  const mod = await release()
  const dir = await mkdtemp(path.join(os.tmpdir(), "tunnelcode-artifacts-"))
  const linux = path.join(dir, "linux")
  const windows = path.join(dir, "windows")

  await mkdir(linux)
  await mkdir(windows)
  await Bun.write(path.join(linux, "opencode"), "")
  await Bun.write(path.join(windows, "tunnelcode.exe"), "")

  await $`tar -czf ${path.join(dir, "tunnelcode-linux-x64.tar.gz")} -C ${linux} opencode`
  await $`zip -q ${path.join(dir, "tunnelcode-windows-x64.zip")} tunnelcode.exe`.cwd(windows)

  expect(await mod.checkReleaseArtifactContents(dir)).toEqual([
    "tunnelcode-linux-x64.tar.gz does not contain tunnelcode",
    "tunnelcode-linux-x64.tar.gz contains upstream binary opencode",
  ])
})

test("checkOpenTuiNativeVersions reports mismatched native package versions", async () => {
  const mod = await release()
  const root = await mkdtemp(path.join(os.tmpdir(), "tunnelcode-node-modules-"))
  const core = path.join(root, "@opentui/core")
  const native = path.join(root, "@opentui/core-linux-x64")

  await mkdir(core, { recursive: true })
  await mkdir(native, { recursive: true })
  await Bun.write(path.join(core, "package.json"), JSON.stringify({ name: "@opentui/core", version: "1.0.0" }))
  await Bun.write(path.join(native, "package.json"), JSON.stringify({ name: "@opentui/core-linux-x64", version: "1.0.1" }))

  expect(await mod.checkOpenTuiNativeVersions(root)).toEqual([
    "@opentui/core-linux-x64 version 1.0.1 does not match @opentui/core 1.0.0",
  ])
})

test("checkOpenTuiNativeVersions handles Bun isolated native package links", async () => {
  const mod = await release()
  const root = await mkdtemp(path.join(os.tmpdir(), "tunnelcode-bun-layout-"))
  const pkg = path.join(root, "packages/opencode/node_modules/@opentui/core")
  const native = path.join(root, "node_modules/.bun/node_modules/@opentui/core-linux-x64")

  await mkdir(pkg, { recursive: true })
  await mkdir(native, { recursive: true })
  await Bun.write(path.join(pkg, "package.json"), JSON.stringify({ name: "@opentui/core", version: "1.0.0" }))
  await Bun.write(path.join(native, "package.json"), JSON.stringify({ name: "@opentui/core-linux-x64", version: "1.0.0" }))

  expect(await mod.checkOpenTuiNativeVersions(path.join(root, "packages/opencode/node_modules"))).toEqual([])
})

test("release script prepares native dependencies before building release artifacts", async () => {
  const text = await Bun.file("src/gptunnel/release.sh").text()

  expect(text).not.toContain("--skip-install")
  expect(text).toContain("gptunnel-release-check.ts")
  expect(text).toContain("--allow-partial")
})

test("build script installs native release packages without hooks or lockfile churn", async () => {
  const text = await Bun.file("script/build.ts").text()

  expect(text).toContain("--ignore-scripts")
  expect(text).toContain("--no-save")
  expect(text).toContain("--production")
  expect(text).toContain("@opentui/core")
  expect(text).toContain("@parcel/watcher")
})

test("installer keeps upstream-style controls and the TunnelCode target matrix", async () => {
  const text = await Bun.file("src/gptunnel/install.sh").text()

  expect(text).toContain("--version")
  expect(text).toContain("--binary")
  expect(text).toContain("--no-modify-path")
  expect(text).toContain("TUNNELCODE_RELEASE_BASE_URL")
  expect(text).toContain('target="${target}-baseline"')
  expect(text).toContain('target="${target}-musl"')
  expect(text).toContain('OS="windows"')
  expect(text).not.toContain("opencode.ai")
  expect(text).not.toContain("~/.opencode/bin")
})
