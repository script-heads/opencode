import { afterEach, expect, mock } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Provider } from "../../src/provider/provider"
import { testEffect } from "../lib/effect"

const cache = path.join(Global.Path.cache, "gptunnel-models.json")
const original = globalThis.fetch
const id = ProviderV2.ID.make("gptunnel")

const base = {
  enabled_providers: ["gptunnel"],
  provider: {
    gptunnel: {
      name: "GPTunnel",
      api: "https://gptunnel.ru/v1",
      npm: "@ai-sdk/openai-compatible",
      env: ["GPTUNNEL_API_KEY"],
    },
  },
}

const keyed = {
  ...base,
  provider: {
    gptunnel: {
      ...base.provider.gptunnel,
      options: {
        apiKey: "test-key",
      },
    },
  },
}

function cached(model: string) {
  return {
    id: model,
    providerID: "gptunnel",
    api: {
      id: model,
      url: "https://gptunnel.ru/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    name: model,
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
    status: "active",
    options: {},
    headers: {},
    release_date: "",
    variants: {},
  }
}

afterEach(async () => {
  globalThis.fetch = original
  await fs.rm(cache, { force: true }).catch(() => {})
})

const withEnv = <A, E, R>(values: Record<string, string>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]] as const))
      Object.assign(process.env, values)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )

const it = testEffect(Provider.defaultLayer)

it.instance(
  "gptunnel loader maps models from API response",
  () =>
    Effect.gen(function* () {
      const fetch = mock(() =>
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
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch

      const providers = yield* Provider.use.list()
      expect(providers[id]).toBeDefined()
      const model = providers[id].models["gpt-5-mini"]
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
      expect(fetch).toHaveBeenCalled()
      expect(yield* Effect.promise(() => Bun.file(cache).exists())).toBe(true)
    }),
  { config: keyed },
)

// Regression: when the key comes from env or auth.json, the providers entry is
// created (with empty models) BEFORE the custom loader runs, so the loader's
// models must be carried over by the `models: data.models` patch in provider.ts.
// That line was lost once in an upstream merge — these two tests pin it down.
it.instance(
  "gptunnel models survive when providers entry pre-exists via GPTUNNEL_API_KEY env",
  () =>
    withEnv(
      { GPTUNNEL_API_KEY: "env-key" },
      Effect.gen(function* () {
        const fetch = mock(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [{ id: "gpt-5-mini", title: "GPT-5 Mini" }] }), { status: 200 }),
          ),
        )
        globalThis.fetch = fetch as unknown as typeof globalThis.fetch

        const providers = yield* Provider.use.list()
        expect(providers[id]).toBeDefined()
        expect(providers[id].models["gpt-5-mini"]).toBeDefined()
        expect(fetch).toHaveBeenCalled()
      }),
    ),
  { config: base },
)

it.instance(
  "gptunnel models survive when providers entry pre-exists via stored api key",
  () =>
    withEnv(
      { OPENCODE_AUTH_CONTENT: JSON.stringify({ gptunnel: { type: "api", key: "auth-key" } }) },
      Effect.gen(function* () {
        const fetch = mock(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [{ id: "gpt-5-mini", title: "GPT-5 Mini" }] }), { status: 200 }),
          ),
        )
        globalThis.fetch = fetch as unknown as typeof globalThis.fetch

        const providers = yield* Provider.use.list()
        expect(providers[id]).toBeDefined()
        expect(providers[id].models["gpt-5-mini"]).toBeDefined()
        expect(fetch).toHaveBeenCalled()
      }),
    ),
  { config: base },
)

it.instance(
  "gptunnel loader does not autoload without key",
  () =>
    Effect.gen(function* () {
      const fetch = mock(() => Promise.reject(new Error("should not be called")))
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch

      const providers = yield* Provider.use.list()
      expect(providers[id]).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    }),
  { config: base },
)

it.instance(
  "gptunnel loader falls back to cache when network request fails",
  () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        Bun.write(
          cache,
          JSON.stringify(
            {
              updated_at: Date.now() - 2 * 60 * 60 * 1000,
              models: {
                "cached-model": cached("cached-model"),
              },
            },
            null,
            2,
          ),
        ),
      )
      const fetch = mock(() => Promise.reject(new Error("network down")))
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch

      const providers = yield* Provider.use.list()
      expect(providers[id]).toBeDefined()
      expect(providers[id].models["cached-model"]).toBeDefined()
      expect(fetch).toHaveBeenCalled()
    }),
  { config: keyed },
)

it.instance(
  "gptunnel loader ignores expired cache without key",
  () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        Bun.write(
          cache,
          JSON.stringify(
            {
              updated_at: Date.now() - 2 * 60 * 60 * 1000,
              models: {
                stale: cached("stale"),
              },
            },
            null,
            2,
          ),
        ),
      )

      const providers = yield* Provider.use.list()
      expect(providers[id]).toBeUndefined()
    }),
  { config: base },
)

it.instance(
  "gptunnel loader returns no provider when cache is missing and API fails",
  () =>
    Effect.gen(function* () {
      const fetch = mock(() => Promise.reject(new Error("network down")))
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch

      const providers = yield* Provider.use.list()
      expect(providers[id]).toBeUndefined()
      expect(fetch).toHaveBeenCalled()
    }),
  { config: keyed },
)
