import { test, expect } from "bun:test"
import { archiveForTarget } from "../../src/gptunnel/update-notifier"

test("archiveForTarget selects Linux baseline and musl artifacts", () => {
  expect(archiveForTarget({ platform: "linux", arch: "x64", avx2: false })).toBe(
    "tunnelcode-linux-x64-baseline.tar.gz",
  )
  expect(archiveForTarget({ platform: "linux", arch: "x64", libc: "musl" })).toBe("tunnelcode-linux-x64-musl.tar.gz")
  expect(archiveForTarget({ platform: "linux", arch: "x64", avx2: false, libc: "musl" })).toBe(
    "tunnelcode-linux-x64-baseline-musl.tar.gz",
  )
})

test("archiveForTarget includes Windows executable archives", () => {
  expect(archiveForTarget({ platform: "win32", arch: "x64" })).toBe("tunnelcode-windows-x64.zip")
  expect(archiveForTarget({ platform: "win32", arch: "arm64" })).toBe("tunnelcode-windows-arm64.zip")
})

