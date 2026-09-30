/**
 * LE PLAFOND DE PREUVE DU SCOUT, APPLIQUÉ EN CODE — il n'existait qu'en texte.
 *
 * La consigne dit « un Why DEDUCTIF est plafonné à 50 » (`phase-briefs.ts`). Écrite seule, la règle
 * n'engage rien. Relu dans les traces le 30/09 : conv-812 note 72 une piste dont le Pourquoi dit
 * « Sous réserve : je n'ai cherché que les minuteurs », conv-775 note 60 une piste dont le Pourquoi
 * dit « la cause exacte n'est pas vérifiée », et conv-602 note 88 une piste dont l'ancrage
 * (`Program.cs:300-304`) dit lui-même que la classe citée a disparu — relevé par le run suivant.
 *
 * Deux contrôles de FORME, les seuls falsifiables quand producteur et juge sont le même modèle :
 *  1. le Pourquoi AVOUE ne pas avoir vérifié → la note tombe à 50 ;
 *  2. un CORRECTIF dont aucun ancrage contrôlable ne tombe sur du code vivant (commentaire, ligne
 *     vide, après la fin, fichier introuvable) → la note tombe à 50. « Aucun », pas « un » : un
 *     commentaire cité peut documenter une décision vraie (conv-890 : `orchestrator.ts:1371`).
 *
 * On PLAFONNE, on ne refuse pas : un refus paierait une réparation entière pour une note. La raison
 * est écrite sous le tableau, et le tableau est retrié ; les numéros de ligne ne bougent pas, car la
 * section `## Cible` les cite.
 * fix-ok: `grep plafon src/main` hors tests ne trouvait que phase-briefs.ts (du texte) : aucun code
 * ne tenait la regle ; la regle « aucun ancrage vivant » vient de l'essai sur orchestrator.ts:1371.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { localiserTableauScout, scoreSur100 } from '../shared/scout-table'

export const PLAFOND_PREUVE = 50

export type EtatAncrage =
  'code' | 'commentaire' | 'vide' | 'hors-fichier' | 'absent' | 'incontrolable'
export type LecteurAncrage = (chemin: string, ligne: number) => EtatAncrage

/**
 * Un AVEU de non-vérification, à la première personne ou en étiquette. « le test vérifie X, pas Y »
 * est un constat sur le code, pas un doute du scout : il ne doit pas mordre.
 * Les formes « n'est pas vérifiée », « sous réserve », « je n'ai pas mesuré/lu » et « c'est une
 * déduction » viennent des sorties réelles : conv-775 (60) et conv-812 (72) passaient sans elles.
 */
const AVEU_NON_VERIFIE =
  /je n['’]ai pas (?:encore )?(?:v[ée]rifi|mesur|ouvert|lu\b|test)\p{L}*|n['’](?:est|sont) pas (?:encore )?v[ée]rifi\p{L}*|non v[ée]rifi\p{L}*|pas encore v[ée]rifi\p{L}*|sans l['’]avoir v[ée]rifi\p{L}*|(?:^|\s)[àa] v[ée]rifier(?![\p{L}])|\(\s*pas v[ée]rifi\p{L}*|(?:^|[—([]\s*)suppos[ée]\p{L}*|sous r[ée]serve|c['’]est une d[ée]duction|par d[ée]duction/iu

/**
 * L'EXCEPTION QUE LA CONSIGNE ÉCRIT ET QUE LA GARDE IGNORAIT : « plafonné à 50 TANT QUE les chemins
 * fermés ne sont pas nommés » (`phase-briefs.ts`, règle 4). Un Pourquoi qui dit où il a cherché —
 * « vérifié dans `gates/hooks.ts` » — a nommé ses chemins : son aveu ne le plafonne plus. Il faut un
 * CHEMIN (entre accents graves, ou avec `/` ou une extension) : « vérifié dans le code » ne nomme rien.
 * Une forme NIÉE (« je n'ai pas vérifié dans `a.ts` ») est un aveu, pas un chemin fermé.
 * fix-ok: vrai scout du 30/09 (demande de conv-382), piste 4 ramenée de 70 à 50 alors que son
 * Pourquoi nomme `gates/hooks.ts`, `orchestrator.ts` et `hooks/` : la règle 4 n'était codée qu'à moitié.
 */
const CHEMINS_FERMES =
  /(?<!(?:pas|non|jamais|ni)\s+(?:encore\s+)?)(?<![\p{L}])(?:v[ée]rifi[ée]e?s?|cherch[ée]e?s?|relu|lu)\s+(?:dans|sur)\s+(?:`[^`]+`|[\w.-]*[\\/][\w./\\-]*|[\w-]+\.\w+)/iu

/**
 * `chemin/fichier.ext:123` (une plage `:18-27` donne sa première ligne). Les URL sont retirées avant.
 * Extensions CONNUES seulement : sur les sorties réelles, `Economie.sauver:170` (une méthode Lua)
 * passait pour un fichier introuvable.
 */
const EXTENSIONS =
  'tsx?|jsx?|mjs|cjs|mts|cts|cs|py|lua|luau|md|json|jsonc|ya?ml|toml|ps1|psm1|sh|bash|bat|cmd|css|scss|less|html?|xml|xaml|csproj|props|targets|sln|sql|go|rs|java|kts?|c|h|cpp|hpp|cc|rb|php|vue|svelte|swift|dart|r|ini|cfg|conf|txt'
const ANCRAGE = new RegExp(
  String.raw`(?<![\w/.\\-])((?:[\w.-]+[\\/])*[\w-][\w.-]*\.(?:${EXTENSIONS})):(\d+)`,
  'giu'
)

const RAISON: Record<Exclude<EtatAncrage, 'code' | 'incontrolable'>, string> = {
  commentaire: 'tombe sur un commentaire',
  vide: 'tombe sur une ligne vide',
  'hors-fichier': 'pointe après la fin du fichier',
  absent: 'fichier introuvable dans le dossier de travail'
}

function ancrages(cellule: string): Array<{ chemin: string; ligne: number }> {
  const sansUrl = cellule.replace(/https?:\/\/\S+/giu, ' ')
  return [...sansUrl.matchAll(ANCRAGE)].map((m) => ({ chemin: m[1]!, ligne: Number(m[2]) }))
}

function reconstruire(cellules: string[]): string {
  return `| ${cellules.join(' | ')} |`
}

/**
 * La sortie du scout avec ses notes non prouvées ramenées au plafond. Inchangée quand rien ne mord,
 * ou quand elle ne contient pas de tableau scout lisible.
 */
export function plafonnerNotesScout(
  texte: string,
  lireAncrage: LecteurAncrage = () => 'incontrolable'
): string {
  const tableau = localiserTableauScout(texte ?? '')
  if (!tableau || tableau.colonnes.score < 0) return texte
  const { score: iScore, why: iWhy, how: iHow, num: iNum, type: iType } = tableau.colonnes
  const raisons: string[] = []
  const notes = new Map<number, number>()
  const cellulesPlafonnees = new Map<number, string[]>()

  for (const { index, cellules } of tableau.lignes) {
    const note = scoreSur100(cellules[iScore] ?? '')
    if (note === undefined) continue
    notes.set(index, note)
    if (note <= PLAFOND_PREUVE) continue
    const pourquoi = iWhy >= 0 ? (cellules[iWhy] ?? '') : ''
    const nom = iNum >= 0 ? `ligne ${cellules[iNum]}` : `« ${cellules[tableau.colonnes.what]} »`
    let raison: string | undefined
    const aveu = AVEU_NON_VERIFIE.exec(pourquoi)
    if (aveu && !CHEMINS_FERMES.test(pourquoi)) raison = `le Pourquoi dit « ${aveu[0].trim()} »`
    const estCorrectif = /🔧|\bfix\b|correctif/iu.test(iType >= 0 ? (cellules[iType] ?? '') : '')
    if (!raison && estCorrectif) {
      // What compris : le scout réel du 30/09 y mettait son seul ancrage de code (piste 4).
      const quoi = cellules[tableau.colonnes.what] ?? ''
      const cites = [quoi, pourquoi, iHow >= 0 ? (cellules[iHow] ?? '') : ''].flatMap(ancrages)
      const etats = cites.map((a) => ({ ...a, etat: lireAncrage(a.chemin, a.ligne) }))
      const controles = etats.filter((a) => a.etat !== 'incontrolable')
      if (controles.length > 0 && !controles.some((a) => a.etat === 'code')) {
        raison = controles
          .map((a) => `\`${a.chemin}:${a.ligne}\` ${RAISON[a.etat as keyof typeof RAISON]}`)
          .join(', ')
      }
    }
    if (!raison) continue
    const nouvelles = [...cellules]
    nouvelles[iScore] = String(PLAFOND_PREUVE)
    cellulesPlafonnees.set(index, nouvelles)
    notes.set(index, PLAFOND_PREUVE)
    raisons.push(`${nom} — ${raison}`)
  }
  if (raisons.length === 0) return texte

  const lignes = [...tableau.lignesTexte]
  const positions = tableau.lignes.map((l) => l.index)
  const contenus = positions.map((index) => {
    const plafonnee = cellulesPlafonnees.get(index)
    return { index, texte: plafonnee ? reconstruire(plafonnee) : lignes[index]! }
  })
  // Tri STABLE par note décroissante ; une ligne sans note lisible garde son rang relatif en fin.
  const tries = [...contenus].sort(
    (a, b) => (notes.get(b.index) ?? -1) - (notes.get(a.index) ?? -1)
  )
  positions.forEach((position, rang) => {
    lignes[position] = tries[rang]!.texte
  })
  let fin = Math.max(...positions)
  while ((lignes[fin + 1] ?? '').trim().startsWith('|')) fin += 1
  lignes.splice(
    fin + 1,
    0,
    '',
    `> Note ramenée à ${PLAFOND_PREUVE} par Autowin (plafond de preuve) : ${raisons.join(' ; ')}.`
  )
  return lignes.join('\n')
}

/** Préfixes de commentaire par extension. Une extension inconnue n'a pas de commentaire reconnu. */
function prefixesCommentaire(chemin: string): string[] {
  const ext = /\.([A-Za-z0-9]+)$/u.exec(chemin)?.[1]?.toLowerCase() ?? ''
  if (
    /^(ts|tsx|js|jsx|mjs|cjs|mts|cts|cs|java|c|h|cpp|hpp|cc|go|rs|swift|kt|kts|scss|css|less|php|dart|scala)$/u.test(
      ext
    )
  )
    return ['//', '/*', '*']
  if (/^(py|sh|bash|ps1|psm1|yaml|yml|toml|rb|r|pl|cfg|ini|conf)$/u.test(ext)) return ['#']
  if (/^(lua|luau|sql|hs)$/u.test(ext)) return ['--']
  if (/^(html|htm|xml|xaml|csproj|props|targets|svg|vue)$/u.test(ext)) return ['<!--']
  return []
}

/**
 * Lit un ancrage sur le disque, borné au dossier de travail. Un nom nu ou un chemin relatif à un
 * sous-dossier se résout par la liste des fichiers du dépôt (`git ls-files`) ; sans elle, ou quand le
 * nom est ambigu, l'ancrage est INCONTRÔLABLE — on ne plafonne pas ce qu'on ne sait pas lire.
 */
export function lecteurAncrageDepuisDisque(racine: string): LecteurAncrage {
  const base = resolve(racine)
  let index: string[] | null | undefined
  const fichiersDuDepot = (): string[] | null => {
    if (index !== undefined) return index
    try {
      index = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: base,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
        .split('\n')
        .map((ligne) => ligne.trim())
        .filter(Boolean)
    } catch {
      index = null
    }
    return index
  }
  const dansLaRacine = (absolu: string): boolean => {
    const rel = relative(base, absolu)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }
  const resoudre = (chemin: string): string | 'absent' | 'incontrolable' => {
    const net = chemin.replace(/\\/gu, '/').replace(/^\.\//u, '')
    const direct = isAbsolute(net) ? resolve(net) : resolve(base, net)
    if (!dansLaRacine(direct)) return 'incontrolable'
    if (existsSync(direct) && statSync(direct).isFile()) return direct
    const fichiers = fichiersDuDepot()
    if (!fichiers || isAbsolute(net)) return 'incontrolable'
    const candidats = fichiers.filter((f) => f === net || f.endsWith(`/${net}`))
    if (candidats.length === 1) return join(base, candidats[0]!)
    return candidats.length === 0 ? 'absent' : 'incontrolable'
  }
  return (chemin, ligne) => {
    const fichier = resoudre(chemin)
    if (fichier === 'absent' || fichier === 'incontrolable') return fichier
    let contenu: string
    try {
      contenu = readFileSync(fichier, 'utf8')
    } catch {
      return 'incontrolable'
    }
    const lignes = contenu.split(/\r?\n/u)
    if (contenu.endsWith('\n')) lignes.pop()
    if (ligne < 1 || ligne > lignes.length) return 'hors-fichier'
    const texte = lignes[ligne - 1]!.trim()
    if (!texte) return 'vide'
    return prefixesCommentaire(fichier).some((p) => texte.startsWith(p)) ? 'commentaire' : 'code'
  }
}
