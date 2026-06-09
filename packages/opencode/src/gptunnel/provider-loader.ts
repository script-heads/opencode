import z from "zod"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Auth } from "../auth"
import type { Info, Model } from "../provider/provider"

const GPTUNNEL_API_URL = "https://gptunnel.ru/v1"
const gptunnelCache = path.join(Global.Path.cache, "gptunnel-models.json")
const gptunnelTTL = 60 * 60 * 1000

const GptunnelModel = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    release_date: z.string().optional(),
    updated_at: z.string().optional(),
    created: z.union([z.string(), z.number()]).optional(),
    max_capacity: z.union([z.string(), z.number()]).optional(),
    max_context: z.union([z.string(), z.number()]).optional(),
    max_output: z.union([z.string(), z.number()]).optional(),
    max_output_tokens: z.union([z.string(), z.number()]).optional(),
    cost_context: z.union([z.string(), z.number()]).optional(),
    cost_completion: z.union([z.string(), z.number()]).optional(),
    cache_read: z.union([z.string(), z.number()]).optional(),
    cache_write: z.union([z.string(), z.number()]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    options: z.record(z.string(), z.any()).optional(),
  })
  .passthrough()
type GptunnelModel = z.infer<typeof GptunnelModel>

const GptunnelResponse = z.union([
  z.object({ data: z.array(GptunnelModel) }).passthrough(),
  z.array(GptunnelModel),
])

const GptunnelCache = z.object({
  updated_at: z.number(),
  models: z.record(z.string(), z.custom<Model>()),
})

type Dep = {
  auth: (id: string) => Effect.Effect<Auth.Info | undefined>
  config: () => Effect.Effect<ConfigV1.Info>
  env: () => Effect.Effect<Record<string, string | undefined>>
}

function numberFrom(input: unknown, fallback = 0) {
  if (typeof input === "number") return Number.isFinite(input) ? input : fallback
  if (typeof input === "string") {
    const cleaned = input.replaceAll(",", ".")
    const value = Number.parseFloat(cleaned)
    if (Number.isFinite(value)) return value
  }
  return fallback
}

function stringFrom(input: unknown, fallback = "") {
  if (typeof input === "string") return input
  return fallback
}

function modelStatus(input: unknown): Model["status"] {
  const value = stringFrom(input).toLowerCase()
  if (value === "alpha" || value === "beta" || value === "deprecated" || value === "active") return value
  if (value === "stable") return "active"
  return "active"
}

function inferReasoning(id: string) {
  return /reason|think|r1|o1|o3|o4|deepseek-r1/i.test(id)
}

function inferVision(id: string) {
  return /vision|vl|omni|image|gemini|gpt-4o|gpt-5/i.test(id)
}

function inferReleaseDate(model: GptunnelModel) {
  if (model.release_date) return model.release_date
  if (model.updated_at) return model.updated_at
  const created = model.created
  if (typeof created === "string") return created
  if (typeof created === "number") {
    const stamp = created > 1_000_000_000_000 ? created : created * 1000
    return new Date(stamp).toISOString()
  }
  return ""
}

function fromGptunnelModel(model: GptunnelModel): Model {
  const context = numberFrom(model.max_capacity ?? model.max_context, 128000)
  const output = numberFrom(model.max_output ?? model.max_output_tokens, 16384)
  const reasoning = inferReasoning(model.id)
  const vision = inferVision(model.id)
  return {
    id: ModelV2.ID.make(model.id),
    providerID: ProviderV2.ID.make("gptunnel"),
    api: {
      id: model.id,
      url: GPTUNNEL_API_URL,
      npm: "@ai-sdk/openai-compatible",
    },
    name: model.title ?? model.name ?? model.id,
    capabilities: {
      temperature: true,
      reasoning,
      attachment: vision,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: vision,
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
      input: numberFrom(model.cost_context),
      output: numberFrom(model.cost_completion),
      cache: {
        read: numberFrom(model.cache_read),
        write: numberFrom(model.cache_write),
      },
    },
    limit: {
      context,
      output,
    },
    status: modelStatus(model.status),
    headers: model.headers ?? {},
    options: model.options ?? {},
    release_date: inferReleaseDate(model),
    variants: {},
  }
}

function fromGptunnelResponse(data: unknown) {
  const parsed = GptunnelResponse.safeParse(data)
  if (!parsed.success) return {}
  const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data.data
  return rows.reduce(
    (acc, item) => {
      acc[item.id] = fromGptunnelModel(item)
      return acc
    },
    {} as Record<string, Model>,
  )
}

async function readGptunnelCache() {
  return Bun.file(gptunnelCache)
    .json()
    .then((data) => {
      const parsed = GptunnelCache.safeParse(data)
      if (!parsed.success) return
      return parsed.data
    })
    .catch(() => undefined)
}

async function writeGptunnelCache(models: Record<string, Model>) {
  await Bun.write(gptunnelCache, JSON.stringify({ updated_at: Date.now(), models }, null, 2)).catch(() => undefined)
}

export function gptunnelCustomLoader(dep: Dep) {
  return Effect.fnUntraced(function* (input: Info) {
    const config = yield* dep.config()
    const auth = yield* dep.auth("gptunnel")
    const env = yield* dep.env()
    const configKey = config.provider?.["gptunnel"]?.options?.apiKey
    const key = env["GPTUNNEL_API_KEY"] ?? (auth?.type === "api" ? auth.key : undefined)
    const apiKey = key ?? (typeof configKey === "string" ? configKey : undefined)

    if (!apiKey) {
      return { autoload: false }
    }

    const cache = yield* Effect.promise(() => readGptunnelCache())
    const cachedModels = cache?.models
    if (cachedModels && Date.now() - cache.updated_at <= gptunnelTTL && Object.keys(cachedModels).length > 0) {
      input.models = cachedModels
      return { autoload: true }
    }

    const models = yield* Effect.promise(() =>
      fetch(`${GPTUNNEL_API_URL}/models?code`, {
        headers: {
          Authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(15000),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`gptunnel models request failed with status ${response.status}`)
          return fromGptunnelResponse(await response.json())
        })
        .catch(() => undefined),
    )

    if (models && Object.keys(models).length > 0) {
      input.models = models
      yield* Effect.promise(() => writeGptunnelCache(models))
      return { autoload: true }
    }

    if (cachedModels && Object.keys(cachedModels).length > 0) {
      input.models = cachedModels
      return { autoload: true }
    }

    return { autoload: false }
  })
}
