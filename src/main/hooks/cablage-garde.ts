
/**
 * LE GARDE DU CABLAGE — un garde-fou retire du cablage doit CRIER, pas disparaitre.
 *
 * CE QUI EST ARRIVE, mesure le 2026-08-21 : quatre garde-fous deterministes du kit
 * (`stop-gate`, `anti-flaky`, `fix-gate`, `push-needs-run`) etaient absents de
 * `~/.claude/settings.json` alors que leurs scripts etaient toujours sur le disque. Leur
 * telemetrie totalisait 480 morsures, puis plus rien depuis le 2026-08-14. Pendant une semaine,
 * l'agent a continue d'invoquer leur autorite — « le stop-gate bloque une cloture non prouvee »,
 * « push-needs-run refuse un push sans RUN.md » — en repetant la documentation du kit sans jamais
 * lire son cablage. Sept RUN ont ete fermes `green` sur cette autorite inexistante.
 *
 * La lecon n'est pas « il faut re-brancher » : c'est fait. Elle est qu'un script PRESENT SUR DISQUE
 * ressemble a un garde-fou actif, et que rien ne distinguait les deux. Ce module fournit la
 * distinction, sous forme de fonction PURE : elle ne lit ni fichier ni environnement, donc elle se
 * teste sur des donnees fabriquees et rend le meme verdict partout.
 *
 * POURQUOI UN LECTEUR PROPRE plutot que `parseJsonl` de `dashboards/kaizen` : mesure du
 * 2026-08-21, ce dernier retenait **0 ligne sur 522** du fichier reel, parce qu'il exigeait un
 * champ `outcome` ('block' | 'pass' | 'revert') que la telemetrie n'ecrit pas : elle porte
 * `blocked`. Reutiliser une brique existante etait le bon reflexe ; la mesurer avant de s'y
 * appuyer l'etait aussi.
 *
 * CORRIGE DEPUIS : `parseJsonl` derive desormais l'issue du nom du gate et retient 536/536. Ce
 * lecteur-ci reste independant a dessein -- ce garde ne doit pas dependre d'un autre module pour
 * fonctionner -- mais il n'accuse plus une brique reparee.
 *
 * RECTIFICATION : la version precedente de ce commentaire imputait aussi le defaut au BOM de la
 * premiere ligne. C'ETAIT FAUX, et mesure comme tel le meme jour : `trim()` retire deja le BOM,
 * U+FEFF etant un blanc au sens ECMAScript. La cause etait UNIQUE. Une explication en trop, meme
 * plausible, fait passer pour cause verifiee ce qui n'a jamais ete teste.
 */

/** Un evenement de telemetrie de gate, au format REELLEMENT ecrit sur disque. */
export interface MorsureGate {
  readonly gate: string
  /** 1 quand le gate a bloque. Absent ou 0 pour un simple passage observe. */
  readonly blocked?: number
}

/**
 * Lit le JSONL de telemetrie tel qu'il est ECRIT, pas tel qu'on aimerait qu'il soit.
 *
 * Tolerant par necessite mesuree : BOM en tete de fichier, lignes vides, lignes illisibles. Un
 * lecteur strict rend zero evenement sur ce fichier, et un garde qui lit zero evenement n'exige
 * plus rien — il passe au vert en ne verifiant rien.
 */
export function lireMorsures(texte: string): MorsureGate[] {
  const morsures: MorsureGate[] = []
  for (const ligneBrute of texte.split('\n')) {
    const ligne = ligneBrute.replace(/^\uFEFF/, '').trim()
    if (ligne === '') continue
    let objet: unknown
    try {
      objet = JSON.parse(ligne)
    } catch {
      continue
    }
    if (typeof objet !== 'object' || objet === null) continue
    const o = objet as Record<string, unknown>
    if (typeof o.gate !== 'string' || o.gate === '') continue
    morsures.push({
      gate: o.gate,
      ...(typeof o.blocked === 'number' ? { blocked: o.blocked } : {})
    })
  }
  return morsures
}

/** Un garde-fou attendu : il a deja mordu, donc son absence du cablage est une regression. */
export interface GardeAttendu {
  /** Le nom tel qu'il apparait dans la telemetrie (`gate`), ex. `stop`, `anti-flaky`. */
  readonly gate: string
  /** Le fichier de hook a retrouver dans le cablage, ex. `stop-gate.ps1`. */
  readonly script: string
  /** Combien de fois il a mordu — sert a expliquer ce qu'on perd, pas a decider. */
  readonly morsures: number
}

/**
 * Correspondance entre le nom du gate dans la telemetrie et son script.
 *
 * Elle est EXPLICITE et non deduite : `stop-gate.ps1` ecrit ses evenements sous le nom `stop`, et
 * `kaizen-revert-log.ps1` sous `revert`. Deviner par similarite de chaine aurait rate les deux.
 */
export const SCRIPT_PAR_GATE: Readonly<Record<string, string>> = {
  stop: 'stop-gate.ps1',
  'anti-flaky': 'anti-flaky.ps1',
  'fix-gate': 'fix-gate.ps1',
  revert: 'kaizen-revert-log.ps1'
}

/**
 * Les garde-fous qu'on ATTEND dans le cablage : ceux dont la telemetrie prouve qu'ils ont deja mordu.
 *
 * On part de la telemetrie plutot que d'une liste ecrite a la main, et ce choix est le coeur du
 * garde : une liste manuelle aurait exactement le meme defaut que la documentation qu'elle
 * remplacerait — elle vieillit sans que personne ne le voie. Un gate qui a mordu au moins une fois
 * a PROUVE qu'il servait ; c'est un fait, pas une intention.
 */
export function gardesAttendus(evenements: readonly MorsureGate[]): GardeAttendu[] {
  const compte = new Map<string, number>()
  for (const e of evenements) {
    if (!e.gate) continue
    compte.set(e.gate, (compte.get(e.gate) ?? 0) + 1)
  }
  const attendus: GardeAttendu[] = []
  for (const [gate, morsures] of compte) {
    const script = SCRIPT_PAR_GATE[gate]
    // Un gate inconnu de la table n'est PAS traite comme une regression : on ne sait pas quel
    // script le produit, donc exiger sa presence serait exiger quelque chose d'ininterpretable.
    // Il apparaitra dans `gatesSansScriptConnu` pour etre vu, jamais transforme en faux echec.
    if (script) attendus.push({ gate, script, morsures })
  }
  return attendus.sort((a, b) => b.morsures - a.morsures)
}

/** Les noms de gate presents dans la telemetrie mais absents de la table de correspondance. */
export function gatesSansScriptConnu(evenements: readonly MorsureGate[]): string[] {
  const inconnus = new Set<string>()
  for (const e of evenements) {
    if (e.gate && !SCRIPT_PAR_GATE[e.gate]) inconnus.add(e.gate)
  }
  return [...inconnus].sort()
}

/**
 * Les garde-fous attendus qui ne sont PAS dans le cablage.
 *
 * `cablage` est le texte BRUT de `settings.json`, volontairement : la recherche du nom de script
 * dans le texte est insensible a la forme exacte de la commande (`& "$env:USERPROFILE/..."`,
 * `powershell -File ...`, un chemin absolu). Parser la structure JSON aurait rendu le garde
 * dependant d'un schema de configuration qui n'est pas le notre et peut changer.
 */
export function gardesDebranches(
  cablage: string,
  evenements: readonly MorsureGate[]
): GardeAttendu[] {
  return gardesAttendus(evenements).filter((g) => !cablage.includes(g.script))
}

/** Message d'echec lisible : ce qui manque, et ce que ça coute. */
export function expliquerDebranchement(manquants: readonly GardeAttendu[]): string {
  if (manquants.length === 0) return ''
  const lignes = manquants.map(
    (g) => `  - ${g.script} (gate « ${g.gate} », ${g.morsures} morsure(s) dans la telemetrie)`
  )
  return [
    `${manquants.length} garde-fou(x) ont deja mordu mais ne sont plus dans le cablage :`,
    ...lignes,
    'Un script present sur disque n\'est pas un garde-fou actif. Re-declare-le dans settings.json,',
    'ou retire-le de la table de correspondance si son retrait est deliberé — mais dis-le.'
  ].join('\n')
}
