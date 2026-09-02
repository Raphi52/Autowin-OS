import { isAbsolute, relative, resolve } from 'node:path'

/**
 * COMMANDE `edit_file` — le « chemin du milieu » entre parler et orchestrer.
 *
 * Pourquoi (2026-07-28) : Autowin n'avait que deux regimes. Pour « renomme cette variable », il
 * lançait scout/frame/build/juge. C'est ce qui rendait le travail lourd la-bas et fluide ici : non
 * pas la qualite du modele, mais l'echelle du geste face a l'echelle de la tache.
 *
 * C'est le SEUL point de la journee qui RETIRE un garde-fou (ecrire sans juge). Il n'est donc
 * legitime que parce que l'agent sait desormais VERIFIER (commande `verify`) ce qu'il vient d'ecrire.
 * Toutes les bornes vivent ici, dans une decision PURE et testee — jamais dans un outil du CLI, dont
 * les patterns d'autorisation ont ete mesures INOPERANTS le meme jour (`Bash(npm test)` laissait
 * passer `echo`).
 *
 * Bornes, chacune couverte par un test de refus :
 *   1. le fichier reste DANS le workspace (traversee `..` et chemins absolus exterieurs refuses) ;
 *   2. jamais `.git/` (corromprait le depot), ni un fichier de secrets ;
 *   3. remplacement d'une chaine EXACTE, pas de contenu libre (on ne peut pas ecraser un fichier) ;
 *   4. l'ancienne chaine doit etre presente et UNIQUE (une correspondance ambigue est refusee) ;
 *   5. un seul fichier par appel.
 */

export type EditDecision =
  | {
      allowed: true
      absolutePath: string
      relativePath: string
      oldText: string
      newText: string
      /**
       * VRAI quand la cible est HORS du dossier Autowin (autre dépôt, autre disque). L'appelant doit
       * alors écrire DIRECTEMENT sur le fichier réel : la machinerie de bureau isolé + vérification
       * vitest ne vaut que pour ce dépôt-ci. Voir `commands.ts` (runTracedEditFile).
       */
      externe: boolean
    }
  | { allowed: false; reason: string }

/** Chemins qu'un agent ne doit jamais reecrire, meme dans le workspace. */
const FORBIDDEN_SEGMENTS = ['.git', 'node_modules', 'dist', 'out']
const FORBIDDEN_FILES = [
  '.env',
  'auth.json',
  'settings.json',
  'settings.local.json',
  'credentials.json',
  'id_rsa'
]

/** Réutilisé par la lecture (`read-file-command`) : les zones interdites sont les MÊMES aux deux sens. */
export function isForbidden(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase()
  const segments = normalized.split('/')
  for (const segment of FORBIDDEN_SEGMENTS) {
    if (segments.includes(segment)) return `dossier protégé : ${segment}`
  }
  const fileName = segments[segments.length - 1] ?? ''
  for (const forbidden of FORBIDDEN_FILES) {
    if (fileName === forbidden || fileName.endsWith(`.${forbidden}`)) {
      return `fichier sensible : ${fileName}`
    }
  }
  return undefined
}

/**
 * Decide si une edition est recevable. `readFile` est injecte pour rester pur et testable ; il rend
 * `null` quand le fichier n'existe pas (creer un fichier n'est PAS du ressort de cette commande).
 */
export function decideEdit(
  input: { path?: unknown; oldText?: unknown; newText?: unknown },
  workspace: string | undefined,
  readFile: (absolutePath: string) => string | null
): EditDecision {
  if (!workspace || !workspace.trim()) {
    return { allowed: false, reason: 'aucun workspace résolu' }
  }
  if (typeof input.path !== 'string' || !input.path.trim()) {
    return { allowed: false, reason: 'chemin de fichier manquant' }
  }
  if (typeof input.oldText !== 'string' || input.oldText === '') {
    // Interdire la chaine vide est essentiel : elle « correspondrait » partout.
    return { allowed: false, reason: 'texte à remplacer manquant (une chaîne vide est refusée)' }
  }
  if (typeof input.newText !== 'string') {
    return { allowed: false, reason: 'texte de remplacement manquant' }
  }
  if (input.oldText === input.newText) {
    return { allowed: false, reason: 'aucun changement demandé' }
  }

  /*
   * 1. LOCALISATION DE LA CIBLE — et non plus confinement au seul dossier Autowin.
   *
   * MESURE le 2026-09-02 (conv-12) : l'utilisateur travaillait sur `D:\GIT\RigApplication`, sur SA
   * branche, et a demande la modification de `ULT_TT_INPI.cs` en disant qu'il compilerait et
   * committerait lui-meme. Les QUATRE voies d'ecriture ont ete refusees, dont celle-ci avec
   * « chemin hors du workspace » : quatre appels de modele (~1,06 $) pour finir sur un patch a
   * coller a la main. L'agent LISAIT ce depot sans probleme depuis 20 tours — l'asymetrie
   * lire-partout / ecrire-ici n'etait pas une regle de securite, c'etait le confinement d'origine
   * jamais reconsidere.
   *
   * Un chemin ABSOLU hors du dossier Autowin est donc accepte, et marque `externe`. Ce qui protege
   * reellement reste EN PLACE et vaut pour lui aussi : pas de `.git/`, pas de fichier de secrets,
   * remplacement d'une chaine EXACTE et UNIQUE (donc jamais d'ecrasement ni de creation), refus des
   * fichiers non-UTF-8. Seules les racines SYSTEME restent fermees : elles ne sont le travail de
   * personne et une erreur y casse le poste.
   *
   * Un chemin RELATIF, lui, reste resolu DANS le dossier Autowin et sa traversee `..` reste refusee :
   * un `../x` est une ambiguite (relatif a quoi ?), pas une intention. Pour viser un autre depot, on
   * donne son chemin absolu.
   */
  const relatifDemande = !isAbsolute(input.path)
  const absolutePath = relatifDemande ? resolve(workspace, input.path) : resolve(input.path)
  const relativePath = relative(resolve(workspace), absolutePath)
  const externe = !relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)
  if (externe && relatifDemande) {
    return { allowed: false, reason: 'chemin hors du workspace' }
  }
  if (externe) {
    // Le chemin RESOLU et le chemin DEMANDE sont juges tous les deux : sous Windows, `resolve('/etc/x')`
    // rend `E:\etc\x` (ancre sur le disque courant), donc la racine POSIX ne survit qu'au brut.
    const refusSysteme = refusRacineSysteme(absolutePath) ?? refusRacineSysteme(input.path)
    if (refusSysteme) return { allowed: false, reason: refusSysteme }
  }

  // 2. Zones interdites (les MEMES dedans et dehors).
  const cheminAJuger = externe ? absolutePath : relativePath
  const forbidden = isForbidden(cheminAJuger)
  if (forbidden) return { allowed: false, reason: forbidden }

  // 3-4. Le fichier doit exister, et la correspondance doit etre unique.
  const content = readFile(absolutePath)
  if (content === null) {
    return { allowed: false, reason: 'fichier inexistant (cette commande ne crée pas de fichier)' }
  }
  const occurrences = content.split(input.oldText).length - 1
  if (occurrences === 0) {
    // Un refus doit ENSEIGNER, pas seulement interdire. Constate en usage reel (2026-07-29) :
    // « introuvable » a fait enchainer QUATRE tentatives a l'aveugle, l'agent devinant l'extrait de
    // memoire sans jamais apprendre ce que le fichier contient vraiment. On lui rend donc les lignes
    // REELLES les plus proches : il corrige au coup suivant au lieu de tatonner.
    const hints = nearestLines(content, input.oldText)
    return {
      allowed: false,
      reason: hints
        ? `texte à remplacer introuvable. Lignes réelles les plus proches :\n${hints}`
        : 'texte à remplacer introuvable dans le fichier (relis-le avant de réessayer)'
    }
  }
  if (occurrences > 1) {
    return {
      allowed: false,
      reason:
        `texte présent ${occurrences} fois — ambigu, précise un extrait unique. Occurrences :\n` +
        occurrenceLines(content, input.oldText)
    }
  }

  return {
    allowed: true,
    absolutePath,
    // Hors du dossier Autowin, le chemin RELATIF ne veut rien dire : on rend l'absolu, seul citable.
    relativePath: (externe ? absolutePath : relativePath).replace(/\\/g, '/'),
    oldText: input.oldText,
    newText: input.newText,
    externe
  }
}

/**
 * RACINES SYSTEME — les seules fermees a l'ecriture hors du dossier Autowin.
 *
 * Elles ne sont le travail de personne (aucun depot, aucune fiche) et une edition ratee y casse le
 * poste ou l'installation d'un logiciel. Le refus est explicite : il ENSEIGNE, comme les autres.
 */
const RACINES_SYSTEME = [
  'c:/windows',
  'c:/program files',
  'c:/program files (x86)',
  'c:/programdata',
  '/etc',
  '/bin',
  '/sbin',
  '/usr/bin',
  '/system',
  '/library'
]

export function refusRacineSysteme(absolutePath: string): string | undefined {
  const normalise = absolutePath.replace(/\\/g, '/').toLowerCase()
  for (const racine of RACINES_SYSTEME) {
    if (normalise === racine || normalise.startsWith(`${racine}/`)) {
      return `racine système protégée : ${racine} — édition refusée (aucun dépôt de travail n'y vit)`
    }
  }
  return undefined
}

/** Premiere ligne non vide d'un extrait — la plus discriminante pour retrouver la zone visee. */
function anchorLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  )
}

/** Longueur du plus long prefixe commun : mesure de proximite suffisante, sans dependance. */
function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  return i
}

/**
 * Rend les lignes du fichier les plus PROCHES de l'extrait demande, avec leur numero. C'est ce qui
 * transforme un refus en information exploitable : l'agent voit l'ecart exact (un espace, une
 * apostrophe, un renommage) au lieu de re-deviner.
 */
export function nearestLines(content: string, wanted: string, limit = 3): string {
  const anchor = anchorLine(wanted)
  if (!anchor) return ''
  const needle = anchor.replace(/\s+/g, ' ').toLowerCase()
  const scored = content.split(/\r?\n/).map((line, index) => {
    const normalized = line.replace(/\s+/g, ' ').trim().toLowerCase()
    // Une ligne qui CONTIENT l'ancre est le meilleur indice ; sinon on classe par prefixe commun.
    const score = normalized.includes(needle) ? 10_000 : commonPrefix(normalized, needle)
    return { line, index, score }
  })
  const best = scored
    .filter((entry) => entry.score >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  if (best.length === 0) return ''
  return best
    .sort((a, b) => a.index - b.index)
    .map((entry) => `  ${entry.index + 1}: ${entry.line.trim().slice(0, 160)}`)
    .join('\n')
}

/** Numeros de ligne des occurrences d'un extrait ambigu — pour choisir laquelle viser. */
export function occurrenceLines(content: string, wanted: string, limit = 5): string {
  const anchor = anchorLine(wanted)
  const lines = content.split(/\r?\n/)
  const found: string[] = []
  for (let i = 0; i < lines.length && found.length < limit; i += 1) {
    if (anchor && lines[i].includes(anchor))
      found.push(`  ${i + 1}: ${lines[i].trim().slice(0, 160)}`)
  }
  return found.join('\n')
}

/** Diff minimal, lisible dans le fil : ce qui part, ce qui arrive. */
export function editDiff(oldText: string, newText: string): string {
  const removed = oldText.split('\n').map((line) => `- ${line}`)
  const added = newText.split('\n').map((line) => `+ ${line}`)
  return [...removed, ...added].join('\n')
}

/** Applique le remplacement UNIQUE déjà validé. Pur : rend le nouveau contenu. */
export function applyEdit(content: string, oldText: string, newText: string): string {
  const index = content.indexOf(oldText)
  if (index < 0) return content
  return content.slice(0, index) + newText + content.slice(index + oldText.length)
}

/**
 * REFUSE une edition sur un fichier qui n'est pas de l'UTF-8 valide.
 *
 * MESURE le 2026-08-27 sur les octets reels : `readFileSync(p).toString('utf8')` ne JETTE pas sur
 * une entree invalide — Node substitue U+FFFD. Un fichier cp1252 (`e9` pour « é ») reecrit ensuite
 * en utf8 ressortait donc en `ef bf bd` : chaque octet non-UTF-8 du fichier etait DETRUIT, y compris
 * TRES LOIN de la zone editee, et le bureau isole publiait la corruption dans le depot.
 *   avant : 2f2f2063616c63756c **e9** 20766965757820666963686965720d0a
 *   apres : 2f2f2063616c63756c **efbfbd** 206e65756620666963686965720d0a
 *
 * POURQUOI REFUSER plutot que preserver l'encodage : preserver imposerait de DEVINER le jeu de
 * caracteres (aucun n'est marque dans le fichier), et l'`oldText` fourni par le modele est de
 * l'UTF-8 — le faire correspondre a un contenu transcode ajoute une seconde devinette. Une
 * substitution silencieuse sur une DEVINETTE est exactement le defaut qu'on corrige. Le refus est
 * exact, sans perte, et il ENSEIGNE (comme les autres refus de cette commande) : l'agent sait quoi
 * faire ensuite. Il ecarte au passage les fichiers BINAIRES, qu'une edition texte detruit toujours.
 *
 * Le decodeur est en mode `fatal` : il distingue un octet reellement invalide d'un U+FFFD
 * LEGITIMEMENT encode (ef bf bd) dans un fichier UTF-8 valide, que le seul test de presence du
 * caractere de remplacement confondrait — et ferait refuser a tort.
 */
export function refusSiPasUtf8(octets: Uint8Array, relativePath: string): string | undefined {
  if (decoderUtf8(octets).valide) return undefined
  return (
    `contenu non UTF-8 : ${relativePath} contient des octets qu'une écriture UTF-8 détruirait ` +
    `(fichier en encodage hérité type cp1252/latin-1, ou binaire). Édition refusée pour ne pas ` +
    `corrompre le reste du fichier — convertis-le en UTF-8 d'abord, ou modifie-le autrement.`
  )
}

/**
 * DECODE en UTF-8 en DISANT si l'entree l'etait vraiment.
 *
 * Meme mesure que ci-dessus, cote LECTURE : `readFileSync(p, 'utf8')` rend un texte ou chaque octet
 * invalide est devenu `�`, sans le moindre signal. Rien n'est detruit sur le disque, mais le
 * modele recoit une ligne FAUSSE presentee comme le contenu du fichier — et il peut ensuite batir un
 * `oldText` dessus. On rend donc le texte (les lignes ASCII restent vraies et utiles) ET le drapeau :
 * une lecture qui ment doit le DIRE, c'est moins couteux que de la refuser et plus honnete que de la
 * taire. La double passe (stricte puis indulgente) ne s'execute que sur l'entree invalide.
 */
export function decoderUtf8(octets: Uint8Array): { texte: string; valide: boolean } {
  try {
    return { texte: new TextDecoder('utf-8', { fatal: true }).decode(octets), valide: true }
  } catch {
    return { texte: new TextDecoder('utf-8').decode(octets), valide: false }
  }
}
