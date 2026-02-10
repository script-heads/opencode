import { afterEach, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Env } from "../../src/env"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

const cachePath = path.join(Global.Path.cache, "gptunnel-models.json")
const originalFetch = globalThis.fetch
const config = {
  enabled_providers: ["gptunnel"],
  provider: {
    gptunnel: {
      name: "GPTunnel",
      api: "https://gptunnel.ru/v1",
      env: ["GPTUNNEL_API_KEY"],
    },
  },
}

function cachedModel(id: string) {
  return {
    id,
    providerID: "gptunnel",
    api: {
      id,
      url: "https://gptunnel.ru/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    name: id,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0.1,
      output: 0.2,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: 128000,
      output: 8192,
    },
    status: "active" as const,
    options: {},
    headers: {},
    release_date: "",
    variants: {},
  }
}

afterEach(async () => {
  globalThis.fetch = originalFetch
  await fs.rm(cachePath, { force: true }).catch(() => {})
})

test("gptunnel loader maps models from API response", async () => {
  await using tmp = await tmpdir({ config })
  const fetchMock = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "gpt-5-mini",
              title: "GPT-5 Mini",
              max_capacity: 256000,
              max_output_tokens: 12000,
              cost_context: "0.25",
              cost_completion: "2.0",
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("GPTUNNEL_API_KEY", "test-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers.gptunnel).toBeDefined()
      const model = providers.gptunnel.models["gpt-5-mini"]
      expect(model).toBeDefined()
      expect(model.name).toBe("GPT-5 Mini")
      expect(model.api.url).toBe("https://gptunnel.ru/v1")
      expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
      expect(model.limit.context).toBe(256000)
      expect(model.limit.output).toBe(12000)
      expect(model.cost.input).toBe(0.25)
      expect(model.cost.output).toBe(2)
      expect(model.cost.cache.read).toBe(0)
      expect(model.cost.cache.write).toBe(0)
      expect(await Bun.file(cachePath).exists()).toBe(true)
    },
  })
})

test("gptunnel loader does not autoload without key", async () => {
  await using tmp = await tmpdir({ config })
  const fetchMock = mock(() => Promise.reject(new Error("should not be called")))
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers.gptunnel).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  })
})

test("gptunnel loader falls back to cache when network request fails", async () => {
  await using tmp = await tmpdir({ config })
  await Bun.write(
    cachePath,
    JSON.stringify(
      {
        updated_at: Date.now() - 2 * 60 * 60 * 1000,
        models: {
          "cached-model": cachedModel("cached-model"),
        },
      },
      null,
      2,
    ),
  )

  const fetchMock = mock(() => Promise.reject(new Error("network down")))
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("GPTUNNEL_API_KEY", "test-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers.gptunnel).toBeDefined()
      expect(providers.gptunnel.models["cached-model"]).toBeDefined()
      expect(fetchMock).toHaveBeenCalled()
    },
  })
})

test("gptunnel loader ignores expired cache without key", async () => {
  await using tmp = await tmpdir({ config })
  await Bun.write(
    cachePath,
    JSON.stringify(
      {
        updated_at: Date.now() - 2 * 60 * 60 * 1000,
        models: {
          stale: cachedModel("stale"),
        },
      },
      null,
      2,
    ),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers.gptunnel).toBeUndefined()
    },
  })
})

test("gptunnel loader returns no provider when cache is missing and API fails", async () => {
  await using tmp = await tmpdir({ config })
  const fetchMock = mock(() => Promise.reject(new Error("network down")))
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("GPTUNNEL_API_KEY", "test-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers.gptunnel).toBeUndefined()
      expect(fetchMock).toHaveBeenCalled()
    },
  })
})
