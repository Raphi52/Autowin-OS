// Lecture des blocs de commande et de question émis par le modèle, et réparation d’un bloc cassé
// sans ambiguïté, sorties telles quelles de agent-pilot.ts (lot 1).
import { VisibleStreamFilter } from '../../shared/stream-markup-filter'

const CONTROL_RE = /<(cmd|question)>\s*([\s\S]*?)\s*<\/\1>/g
export const REJECTED_QUESTION_RE = /<question>[\s\S]*?(?:<\/question>|$)/gi
export const REJECTED_QUESTION_MARKER = '[question modèle refusée et masquée]'

export type OrderedPilotToken =
  | { kind: 'text'; text: string }
  | {
      kind: 'command'
      name: string
      args: Record<string, unknown>
      /** Le bloc recu etait casse et a ete repare SANS ambiguite (voir `reparerAccoladeFinaleManquante`). */
      reparation?: string
    }
  /**
   * Bloc `<cmd>` PRESENT mais inexploitable (JSON invalide, ou valide sans `name`). Avant, ces deux
   * cas etaient avales silencieusement : le modele croyait avoir agi, l'utilisateur recevait une
   * conclusion, et AUCUNE action n'avait eu lieu. Un faux « c'est fait » est le pire defaut possible
   * pour un agent — l'echec doit etre visible et corrigible.
   */
  | { kind: 'invalid'; raw: string; reason: string }

function filterVisibleText(raw: string): string {
  const filter = new VisibleStreamFilter()
  return filter.push(raw) + filter.finish()
}

/**
 * `<cmd>` A LA FERMETURE ERRONEE — mesure, tour `6185f7e7-88fa-4add-bf84-c51741d1b8b0`
 * (2026-09-18) : le modele emet `<cmd>{...JSON complet...}</invoke>
</function_calls>` puis sa
 * phrase de cloture. Sans `</cmd>`, CONTROL_RE ne matchait rien : l'orchestration n'etait PAS
 * lancee et tout le texte depuis `<cmd>` (conclusion comprise) etait masque — l'utilisateur lisait
 * « Aucune reponse produite pour ce tour. ». fix-ok: fermeture `</invoke>` au lieu de `</cmd>`.
 * On recupere un objet JSON EQUILIBRE et PARSABLE juste apres `<cmd>`, on le referme proprement et
 * on retire les fermetures parasites qui le suivent. Un JSON incomplet reste intact (chemin invalid).
 */
export function normaliserFermeturesCmd(raw: string): string {
  let out = ''
  let i = 0
  while (true) {
    const start = raw.indexOf('<cmd>', i)
    if (start < 0) return out + raw.slice(i)
    const apresOuverture = start + 5
    let j = apresOuverture
    while (j < raw.length && /\s/.test(raw[j])) j++
    const fin = raw[j] === '{' ? finObjetJson(raw, j) : -1
    if (fin < 0) {
      out += raw.slice(i, apresOuverture)
      i = apresOuverture
      continue
    }
    const json = raw.slice(j, fin)
    const reste = raw.slice(fin)
    if (/^\s*<\/cmd>/.test(reste)) {
      out += raw.slice(i, fin)
      i = fin
      continue
    }
    try {
      JSON.parse(json)
    } catch {
      out += raw.slice(i, apresOuverture)
      i = apresOuverture
      continue
    }
    const parasites = /^(?:\s*<\/(?:invoke|function_calls|parameter|antml:[a-z_]+)>)*/.exec(reste)
    out += raw.slice(i, start) + '<cmd>' + json + '</cmd>'
    i = fin + (parasites ? parasites[0].length : 0)
  }
}

function finObjetJson(raw: string, debut: number): number {
  let profondeur = 0
  let dansChaine = false
  for (let k = debut; k < raw.length; k++) {
    const c = raw[k]
    if (dansChaine) {
      if (c === '\\') k++
      else if (c === '"') dansChaine = false
    } else if (c === '"') dansChaine = true
    else if (c === '{') profondeur++
    else if (c === '}' && --profondeur === 0) return k + 1
  }
  return -1
}

/** Un objet `{name, args?}` que le dispatch sait executer. */
function commandeExploitable(valeur: unknown): boolean {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false
  const { name, args } = valeur as { name?: unknown; args?: unknown }
  if (typeof name !== 'string' || !name.trim()) return false
  return args === undefined || (!!args && typeof args === 'object' && !Array.isArray(args))
}

/** Au-dela, essayer chaque position couterait trop : le bloc reste `invalid` et la relance agit. */
const REPARATION_BUDGET_CARACTERES = 20_000_000

/**
 * `<cmd>` A UNE ACCOLADE FERMANTE PRES — mesure, tour
 * `b60bf535-44e5-47e8-b43a-e3260ddc74ef` (2026-10-10, journal `run-stdout/a18bb1fb…`) : le modele
 * ecrit `<cmd>{"name":"brain_query","args":{"question":"…"}</cmd>`, deux `{` pour une seule `}`.
 * Rejete en « JSON illisible ». La relance unique (posee, tour `c73fd638`, MEME
 * defaut) n'a pas suffi : le modele a attribue la position de l'erreur aux accents (raisonnement de
 * l'iteration 1), a re-emis la MEME forme en ASCII, et le tour s'est clos sur « renvoie ton message ».
 * Lapsus RECURRENT du modele : la cause est hors depot.
 *
 * Ce que fait Autowin : quand UNE seule `}` manque et qu'il n'existe qu'UNE facon de la placer qui
 * donne une commande executable, l'intention est univoque — on l'execute, comme
 * `recupererCmdFermeeEnOutilNatif` (providers/claude.ts). On essaie CHAQUE position hors chaine : deux lectures
 * differentes (une `}` oubliee au milieu d'`args` imbriques) = ambigu -> `undefined`, le bloc reste
 * `invalid` et la relance s'en charge. Rien d'autre n'est repare (guillemet, virgule, `]`).
 */
export function reparerAccoladeFinaleManquante(bloc: string): string | undefined {
  const texte = bloc.trim()
  if (!texte.startsWith('{')) return undefined
  const positions: number[] = []
  const pile: string[] = []
  let dansChaine = false
  for (let k = 0; k < texte.length; k++) {
    const c = texte[k]
    if (dansChaine) {
      if (c === '\\') k++
      else if (c === '"') dansChaine = false
      continue
    }
    positions.push(k)
    if (c === '"') dansChaine = true
    else if (c === '{') pile.push('}')
    else if (c === '[') pile.push(']')
    else if ((c === '}' || c === ']') && pile.pop() !== c) return undefined
  }
  // Seule la racine reste ouverte : exactement UNE `}` manque, aucun `]`, aucune chaine ouverte.
  if (dansChaine || pile.length !== 1 || pile[0] !== '}') return undefined
  positions.push(texte.length)
  if (positions.length * texte.length > REPARATION_BUDGET_CARACTERES) return undefined
  const lectures = new Map<string, string>()
  for (const position of positions) {
    const candidat = `${texte.slice(0, position)}}${texte.slice(position)}`
    let lu: unknown
    try {
      lu = JSON.parse(candidat)
    } catch {
      continue // cette position ne donne pas de JSON : on essaie la suivante
    }
    if (!commandeExploitable(lu)) continue
    const cle = JSON.stringify(lu)
    if (!lectures.has(cle)) lectures.set(cle, candidat)
    if (lectures.size > 1) return undefined
  }
  return lectures.size === 1 ? [...lectures.values()][0] : undefined
}

/**
 * Tours `6185f7e7-88fa-4add-bf84-c51741d1b8b0` et `30876029-68c5-43c8-948c-59786b28a081`
 * (saisies ts 1789711890089 et 1789712145048) : le modele a emis une commande `<cmd>` illisible,
 * rien n'a ete lance, et l'ecran disait « Aucune reponse produite » — l'utilisateur a renvoye le
 * meme message sans savoir qu'une commande avait ete perdue. Le repli le dit desormais.
 */
export function texteCmdIlisible(): string {
  return (
    'J’ai voulu lancer une action, mais ma commande était mal formée : rien n’a été lancé. ' +
    'Renvoie ton message pour relancer.'
  )
}

export function parseOrderedPilotTokens(input: string): OrderedPilotToken[] {
  const raw = normaliserFermeturesCmd(input)
  const tokens: OrderedPilotToken[] = []
  let cursor = 0
  CONTROL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CONTROL_RE.exec(raw)) !== null) {
    const visible = filterVisibleText(raw.slice(cursor, match.index))
    if (visible) tokens.push({ kind: 'text', text: visible })
    if (match[1] === 'cmd') {
      const rawBlock = match[2]
      let lisible = rawBlock
      let reparation: string | undefined
      try {
        JSON.parse(rawBlock)
      } catch (erreurDeLecture) {
        const repare = reparerAccoladeFinaleManquante(rawBlock)
        if (repare) {
          lisible = repare
          reparation = 'accolade fermante manquante ajoutée (une seule lecture possible)'
        } else {
          tokens.push({
            kind: 'invalid',
            raw: rawBlock,
            reason: `JSON illisible : ${erreurDeLecture instanceof Error ? erreurDeLecture.message : String(erreurDeLecture)}`
          })
          cursor = match.index + match[0].length
          continue
        }
      }
      try {
        const parsed = JSON.parse(lisible) as {
          name?: string
          args?: Record<string, unknown>
        }
        // `name` doit être une STRING non vide : un `if (parsed.name)` laissait passer tout truthy
        // (`42`, `{}`, `[]`) → un token `command` portait un nom non-string, et le dispatch en aval
        // (comparaison/normalisation de nom) cassait sur une entrée qu'un modèle peut produire.
        const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
        if (name) {
          // `args` doit être un objet simple : un tableau/scalaire produirait un sac d'arguments
          // invalide côté exécution → on retombe sur un objet vide plutôt que de propager.
          const args =
            parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
              ? parsed.args
              : {}
          tokens.push(
            reparation ? { kind: 'command', name, args, reparation } : { kind: 'command', name, args }
          )
        } else {
          // JSON valide mais sans `name` exploitable : deuxieme trou silencieux du parseur d'origine.
          tokens.push({
            kind: 'invalid',
            raw: rawBlock,
            reason:
              parsed.name === undefined || parsed.name === null
                ? 'champ « name » absent'
                : 'champ « name » invalide (chaîne non vide attendue)'
          })
        }
      } catch (error) {
        tokens.push({
          kind: 'invalid',
          raw: rawBlock,
          reason: `JSON illisible : ${error instanceof Error ? error.message : String(error)}`
        })
      }
    }
    cursor = match.index + match[0].length
  }
  const trailing = filterVisibleText(raw.slice(cursor))
  if (trailing) tokens.push({ kind: 'text', text: trailing })
  return tokens
}
