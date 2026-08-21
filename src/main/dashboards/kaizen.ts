// Agrégation de télémétrie type gate-counters.jsonl → patterns récurrents (candidat ⑦).

/**
 * Un evenement de gate, tel que logge dans gate-counters.jsonl.
 *
 * `outcome` est DERIVE a la lecture : aucun producteur ne l'ecrit (mesure le 2026-08-21, absent des
 * 535 lignes du fichier reel). Il reste dans le type parce que les consommateurs raisonnent en
 * block/revert, et il est encore accepte s'il est present -- mais la source de verite sur disque,
 * c'est `gate` et `blocked`.
 */
export type GateEvent = {
  gate: string
  file?: string
  outcome: 'block' | 'pass' | 'revert'
  session?: string
}

/**
 * Parse un texte JSONL (1 objet par ligne) en liste de GateEvent.
 *
 * LIT LA FORME REELLEMENT ECRITE, pas une forme souhaitee. Ce parseur retenait 0 ligne sur 535 du
 * fichier reel, pour UNE seule raison : il exigeait un champ `outcome` qu'aucun hook n'ecrit. Le
 * tableau de bord kaizen annoncait donc « aucun pattern recurrent » en permanence, ce qui se lit
 * comme une absence de probleme alors que c'etait une cecite -- 41 patterns sont apparus des que la
 * lecture a ete corrigee, dont 99 blocages du stop-gate sur un seul workspace.
 *
 * LE BOM N'Y ETAIT POUR RIEN, contrairement a ce qui avait ete avance : `trim()` le retire deja,
 * U+FEFF etant un blanc au sens ECMAScript. Un garde-fou ajoute « au cas ou » a d'abord ete ecrit
 * ici, puis retire quand son sabotage est reste VERT -- il ne gardait rien. La mesure a tue
 * l'explication en trop.
 *
 * Le contrat est COPIE des producteurs (`~/.claude/hooks/`), pas devine :
 *   stop-gate.ps1:314 et anti-flaky.ps1:54  ecrivent `gate` + `blocked` = un COMPTE (jamais 0)
 *   fix-gate.ps1:182                        ecrit `gate:'fix-gate'` SANS `blocked`
 *   kaizen-revert-log.ps1:41                ecrit `gate:'revert'` SANS `blocked`
 * Les deux derniers n'ecrivent que sur leur chemin de refus. Consequence : toute ligne presente
 * dans ce fichier EST une morsure, et `outcome` se derive du seul endroit ou l'information vit --
 * le nom du gate.
 *
 * Un `outcome` explicite est encore honore s'il est VALIDE, et la ligne reste rejetee s'il est
 * present mais inconnu : la tolerance porte sur son absence, jamais sur une valeur fausse.
 *
 * Robuste par necessite mesuree : BOM, lignes vides, lignes non-JSON.
 */
export function parseJsonl(text: string): GateEvent[] {
  const events: GateEvent[] = []

  for (const rawLine of text.split('\n')) {
    // `trim()` retire deja le BOM : U+FEFF est un blanc au sens ECMAScript (verifie 2026-08-21).
    const line = rawLine.trim()
    if (line === '') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    if (typeof parsed !== 'object' || parsed === null) continue
    const obj = parsed as Record<string, unknown>

    if (typeof obj.gate !== 'string') continue

    let outcome: GateEvent['outcome']
    if (obj.outcome === undefined) {
      // Derivation : seul le nom du gate distingue un revert d'un blocage.
      outcome = obj.gate === 'revert' ? 'revert' : 'block'
    } else if (obj.outcome === 'block' || obj.outcome === 'pass' || obj.outcome === 'revert') {
      outcome = obj.outcome
    } else {
      continue
    }

    events.push({
      gate: obj.gate,
      outcome,
      file: typeof obj.file === 'string' ? obj.file : undefined,
      session: typeof obj.session === 'string' ? obj.session : undefined
    })
  }

  return events
}

/**
 * Regroupe les events par (gate) et par (gate+file), compte les 'block'+'revert'
 * (les 'pass' ne comptent pas), et retourne les groupes dont le compte >= threshold,
 * triés par compte décroissant.
 */
export function recurrentPatterns(
  events: GateEvent[],
  threshold = 3
): { key: string; count: number; gate: string; file?: string }[] {
  const counts = new Map<string, { count: number; gate: string; file?: string }>()

  for (const evt of events) {
    if (evt.outcome !== 'block' && evt.outcome !== 'revert') continue

    // Groupe par gate seul.
    const gateKey = evt.gate
    const gateEntry = counts.get(gateKey) ?? { count: 0, gate: evt.gate }
    gateEntry.count += 1
    counts.set(gateKey, gateEntry)

    // Groupe par gate+file (si un fichier est présent).
    if (evt.file !== undefined) {
      const fileKey = `${evt.gate}::${evt.file}`
      const fileEntry = counts.get(fileKey) ?? { count: 0, gate: evt.gate, file: evt.file }
      fileEntry.count += 1
      counts.set(fileKey, fileEntry)
    }
  }

  const result = Array.from(counts.entries())
    .filter(([, entry]) => entry.count >= threshold)
    .map(([key, entry]) => ({ key, count: entry.count, gate: entry.gate, file: entry.file }))

  result.sort((a, b) => b.count - a.count)
  return result
}

/** Résumé global : total d'events + compte par outcome. */
export function summary(events: GateEvent[]): {
  total: number
  blocks: number
  reverts: number
  passes: number
} {
  let blocks = 0
  let reverts = 0
  let passes = 0

  for (const evt of events) {
    if (evt.outcome === 'block') blocks += 1
    else if (evt.outcome === 'revert') reverts += 1
    else if (evt.outcome === 'pass') passes += 1
  }

  return { total: events.length, blocks, reverts, passes }
}
