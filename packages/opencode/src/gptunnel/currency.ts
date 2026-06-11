// GPTunnel bills in RUB; all model.cost values are RUB per 1M tokens
// (see provider-loader.ts). Keep every cost-reporting surface on this constant.
// packages/web and packages/tui can't import from here — their formatters
// hardcode RUB locally.
export const COST_CURRENCY = "RUB"
