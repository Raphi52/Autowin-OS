/**
 * LES CLÉS DU COFFRE DANS L'ENVIRONNEMENT D'UN AGENT — un seul calcul, partagé par les cinq moteurs.
 *
 * Pourquoi : un agent se sert d'une clé API par son NOM (`$MISTRAL_API_KEY` dans sa commande) au lieu
 * de la réclamer dans le fil ou de refuser faute de droit. Le coffre est relu à CHAQUE lancement : une
 * clé ajoutée vaut pour le prochain agent, sans redémarrer l'app.
 *
 * Ce qui n'est JAMAIS injecté : la variable qui ferait changer au CLI lancé son mode de connexion. Une
 * clé du coffre portant ce nom ne servirait pas l'agent : c'est le CLI lui-même qui la prendrait, et
 * le tour passerait de l'abonnement à la facturation à la clé (ou échouerait sur une clé d'une autre
 * organisation) sans que personne l'ait choisi. Pour TOUS les moteurs, `valeursPourAgent` écarte déjà
 * un nom qui ne désigne pas une clé (PATH, CLAUDE_CONFIG_DIR) et le jeton de session de Claude Code
 * (`estNomDeCle`, coffre-cles.ts).
 *
 * `AUTOWIN_COFFRE_NOMS` nomme ce qui a été injecté : l'agent y lit les noms dont il peut se servir.
 */
import { valeursPourAgent } from '../app/coffre-cles'

export const COFFRE_NOMS_ENV = 'AUTOWIN_COFFRE_NOMS'

export type MoteurAgent = 'claude' | 'codex' | 'agy' | 'grok' | 'direct'

/** Par moteur, les noms que le coffre ne pose jamais : ceux qui changent la connexion du CLI lancé. */
export const EXCLUSIONS_COFFRE: Readonly<Record<MoteurAgent, readonly string[]>> = {
  // Claude Code passe ces trois variables AVANT la session d'abonnement (`/login`) ; en mode `-p`,
  // une clé présente est toujours utilisée. Source : « Authentication precedence »,
  // https://code.claude.com/docs/en/authentication
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  // `codex exec` réutilise la session enregistrée, sauf si une clé est posée pour le run :
  // « To use a different API key for a single run, set CODEX_API_KEY inline » ; la même page range
  // OPENAI_API_KEY avec elle (« Do not set OPENAI_API_KEY or CODEX_API_KEY as a job-level
  // environment variable »). Source : « Non-interactive mode »,
  // https://learn.chatgpt.com/docs/non-interactive-mode (ex developers.openai.com/codex/noninteractive)
  codex: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
  // Antigravity : « The CLI reads the credential only from GEMINI_API_KEY in the environment » (mode
  // clé dès que `modelProvider` vaut `gemini`), et `AGY_ADC_AUTH=true` bascule sur les identifiants
  // Google Cloud (ADC). GOOGLE_API_KEY « has no effect » : elle reste servie. Source : « Authenticate »,
  // https://antigravity.google/docs/install?tab=cli
  agy: ['GEMINI_API_KEY', 'AGY_ADC_AUTH'],
  // Règle de l'utilisateur : Grok passe par son CLI et son abonnement, jamais par l'API directe.
  // `envSansCleXai` (grok.ts) retire en plus la variable héritée, en dernier.
  grok: ['XAI_API_KEY'],
  // Moteur direct (openai-compat.ts) : aucun CLI n'est lancé. Il lit sa clé dans l'environnement de
  // l'app elle-même (`this.cfg.env ?? process.env`), jamais dans celui des commandes de ses agents :
  // aucune clé posée ici ne peut changer sa connexion.
  // fix-ok: outils-agent-direct.ts construisait l'env des commandes sans le coffre (test « moteur direct » rouge : %MISTRAL_API_KEY% non défini)
  direct: []
}

/**
 * Les variables à poser pour ce moteur : les clés du coffre hors exclusions, plus `AUTOWIN_COFFRE_NOMS`
 * (noms triés, séparés par des virgules). Coffre vide ou indisponible → `{}` : l'environnement de
 * l'agent reste exactement celui d'avant le coffre.
 */
export function envDuCoffre(moteur: MoteurAgent): Record<string, string> {
  const valeurs = valeursPourAgent(EXCLUSIONS_COFFRE[moteur])
  const noms = Object.keys(valeurs).sort()
  if (noms.length === 0) return {}
  return { ...valeurs, [COFFRE_NOMS_ENV]: noms.join(',') }
}
