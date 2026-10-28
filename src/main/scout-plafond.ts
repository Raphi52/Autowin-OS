/**
 * LE PLAFOND DE PREUVE DU SCOUT, APPLIQUÉ EN CODE — il n'existait qu'en texte.
 *
 * La consigne dit « un Why DEDUCTIF est plafonné à 50 » (`phase-briefs.ts`). Écrite seule, la règle
 * n'engage rien. Relu dans les traces le 30/09 : conv-812 note 72 une piste dont le Pourquoi dit
 * « Sous réserve : je n'ai cherché que les minuteurs », conv-775 note 60 une piste dont le Pourquoi
 * dit « la cause exacte n'est pas vérifiée », et conv-602 note 88 une piste dont l'ancrage
 * (`Program.cs:300-304`) dit lui-même que la classe citée a disparu — relevé par le run suivant.
 *
 * Trois contrôles de FORME, les seuls falsifiables quand producteur et juge sont le même modèle :
 *  1. le Pourquoi AVOUE ne pas avoir vérifié → la note tombe à 50 ;
 *  2. un CORRECTIF dont aucun ancrage contrôlable ne tombe sur du code vivant (commentaire, ligne
 *     vide, après la fin, fichier introuvable) → la note tombe à 50. « Aucun », pas « un » : un
 *     commentaire cité peut documenter une décision vraie (conv-890 : `orchestrator.ts:1371`) ;
 *  3. le Quoi ou le Pourquoi AFFIRME une absence sans fichier ni commande qui la montre → 50
 *     (conv-339, voir `ABSENCE`).
 *
 * On PLAFONNE, on ne refuse pas : un refus paierait une réparation entière pour une note. La raison
 * est écrite sous le tableau, et le tableau est retrié ; les numéros de ligne ne bougent pas, car la
 * section `## Cible` les cite.
 * fix-ok: `grep plafon src/main` hors tests ne trouvait que phase-briefs.ts (du texte) : aucun code
 * ne tenait la regle ; la regle « aucun ancrage vivant » vient de l'essai sur orchestrator.ts:1371.
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { localiserTableauScout, scoreSur100 } from '../shared/scout-table'
import {
  memeSujetQue,
  pistesDejaLivrees,
  type FacteursChoix,
  type LecteurResultatRun
} from './scout-memoire'

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
const AVEU_NON_VERIFIE = new RegExp(
  [
    String.raw`je n['’]ai pas (?:encore )?(?:v[ée]rifi|mesur|ouvert|lu\b|test)\p{L}*|n['’](?:est|sont) pas (?:encore )?v[ée]rifi\p{L}*|non v[ée]rifi\p{L}*|pas encore v[ée]rifi\p{L}*|sans l['’]avoir v[ée]rifi\p{L}*|(?:^|\s)[àa] v[ée]rifier(?![\p{L}])|\(\s*pas v[ée]rifi\p{L}*|(?:^|[—([]\s*)suppos[ée]\p{L}*|sous r[ée]serve|c['’]est une d[ée]duction|par d[ée]duction`,
    /*
     * Les mêmes aveux en anglais (conv-1197, 2026-10-28) : le scout écrit son Why en anglais quand
     * l'interface l'est, et « I haven't verified » gardait sa note de 80.
     */
    String.raw`\bI\s+(?:have(?:n['’]t|\s+not)|did(?:n['’]t|\s+not))\s+(?:yet\s+)?(?:verif|check|measur|open|read\b|test)\p{L}*`,
    String.raw`\b(?:is|are)(?:n['’]t|\s+not)\s+(?:yet\s+)?(?:verified|checked)\b|\bnot\s+(?:yet\s+)?verified\b|\bunverified\b`,
    String.raw`\bwithout\s+(?:having\s+)?(?:verif|check)\p{L}*|(?:^|\s)to\s+be\s+(?:verified|checked|confirmed)(?![\p{L}])`,
    String.raw`(?:^|[—([]\s*)assum(?:ed|ption)\p{L}*|\bsubject\s+to\s+confirmation|\bit(?:['’]s|\s+is)\s+an?\s+(?:deduction|inference)|\bby\s+(?:deduction|inference)`
  ].join('|'),
  'iu'
)

/**
 * L'EXCEPTION QUE LA CONSIGNE ÉCRIT ET QUE LA GARDE IGNORAIT : « plafonné à 50 TANT QUE les chemins
 * fermés ne sont pas nommés » (`phase-briefs.ts`, règle 4). Un Pourquoi qui dit où il a cherché —
 * « vérifié dans `gates/hooks.ts` » — a nommé ses chemins : son aveu ne le plafonne plus. Il faut un
 * CHEMIN (entre accents graves, ou avec `/` ou une extension) : « vérifié dans le code » ne nomme rien.
 * Une forme NIÉE (« je n'ai pas vérifié dans `a.ts` ») est un aveu, pas un chemin fermé.
 * fix-ok: vrai scout du 30/09 (demande de conv-382), piste 4 ramenée de 70 à 50 alors que son
 * Pourquoi nomme `gates/hooks.ts`, `orchestrator.ts` et `hooks/` : la règle 4 n'était codée qu'à moitié.
 */
// En anglais aussi (conv-1197) : « checked in `gates/hooks.ts` », et « haven't checked in » reste nié.
const CHEMINS_FERMES =
  /(?<!(?:pas|non|jamais|ni|not|never|n['’]t)\s+(?:(?:encore|yet)\s+)?)(?<![\p{L}])(?:v[ée]rifi[ée]e?s?|cherch[ée]e?s?|relu|lu|verified|checked|searched|grepped)\s+(?:dans|sur|in|on)\s+(?:`[^`]+`|[\w.-]*[\\/][\w./\\-]*|[\w-]+\.\w+)/iu

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

/**
 * UNE ABSENCE AFFIRMÉE DOIT ÊTRE MONTRÉE (conv-339). Le juge a refusé deux fois le tableau du scout
 * « humains comme dans Cyberpunk » (notes 66 et 70) pour des absences fausses — « three.js n'a rien
 * de tout fait » (une URL pour seule preuve), « aucun test n'impose ce choix » : deux tours payés.
 * La règle n'existait qu'en prose dans la consigne. Une absence dans le Quoi ou le Pourquoi doit y
 * être MONTRÉE : un fichier (chemin, `fichier.ext` entre accents graves, glob compris) ou la commande
 * qui a cherché. Une URL ne montre rien du dépôt ; « three.js » nu n'est pas un fichier.
 * Limite : on contrôle la PRÉSENCE d'une preuve, pas qu'elle dise vrai (une absence fausse posée à
 * côté d'un ancrage sans rapport passe).
 * fix-ok: lignes réelles de run-f085fcccbb82-1.md (68 et 100 « three.js n'a rien de tout fait »)
 * gardaient leur note ; scout-plafond.test.ts les rejoue, avec la ligne 73 qui montre son fichier.
 */
const ABSENCE =
  /(?<![\p{L}])(?:aucun(?:e|s|es)?|rien|nulle part|n['’]existe(?:nt)? (?:pas|plus)|n['’]y a (?:pas|plus)|nothing|none|nowhere|does(?: not|n['’]t) exist)(?![\p{L}])/iu
const PREUVES_D_ABSENCE = [
  // `chemin/vers/x`, `dossier/`, `fichier.ext`, `fichier.ext:12-30`, `home-decor-*.ts`
  new RegExp(
    String.raw`\x60[\w.*~-]*(?:[\\/][\w.*~-]+)+[\\/]?(?::\d+(?:-\d+)?)?\x60|\x60[\w*~-][\w.*~-]*\.(?:${EXTENSIONS})(?::\d+(?:-\d+)?)?\x60`,
    'iu'
  ),
  // chemin nu avec au moins un dossier, ou `fichier.ext:ligne` nu
  new RegExp(
    String.raw`(?<![\w/.\\-])(?:[\w.-]+[\\/])+[\w*-][\w.*-]*\.(?:${EXTENSIONS})(?![\w])`,
    'iu'
  ),
  new RegExp(String.raw`(?<![\w/.\\-])[\w-][\w.-]*\.(?:${EXTENSIONS}):\d+`, 'iu'),
  // la commande qui a cherché
  /(?<![\w-])(?:grep|rg|ripgrep|findstr|Select-String|git grep|git log -S)(?![\w-])|\x60(?:ls|find|dir|npx|npm|node|wc|cat|tsx|vitest|python)\s[^\x60]+\x60/iu
]

/** Le texte d'une cellule sans ses URL : un lien Markdown garde son libellé, l'adresse disparaît. */
const sansUrl = (cellule: string): string =>
  cellule.replace(/\[([^\]]*)\]\(\s*https?:\/\/[^)]*\)/giu, '$1').replace(/https?:\/\/\S+/giu, ' ')

/** La raison du plafond quand le Quoi ou le Pourquoi affirme une absence sans la montrer. */
function absenceNonMontree(quoi: string, pourquoi: string): string | undefined {
  const cellules = [
    { nom: 'Quoi', texte: sansUrl(quoi) },
    { nom: 'Pourquoi', texte: sansUrl(pourquoi) }
  ]
  if (cellules.some(({ texte }) => PREUVES_D_ABSENCE.some((preuve) => preuve.test(texte)))) {
    return undefined
  }
  for (const { nom, texte } of cellules) {
    const phrase = texte.split(/(?<=[.!?;])\s+/u).find((morceau) => ABSENCE.test(morceau))
    if (!phrase) continue
    const extrait = phrase.trim().replace(/\s+/gu, ' ')
    const court = extrait.length > 90 ? `${extrait.slice(0, 89)}…` : extrait
    return `le ${nom} affirme une absence sans fichier ni commande qui la montre (« ${court} »)`
  }
  return undefined
}

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
    if (!raison) raison = absenceNonMontree(cellules[tableau.colonnes.what] ?? '', pourquoi)
    if (!raison) continue
    const nouvelles = [...cellules]
    nouvelles[iScore] = String(PLAFOND_PREUVE)
    cellulesPlafonnees.set(index, nouvelles)
    notes.set(index, PLAFOND_PREUVE)
    raisons.push(`${nom} — ${raison}`)
  }
  if (raisons.length === 0) return texte
  return reecrireNotes(
    tableau,
    cellulesPlafonnees,
    notes,
    `> Note ramenée à ${PLAFOND_PREUVE} par Autowin (plafond de preuve) : ${raisons.join(' ; ')}.`
  )
}

/** Repère de la ligne écrite sous le tableau : une sortie déjà ajustée ne l'est pas deux fois. */
const MARQUE_AJUSTEMENT = 'Note ajustée sur tes choix réels par Autowin'

/**
 * LA NOTE AJUSTÉE SUR LES CHOIX RÉELS (piste 7 de conv-890) : chaque note est multipliée par le
 * facteur de son type (`facteursDesChoix`, `scout-memoire.ts`), bornée à 0-100, puis le tableau est
 * retrié et le facteur écrit dessous. À appliquer AVANT le plafond de preuve : un aveu reste à 50.
 * fix-ok: sans cette réécriture, le bilan des choix n'était qu'un texte que le modèle pouvait ignorer.
 */
export function ajusterNotesSurChoix(texte: string, facteurs: FacteursChoix): string {
  if (!facteurs.fix && !facteurs.new) return texte
  if ((texte ?? '').includes(MARQUE_AJUSTEMENT)) return texte
  const tableau = localiserTableauScout(texte ?? '')
  if (!tableau || tableau.colonnes.score < 0 || tableau.colonnes.type < 0) return texte
  const { score: iScore, type: iType } = tableau.colonnes
  const notes = new Map<number, number>()
  const cellulesAjustees = new Map<number, string[]>()
  for (const { index, cellules } of tableau.lignes) {
    const note = scoreSur100(cellules[iScore] ?? '')
    if (note === undefined) continue
    notes.set(index, note)
    const typeCellule = cellules[iType] ?? ''
    const type = /🔧|\bfix\b|correctif/iu.test(typeCellule)
      ? 'fix'
      : /🆕|\bnew\b|nouveau/iu.test(typeCellule)
        ? 'new'
        : undefined
    const facteur = type ? facteurs[type] : undefined
    if (!facteur) continue
    const ajustee = Math.min(100, Math.max(0, Math.round(note * facteur)))
    if (ajustee === note) continue
    const nouvelles = [...cellules]
    nouvelles[iScore] = String(ajustee)
    cellulesAjustees.set(index, nouvelles)
    notes.set(index, ajustee)
  }
  if (cellulesAjustees.size === 0) return texte
  const libelle = (cle: 'fix' | 'new', nom: string): string | undefined =>
    facteurs[cle] ? `${nom} ×${String(facteurs[cle]).replace('.', ',')}` : undefined
  const detail = [libelle('fix', '🔧 fix'), libelle('new', '🆕 new')].filter(Boolean).join(', ')
  return reecrireNotes(
    tableau,
    cellulesAjustees,
    notes,
    `> ${MARQUE_AJUSTEMENT} : ${detail} (taux de prise de chaque type rapporté au taux global, sur tes pistes déjà jugées).`
  )
}

/*
 * « DÉJÀ FAIT ? » CONTRÔLÉ EN CODE (piste 4, conv-1033). La règle « réfute avant de rendre » n'était
 * que du texte dans `phase-briefs.ts`. Une piste dont le titre redit un commit récent du dépôt, ou une
 * piste déjà LIVRÉE par un run précédent (`pistesDejaLivrees`), reçoit une marque sous le tableau.
 * Une marque, pas un plafond : deux textes qui partagent leurs mots ne prouvent pas que le travail
 * est fait — c'est le lecteur qui tranche, la ligne lui dit où regarder.
 */
const MARQUE_DEJA_FAIT = 'Déjà fait ? Autowin a trouvé un sujet voisin'

/** Un sujet déjà traité : sa provenance (« commit 398a1b7e », « piste livrée par run-… ») et son texte. */
export interface SujetDejaFait {
  origine: string
  texte: string
}

export function marquerDejaFait(texte: string, faits: readonly SujetDejaFait[]): string {
  if (faits.length === 0 || (texte ?? '').includes(MARQUE_DEJA_FAIT)) return texte
  const tableau = localiserTableauScout(texte ?? '')
  if (!tableau) return texte
  const { what: iWhat, num: iNum } = tableau.colonnes
  const marques: string[] = []
  for (const { cellules } of tableau.lignes) {
    const titre = cellules[iWhat] ?? ''
    const fait = faits.find((f) => f.texte && memeSujetQue(titre, f.texte))
    if (!fait) continue
    const nom = iNum >= 0 ? `ligne ${cellules[iNum]}` : `« ${titre} »`
    const court = fait.texte.length > 80 ? `${fait.texte.slice(0, 79)}…` : fait.texte
    marques.push(`${nom} ↔ ${fait.origine} « ${court} »`)
  }
  if (marques.length === 0) return texte
  const lignes = [...tableau.lignesTexte]
  let fin = Math.max(...tableau.lignes.map((l) => l.index))
  while ((lignes[fin + 1] ?? '').trim().startsWith('|')) fin += 1
  lignes.splice(
    fin + 1,
    0,
    '',
    `> ${MARQUE_DEJA_FAIT} : ${marques.join(' ; ')}. Vérifie avant de la reprendre.`
  )
  return lignes.join('\n')
}

/**
 * Le sujet d'un commit sans ce qui ne dit rien du TRAVAIL : préfixe `type(zone):`, `auto(conv-N):`,
 * `agent run-…:`, suffixe `(conv-N)`, et l'en-tête d'un message de sélection (« Traite ENSEMBLE ces
 * N candidats issus du scout interne d'Autowin : »), qui partage ses mots avec toute piste sur la
 * sélection. Rien ne reste → ''.
 */
export function sujetDeCommit(sujet: string): string {
  return sujet
    .replace(/^\s*agent\s+run-[\w-]+\s*:?\s*/iu, '')
    .replace(/^\s*[a-z]+(?:\([^)]*\))?!?\s*:\s*/iu, '')
    .replace(/\(\s*conv-\d+\s*\)/giu, ' ')
    .replace(
      /(?:\/build\s+)?t?raite\s+(?:ensemble\s+ces\s+\d+\s+candidats|ce\s+candidat)\s+issus?\s+du\s+scout(?:\s+interne)?(?:\s+d['’]autowin)?\s*:?/iu,
      ' '
    )
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Lance `git log` dans un dossier ; `null` en cas d'échec. Injecté pour tester sans git. */
export type LanceurGitLog = (racine: string) => Promise<string | null>

const gitLogRecent: LanceurGitLog = (racine) =>
  new Promise((resoudre) => {
    execFile(
      'git',
      ['log', '--since=30.days', '--no-merges', '--format=%h%x09%s'],
      { ...optionsListeFichiers(resolve(racine)) },
      (erreur, stdout) => resoudre(erreur ? null : String(stdout))
    )
  })

/**
 * Les sujets des commits des 30 derniers jours, nettoyés. ASYNCHRONE à dessein, comme la liste des
 * fichiers (`lecteurAncrageDepuisDisque`) : un `git` synchrone a déjà figé l'app 1,5 s (conv-204).
 */
export async function sujetsDesCommitsRecents(
  racine: string,
  lancer: LanceurGitLog = gitLogRecent
): Promise<SujetDejaFait[]> {
  const sortie = await lancer(racine).catch(() => null)
  if (!sortie) return []
  return sortie
    .split('\n')
    .map((ligne) => /^([0-9a-f]{4,40})\t(.*)$/iu.exec(ligne.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ origine: `commit ${m[1]}`, texte: sujetDeCommit(m[2]!) }))
    .filter((fait) => fait.texte)
}

/**
 * Tout ce qui est déjà traité sur un dépôt : les commits des 30 derniers jours, puis les pistes prises
 * dont le run a LIVRÉ (piste 1). Les commits de sélection ne citent aucune piste (« agent run-…:
 * raite ENSEMBLE ces 8 candidats… ») : sans la mémoire, une piste livrée par l'un d'eux passerait.
 */
export async function sujetsDejaFaits(entree: {
  depot: string
  resultatDuRun?: LecteurResultatRun
  chemin?: string
  lancer?: LanceurGitLog
}): Promise<SujetDejaFait[]> {
  const commits = await sujetsDesCommitsRecents(entree.depot, entree.lancer)
  const livrees = entree.resultatDuRun
    ? pistesDejaLivrees({
        depot: entree.depot,
        resultatDuRun: entree.resultatDuRun,
        ...(entree.chemin ? { chemin: entree.chemin } : {})
      }).map(({ titre, run }) => ({ origine: `piste livrée par ${run}`, texte: titre }))
    : []
  return [...commits, ...livrees]
}

/** Réécrit les lignes modifiées, retrie par note décroissante et ajoute l'explication dessous. */
function reecrireNotes(
  tableau: NonNullable<ReturnType<typeof localiserTableauScout>>,
  cellulesModifiees: Map<number, string[]>,
  notes: Map<number, number>,
  explication: string
): string {
  const lignes = [...tableau.lignesTexte]
  const positions = tableau.lignes.map((l) => l.index)
  const contenus = positions.map((index) => {
    const modifiee = cellulesModifiees.get(index)
    return { index, texte: modifiee ? reconstruire(modifiee) : lignes[index]! }
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
  lignes.splice(fin + 1, 0, '', explication)
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
export function lecteurAncrageDepuisDisque(
  racine: string,
  listeur: ListeurDeFichiers = listeurGit
): LecteurAncrage & { pret: Promise<void> } {
  const base = resolve(racine)
  let index: string[] | null | undefined
  /*
   * PRE-LECTURE ASYNCHRONE — heal conv-204, mesure du 2026-10-10 (`gels.jsonl`, 12:30:43) :
   * `git ls-files` en `execFileSync` a fige l'app 1 502 ms. Le lecteur est cree au debut de
   * l'orchestration et ne sert qu'a la fin d'une phase scout : la liste arrive donc bien avant.
   * Le synchrone ne reste qu'en SECOURS, si elle n'est pas encore revenue — meme reponse qu'avant.
   */
  const pret = listeur.async(base).then(
    (liste) => {
      if (index === undefined) index = liste
    },
    () => {
      /* le secours synchrone repondra, exactement comme avant */
    }
  )
  const fichiersDuDepot = (): string[] | null => {
    if (index === undefined) index = listeur.sync(base)
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
  const lecteur: LecteurAncrage = (chemin, ligne) => {
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
  return Object.assign(lecteur, { pret })
}

/** Comment obtenir la liste des fichiers du depot : en tache de fond, et en secours synchrone. */
export type ListeurDeFichiers = {
  sync: (base: string) => string[] | null
  async: (base: string) => Promise<string[] | null>
}

const ARGS_LISTE_FICHIERS = ['ls-files', '--cached', '--others', '--exclude-standard']
const optionsListeFichiers = (
  base: string
): { cwd: string; encoding: 'utf8'; timeout: number; maxBuffer: number; windowsHide: boolean } => ({
  cwd: base,
  encoding: 'utf8',
  timeout: 5000,
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true
})
const lignesDeFichiers = (sortie: string): string[] =>
  sortie
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter(Boolean)

/** `git ls-files` : memes arguments et memes bornes dans les deux formes. Un echec rend `null`. */
export const listeurGit: ListeurDeFichiers = {
  sync: (base) => {
    try {
      return lignesDeFichiers(
        execFileSync('git', ARGS_LISTE_FICHIERS, {
          ...optionsListeFichiers(base),
          stdio: ['ignore', 'pipe', 'ignore']
        })
      )
    } catch {
      return null
    }
  },
  async: (base) =>
    new Promise((resoudreListe) => {
      execFile('git', ARGS_LISTE_FICHIERS, optionsListeFichiers(base), (erreur, stdout) =>
        resoudreListe(erreur ? null : lignesDeFichiers(String(stdout)))
      )
    })
}
