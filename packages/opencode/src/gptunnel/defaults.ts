// Must be imported FIRST in index.ts — before any other import
// so that Flag.OPENCODE_CONFIG_CONTENT captures the value at module load time.
if (!process.env.OPENCODE_CONFIG_CONTENT) {
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    enabled_providers: ["gptunnel"],
    provider: {
      gptunnel: {
        name: "GPTunnel",
        api: "https://gptunnel.ru/v1",
        npm: "@ai-sdk/openai-compatible",
        env: ["GPTUNNEL_API_KEY"],
      },
    },
  })
}
