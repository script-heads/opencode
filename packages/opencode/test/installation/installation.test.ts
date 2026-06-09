import { afterEach, describe, expect, test } from "bun:test"
import { Installation } from "../../src/installation"

const fetch0 = globalThis.fetch

afterEach(() => {
  globalThis.fetch = fetch0
})

describe("installation", () => {
  test("reads TunnelCode release version from latest.txt", async () => {
    globalThis.fetch = (async () => new Response("1.2.3\n", { status: 200 })) as unknown as typeof fetch

    expect(await Installation.latest("unknown")).toBe("1.2.3")
  })

  test("uses TunnelCode latest.txt even when a package manager method is detected", async () => {
    const urls: string[] = []
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input))
      return new Response("2.3.4\n", { status: 200 })
    }) as unknown as typeof fetch

    expect(await Installation.latest("scoop")).toBe("2.3.4")
    expect(urls).toEqual(["https://code.gptunnel.ru/releases/latest.txt"])
  })

  test("blocks package manager upgrades because TunnelCode is distributed by the curl installer", async () => {
    const err = await Installation.upgrade("npm", "9.9.9").catch((err) => err)

    expect(err).toBeInstanceOf(Installation.UpgradeFailedError)
    expect(err.data.stderr).toContain("curl installer")
  })
})
