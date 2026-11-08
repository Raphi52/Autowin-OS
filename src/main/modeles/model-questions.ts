export type ModelQuestionReason =
  | 'destructive'
  | 'irreversible'
  | 'secret-or-personal-data'
  | 'external-effect'
  | 'material-ambiguity'

export interface ModelQuestion {
  text: string
  options: string[]
  reason: ModelQuestionReason
}

const QUESTION_RE = /<question>\s*(\{[\s\S]*?\})\s*<\/question>/i
export function parseModelQuestion(text: string): ModelQuestion | null {
  const match = QUESTION_RE.exec(text)
  if (!match) return null
  try {
    JSON.parse(match[1])
    // Disabled by default: the model cannot prove that a question is necessary,
    // and chat answers are part of observable prompts. Credentials are configured
    // through provider UI, never requested or transported in chat.
    return null
  } catch {
    return null
  }
}

// CONSIGNE « Avance de façon autonome » RETIRÉE du chat (2026-11-05) : ses 881
// caractères, payés à chaque tour, redisaient la CONSTITUTION injectée dans le même prompt
// (Autonomie (3), réflexes 1 et 10, limite destructive, secrets) — et l'avaient déjà contredite une
// fois (« les actions destructives s'exécutent directement »). Sa seule phrase propre,
// « ne demande pas un secret dans le chat », est passée dans la ligne Secrets de la constitution.
// Interdire la balise <question> au modèle n'avait plus d'objet : `parseModelQuestion` rend null
// quoi qu'il reçoive, et rien d'autre ne lui enseigne cette balise.
//
// LA FENÊTRE « Le modèle a besoin de toi » EST RETIRÉE (2026-11-08, choix de l'utilisateur : « je
// veux pas de popup comme ça »), avec sa file d'attente, son ouverture et son pont vers la page. Un
// travail bloqué tranche lui-même (`gates/etendue-repetee.ts`, `juge/relecture-froide.ts`).
