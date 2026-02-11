import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function GptunnelAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "gptunnel",
      methods: [
        {
          type: "oauth",
          label: "GPTunnel API Key",
          async authorize() {
            return {
              url: "https://gptunnel.ru/profile/",
              method: "code" as const,
              instructions: "Create your API key on the profile page and paste it below",
              async callback(code: string) {
                if (!code.trim()) return { type: "failed" as const }
                return { type: "success" as const, key: code.trim() }
              },
            }
          },
        },
      ],
    },
  }
}
