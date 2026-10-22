/**
 * L'ACCORD MODÈLE PRINCIPAL / ADVISOR QUE LE CLI CLAUDE ACCEPTE (conv-1083, 2026-10-22).
 *
 * L'advisor est un second modèle, plus fort, que l'agent consulte aux moments qui décident (choisir
 * une approche, erreur qui revient, avant de dire « fini »). Intérêt pour Autowin : faire tourner
 * build et clean sur un modèle moins cher, avec un modèle fort en renfort ponctuel.
 *
 * Pourquoi un contrôle AVANT l'envoi. La doc (« Use the --advisor flag ») annonce deux issues pour
 * un accord hors table, et aucune ne sert l'utilisateur :
 * - advisor capable de conseiller mais classé SOUS le modèle principal : la session démarre et le
 *   modèle principal tourne SANS advisor. MESURÉ le 2026-10-22 sur le CLI 2.1.308 en `-p`
 *   (conv-1083), conforme à la doc : `--model claude-opus-5-5 --advisor claude-sonnet-5-5` → code 0,
 *   avertissement sur stderr (« cannot advise … will not be used »), seul `claude-opus-5-5` dans
 *   `modelUsage`. Le réglage se perdrait ;
 * - modèle principal qui ne prend pas d'advisor, modèle qui ne peut pas en être un (Haiku 4.5),
 *   modèle exclu par `availableModels`, Fable sans le consentement de facturation : le CLI SORT EN
 *   ERREUR au lancement, donc toute l'étape tombe. MESURÉ le même jour pour Haiku 4.5, conforme à la
 *   doc : `--model claude-sonnet-5-5 --advisor claude-haiku-4-5` → code 1, « Error: The model
 *   "claude-haiku-4-5" cannot be used as an advisor. ». Les trois autres cas ne sont pas mesurés, et
 *   les deux derniers dépendent du compte : la table ne peut pas les voir.
 * Le contrôle écarte l'accord avant l'envoi et le run dit pourquoi (`orchestrator.ts`, ligne
 * `[advisor]`). Accord accepté mesuré le même jour (`--model claude-sonnet-5-5 --advisor
 * claude-opus-5-5`) : code 0, `claude-opus-5-5` présent dans `modelUsage`, étape `advisor_message`
 * dans `usage.iterations`.
 *
 * fix-ok: conv-1083 — quatre éditions, aucune à l'aveugle : (1) création ; (2) défaut remis EXPRÈS
 * (accord Opus 5.5 + advisor Sonnet 5.5 envoyé sans contrôle), attrapé par claude-advisor.test.ts,
 * puis retiré ; (3) commentaires réécrits après MESURE sur le CLI 2.1.308 ; (4) l'étape (3) avait
 * présenté cette mesure comme opposée à la doc, à tort (objection du contrôle final, doc relue) : le
 * cas mesuré (advisor classé sous le principal) est celui où la doc annonce un démarrage sans
 * advisor. Aucune ligne de logique n'a changé aux étapes (3) et (4).
 *
 * ACTIVER : dans `roles.json` (dossier de données de l'app), sur le rôle `subagent` qui joue build
 * et clean (`orchestrator.ts`, `roleDeLaPhase`), ajouter
 * `"phaseModel": { "build": { "model": "claude-sonnet-5-5", "advisorModel": "claude-opus-5-5" } }`
 * (même forme pour `clean`). Aucun écran ne le règle encore. Absent = pas d'advisor (défaut).
 *
 * Table COPIÉE de https://code.claude.com/docs/en/advisor (« Choose an advisor model », lue le
 * 2026-10-22, CLI installé 2.1.308) — jamais réécrite de mémoire :
 *   Haiku 4.5 / Sonnet 4.6   → Fable, Opus, Sonnet, Haiku 5.5
 *   Opus 4.6                 → Fable, Opus, Sonnet 5 ou plus, Haiku 5.5
 *   Sonnet 5 / Haiku 5.5     → Fable, Opus 4.7 ou plus, Sonnet 5 ou plus, Haiku 5.5
 *   Opus 4.7 / Opus 4.8      → Fable, Opus 4.7 ou plus, Sonnet 5.5
 *   Sonnet 5.5               → Fable, Opus 5 ou plus, Sonnet 5.5
 *   Opus 5 / Opus 5.5        → Fable, Opus 5 ou plus
 *   Fable 5                  → Fable 5.1 ou Fable 5
 *   Fable 5.1                → Fable 5.1
 * Haiku 4.5 peut appeler un advisor mais ne peut pas en être un.
 *
 * Un ALIAS de famille (`opus`, `sonnet`, `fable`) prend la version par défaut du CLI, qui avance à
 * chaque version du CLI : il n'est accepté que là où la ligne accepte la famille ENTIÈRE. Ailleurs,
 * il faut un identifiant complet (`claude-opus-5-5`) — on ne devine pas une version.
 */

type Famille = 'opus' | 'sonnet' | 'haiku' | 'fable'

interface ModeleLu {
  famille: Famille
  /** Version × 10 (5.5 → 55, 5 → 50) ; absente pour un alias de famille. */
  version?: number
}

/** Une règle d'advisor : la famille, et la plage de versions acceptée (absente = toute la famille). */
interface RegleAdvisor {
  famille: Famille
  min?: number
  exactes?: readonly number[]
}

interface LigneAccord {
  libelle: string
  principal: (m: ModeleLu) => boolean
  advisors: readonly RegleAdvisor[]
}

const est =
  (famille: Famille, ...versions: number[]) =>
  (m: ModeleLu): boolean =>
    m.famille === famille && m.version !== undefined && versions.includes(m.version)

const TABLE_ACCORDS: readonly LigneAccord[] = [
  {
    libelle: 'Haiku 4.5',
    principal: est('haiku', 45),
    advisors: [
      { famille: 'fable' },
      { famille: 'opus' },
      { famille: 'sonnet' },
      { famille: 'haiku', exactes: [55] }
    ]
  },
  {
    libelle: 'Sonnet 4.6',
    principal: est('sonnet', 46),
    advisors: [
      { famille: 'fable' },
      { famille: 'opus' },
      { famille: 'sonnet' },
      { famille: 'haiku', exactes: [55] }
    ]
  },
  {
    libelle: 'Opus 4.6',
    principal: est('opus', 46),
    advisors: [
      { famille: 'fable' },
      { famille: 'opus' },
      { famille: 'sonnet', min: 50 },
      { famille: 'haiku', exactes: [55] }
    ]
  },
  {
    libelle: 'Sonnet 5 ou Haiku 5.5',
    principal: (m) => est('sonnet', 50)(m) || est('haiku', 55)(m),
    advisors: [
      { famille: 'fable' },
      { famille: 'opus', min: 47 },
      { famille: 'sonnet', min: 50 },
      { famille: 'haiku', exactes: [55] }
    ]
  },
  {
    libelle: 'Opus 4.7 ou Opus 4.8',
    principal: est('opus', 47, 48),
    advisors: [
      { famille: 'fable' },
      { famille: 'opus', min: 47 },
      { famille: 'sonnet', exactes: [55] }
    ]
  },
  {
    libelle: 'Sonnet 5.5',
    principal: est('sonnet', 55),
    advisors: [
      { famille: 'fable' },
      { famille: 'opus', min: 50 },
      { famille: 'sonnet', exactes: [55] }
    ]
  },
  {
    libelle: 'Opus 5 ou Opus 5.5',
    principal: est('opus', 50, 55),
    advisors: [{ famille: 'fable' }, { famille: 'opus', min: 50 }]
  },
  {
    libelle: 'Fable 5',
    principal: est('fable', 50),
    advisors: [{ famille: 'fable', exactes: [50, 51] }]
  },
  {
    libelle: 'Fable 5.1',
    principal: est('fable', 51),
    advisors: [{ famille: 'fable', exactes: [51] }]
  }
]

/**
 * `claude-opus-5-5` → opus 5.5 ; `claude-haiku-4-5-20251001` → haiku 4.5 ; `claude-fable-5` →
 * fable 5 ; `opus` → famille seule. Préfixe de transport (`cc/`) et suffixe `[1m]` tolérés.
 */
export function lireModeleClaude(id: string | undefined): ModeleLu | undefined {
  if (!id) return undefined
  const brut = id
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, '')
  const m = brut.match(/(?:^|[/-])(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d{1,2}))?)?(?:-\d{8})?$/)
  if (!m) return undefined
  const famille = m[1] as Famille
  if (m[2] === undefined) return { famille }
  return { famille, version: Number(m[2]) * 10 + (m[3] === undefined ? 0 : Number(m[3])) }
}

function regleAccepte(regle: RegleAdvisor, advisor: ModeleLu): boolean {
  if (regle.famille !== advisor.famille) return false
  if (regle.min === undefined && regle.exactes === undefined) return true
  // Alias de famille sous une règle versionnée : sa version dépend du CLI, on ne la devine pas.
  if (advisor.version === undefined) return false
  if (regle.min !== undefined) return advisor.version >= regle.min
  return regle.exactes?.includes(advisor.version) ?? false
}

/** L'accord est-il dans la table ? `raison` dit pourquoi non, pour que le refus soit lisible. */
export function advisorAccepte(
  principal: string | undefined,
  advisor: string | undefined
): { accepte: boolean; raison?: string } {
  const lu = lireModeleClaude(principal)
  if (!lu) return { accepte: false, raison: `modèle principal inconnu (${principal ?? 'absent'})` }
  const ligne = TABLE_ACCORDS.find((l) => l.principal(lu))
  if (!ligne) return { accepte: false, raison: `${principal} ne prend pas d’advisor` }
  const conseil = lireModeleClaude(advisor)
  if (!conseil) return { accepte: false, raison: `advisor inconnu (${advisor ?? 'absent'})` }
  if (ligne.advisors.some((regle) => regleAccepte(regle, conseil))) return { accepte: true }
  return {
    accepte: false,
    raison: `${advisor} refusé comme advisor de ${ligne.libelle} (doc Claude Code, « Choose an advisor model »)`
  }
}
