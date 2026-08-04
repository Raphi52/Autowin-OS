export const ROUTED_PROVIDERS = ['codex', 'claude', 'kimi', 'gemini'] as const

export type RoutedProvider = (typeof ROUTED_PROVIDERS)[number]
