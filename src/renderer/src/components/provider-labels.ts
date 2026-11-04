/**
 * NOM AFFICHÉ D'UN FOURNISSEUR — source unique (conv-1499, 2026-11-04).
 *
 * La barre de quota, le sélecteur de modèle et le Routage tenaient chacun leur table : un fournisseur
 * ajouté dans l'une restait sous son identifiant technique (« agy », « api-xai ») dans les autres.
 */
export const LIBELLES_FOURNISSEURS: Readonly<Record<string, string>> = {
  claude: 'Claude',
  codex: 'ChatGPT',
  gemini: 'Gemini',
  kimi: 'Kimi',
  // agy = Gemini par l'abonnement Google ; api-gemini = Gemini par clé.
  agy: 'Gemini',
  'api-gemini': 'Gemini',
  'api-xai': 'Grok',
  'api-groq': 'Groq',
  'api-mistral': 'Mistral',
  'api-cerebras': 'Cerebras',
  'api-github': 'GitHub Models',
  'api-nvidia': 'NVIDIA'
}

export function libelleFournisseur(provider: string): string {
  return LIBELLES_FOURNISSEURS[provider] ?? provider
}
