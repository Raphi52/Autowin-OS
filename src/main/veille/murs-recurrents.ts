import type { ConstatInterne, FichierAudite } from './audit-interne'

/**
 * LES MURS QUI REVIENNENT D'UN FIL À L'AUTRE — des défauts MESURÉS, à la place des idées que chaque
 * scout réinvente.
 *
 * Le registre des murs (`murs-rencontres.json`, tenu par `runs/murs-store.ts`) garde, par fil, les
 * erreurs d'outil qu'un agent a rencontrées. Il n'était relu qu'à l'intérieur d'un même fil
 * (`etat-du-tour.ts`) ; entre les fils, seul le diagnostic du poste (`scripts/doctor.mjs`,
 * `refusRecents`) le regroupait, et pour les seuls refus de permission. Mesuré le 2026-11-13 :
 * 40 signatures d'erreur reviennent chacune dans au moins 4 fils (`verify` dans 27,
 * `desktop_act` « keys doit contenir entre … touches » dans 21), et aucun scout ne les voyait.
 *
 * UN MUR NE DEVIENT CANDIDAT QUE S'IL SORT DU CODE D'AUTOWIN : son message est retrouvé dans une
 * ligne de `src/` ou `scripts/`, qui devient l'ancrage `fichier:ligne` exigé par la veille. Un test
 * rouge ou une sortie de PowerShell, rejoués tels quels par un outil, ne se retrouvent dans aucune
 * ligne du dépôt : ce sont les murs du travail de l'agent, pas d'Autowin, et ils restent dehors.
 * Corriger le message (ou retirer la garde) fait disparaître l'ancrage, donc le candidat.
 *
 * Limite connue : une sortie de test qui RECOPIE un message d'Autowin (une attente
 * `toThrow('conversation introuvable: …')` en échec) s'ancrerait sur la ligne qui le produit, et
 * accuserait l'outil d'une erreur du travail de l'agent. Sur le registre du 2026-11-13, aucun des
 * 5 ancrages n'était dans ce cas ; le juge du candidat (« vérifie d'abord que le défaut est réel »,
 * `passe.ts`) reste le filet.
 */

/** À partir de combien de fils un mur est un défaut, et non un accident d'un fil. */
export const SEUIL_DE_FILS = 4

/** Les fils les plus récents relus, comme `refusRecents` : un vieux mur corrigé finit par sortir. */
export const FILS_RELUS = 100

/** Le registre tel qu'écrit sur le disque : par fil, des signatures seules ou datées. */
export type RegistreDesMurs = Readonly<Record<string, unknown>>

export interface MurRecurrent {
  /** `outil::message normalisé` (`signatureDEchec`, `chat-turn-messages.ts`). */
  signature: string
  /** Nombre de fils, parmi les plus récents, où il est apparu. */
  fils: number
}

/** La signature d'une entrée : une chaîne (ancien format) ou `{ signature, derniereFois }`. */
function signatureDe(entree: unknown): string | undefined {
  if (typeof entree === 'string') return entree || undefined
  if (entree && typeof entree === 'object' && 'signature' in entree) {
    const { signature } = entree as { signature: unknown }
    return typeof signature === 'string' && signature ? signature : undefined
  }
  return undefined
}

/**
 * Les murs vus dans au moins `seuil` des `fils` fils les plus récents, du plus fréquent au moins
 * fréquent. Le registre n'est pas daté pour ses anciennes entrées, mais ses clés sont des `conv-N` :
 * le rang tient lieu de date. Une entrée illisible est ignorée, jamais devinée.
 */
export function mursRecurrents(
  registre: RegistreDesMurs,
  options: { seuil?: number; fils?: number } = {}
): MurRecurrent[] {
  const seuil = options.seuil ?? SEUIL_DE_FILS
  const rang = (id: string): number => Number(/(\d+)$/u.exec(id)?.[1] ?? 0)
  const recents = Object.keys(registre)
    .sort((a, b) => rang(b) - rang(a))
    .slice(0, options.fils ?? FILS_RELUS)
  const comptes = new Map<string, number>()
  for (const id of recents) {
    const entrees = registre[id]
    if (!Array.isArray(entrees)) continue
    const signatures = new Set(entrees.map(signatureDe).filter((s): s is string => s !== undefined))
    for (const signature of signatures) comptes.set(signature, (comptes.get(signature) ?? 0) + 1)
  }
  return [...comptes]
    .filter(([, n]) => n >= seuil)
    .map(([signature, fils]) => ({ signature, fils }))
    .sort((a, b) => b.fils - a.fils || a.signature.localeCompare(b.signature))
}

/** En deçà, un fragment (« allowed », « false ») se retrouve partout et n'ancre rien. */
const FRAGMENT_MINIMUM = 12

/**
 * Les morceaux de texte littéral du message, dans l'ordre : le premier est la TÊTE du message. Chaque
 * morceau rend ses suites d'au moins deux mots consécutifs, de la plus longue à la plus courte : le
 * message est tronqué par les deux bouts (`début…fin`, mots coupés compris), et un préfixe ajouté par
 * l'appelant (`plan_de_lots : …`) ou une interpolation (`${id}`) ne sont pas dans la ligne du dépôt.
 */
export function morceauxDuMessage(message: string): string[][] {
  return message
    .split(/…|<n>|<chemin>|<fichier>|["{}[\],]|\\[nrt]/u)
    .map((morceau) => morceau.trim().split(/\s+/u).filter(Boolean))
    .map((mots) => {
      const suites: string[] = []
      for (let debut = 0; debut < mots.length; debut += 1)
        for (let fin = debut + 2; fin <= mots.length; fin += 1) {
          const suite = mots.slice(debut, fin).join(' ')
          if (suite.length >= FRAGMENT_MINIMUM) suites.push(suite)
        }
      return [...new Set(suites)].sort((a, b) => b.length - a.length)
    })
    .filter((suites) => suites.length > 0)
}

/** Une ligne de commentaire cite souvent un message : seule la ligne qui le PRODUIT ancre le mur. */
const COMMENTAIRE = /^\s*(?:\*|\/\/|\/\*)/u

/** Part minimale de la tête du message que la ligne doit porter d'un seul tenant. */
const RECOUVREMENT_DE_LA_TETE = 0.5

/**
 * La position tombe-t-elle dans une chaîne de caractères ouverte sur cette ligne ? Un message
 * d'outil s'écrit dans une chaîne ; une déclaration de type citée par une erreur de typage, non.
 */
function dansUneChaine(ligne: string, position: number): boolean {
  let ouverte: string | undefined
  for (let i = 0; i < position; i += 1) {
    const c = ligne[i]
    if (c === '\\') i += 1
    else if (ouverte) {
      if (c === ouverte) ouverte = undefined
    } else if (c === "'" || c === '"' || c === '`') ouverte = c
  }
  return ouverte !== undefined
}

/** Les fichiers où un message d'outil est produit : le code, ni ses tests ni ses styles. */
const estDuCode = (chemin: string): boolean =>
  /\.(?:ts|tsx|mjs)$/u.test(chemin) && !/\.test\.|test-helpers/u.test(chemin)

/**
 * Le code mis en minuscules UNE fois, dans un seul texte où chaque fichier commence à `debut`.
 * La passe tourne dans le processus principal : relire et abaisser chaque ligne pour chaque mur
 * coûtait 2 s par passe (mesuré sur ce dépôt, 4 033 fichiers) ; index et recherche, ~0,3 s.
 */
export interface CodeIndexe {
  bas: string
  fichiers: Array<{ chemin: string; debut: number; lignes: string[]; departs: number[] }>
}

export function indexerLeCode(fichiers: readonly FichierAudite[]): CodeIndexe {
  const code = fichiers
    .filter((f) => estDuCode(f.chemin))
    .sort(
      (a, b) =>
        Number(!a.chemin.startsWith('src/')) - Number(!b.chemin.startsWith('src/')) ||
        a.chemin.localeCompare(b.chemin)
    )
  const morceaux: string[] = []
  const index: CodeIndexe['fichiers'] = []
  let position = 0
  for (const fichier of code) {
    const lignes = fichier.contenu.split(/\r?\n/u)
    // Les mêmes minuscules que `signatureDEchec` (`toLowerCase`). Une lettre dont la minuscule change
    // de longueur décalerait les lignes suivantes : le fichier est alors abaissé ligne par ligne.
    const entier = lignes.join('\n')
    const bas = entier.toLowerCase()
    const basses = bas.length === entier.length ? undefined : lignes.map((l) => l.toLowerCase())
    const departs: number[] = []
    const debut = position
    for (let i = 0; i < lignes.length; i += 1) {
      departs.push(position)
      position += (basses ? basses[i]! : lignes[i]!).length + 1
    }
    morceaux.push(basses ? basses.join('\n') : bas, '\n')
    index.push({ chemin: fichier.chemin, debut, lignes, departs })
  }
  return { bas: morceaux.join(''), fichiers: index }
}

/** Le dernier élément de `triee` inférieur ou égal à `valeur` (recherche dichotomique). */
function rangAvant(triee: readonly number[], valeur: number): number {
  let bas = 0
  let haut = triee.length - 1
  while (bas < haut) {
    const milieu = (bas + haut + 1) >> 1
    if (triee[milieu]! <= valeur) bas = milieu
    else haut = milieu - 1
  }
  return bas
}

/**
 * La ligne du dépôt qui produit ce message, ou `undefined`.
 *
 * Trois conditions, chacune mesurée sur le vrai registre le 2026-11-13 :
 *  - la ligne porte la TÊTE du message : le refus de `bureau_cache_agir`, écrit par un script
 *    PowerShell que la veille ne lit pas, s'ancrait sinon sur une autre phrase finie par « dans ce
 *    bureau. » ;
 *  - d'un seul tenant, au moins la moitié de cette tête : une erreur de typage (« does not exist on
 *    type … ») s'ancrait sinon sur une phrase anglaise qui partage « does not exist » ;
 *  - dans une chaîne de caractères : une erreur de typage qui cite un type d'Autowin
 *    (`onOuvrirLot: (rang: number) => void`) s'ancrait sinon sur sa déclaration.
 * Parmi les lignes qui passent, celle qui recouvre le plus du message gagne ; à égalité, `src/` passe
 * devant `scripts/`, puis l'ordre des chemins tranche.
 */
export function ligneQuiProduit(
  signature: string,
  fichiers: readonly FichierAudite[],
  code: CodeIndexe = indexerLeCode(fichiers)
): { chemin: string; ligne: number; texte: string; tete: string } | undefined {
  const [tete, ...reste] = morceauxDuMessage(signature.slice(signature.indexOf('::') + 2))
  if (!tete) return undefined
  const valables = tete.filter((suite) => suite.length >= tete[0]!.length * RECOUVREMENT_DE_LA_TETE)
  // Une ligne qui porte une suite valable porte aussi les plus courtes qu'elle contient : chercher
  // les seules suites minimales trouve les mêmes lignes, en bien moins de passages sur le texte.
  const minimales = valables.filter((s) => !valables.some((t) => t !== s && s.includes(t)))
  // Les lignes candidates, repérées par leur position : l'ordre des fichiers (`src/` d'abord, puis
  // l'ordre des chemins) départage les égalités.
  const candidates = new Map<number, [fichier: number, ligne: number]>()
  const debuts = code.fichiers.map((x) => x.debut)
  for (const suite of minimales) {
    for (let pos = code.bas.indexOf(suite); pos >= 0; pos = code.bas.indexOf(suite, pos + 1)) {
      const f = rangAvant(debuts, pos)
      const l = rangAvant(code.fichiers[f]!.departs, pos)
      candidates.set(code.fichiers[f]!.departs[l]!, [f, l])
    }
  }
  let meilleure: { position: number; f: number; l: number; score: number } | undefined
  for (const [position, [f, l]] of candidates) {
    const texte = code.fichiers[f]!.lignes[l]!
    if (COMMENTAIRE.test(texte)) continue
    const bas = texte.toLowerCase()
    const dansLaTete = valables.find(
      (suite) => bas.includes(suite) && dansUneChaine(bas, bas.indexOf(suite))
    )
    if (!dansLaTete) continue
    const score =
      dansLaTete.length +
      reste.reduce((total, suites) => total + (suites.find((s) => bas.includes(s))?.length ?? 0), 0)
    if (
      !meilleure ||
      score > meilleure.score ||
      (score === meilleure.score && position < meilleure.position)
    )
      meilleure = { position, f, l, score }
  }
  if (!meilleure) return undefined
  const fichier = code.fichiers[meilleure.f]!
  return {
    chemin: fichier.chemin,
    ligne: meilleure.l + 1,
    texte: fichier.lignes[meilleure.l]!,
    tete: tete[0]!.replace(/^[\s:;,.—-]+|[\s:;,—-]+$/gu, '')
  }
}

/** Au-delà, le titre ne tient plus sur une ligne de la colonne. */
const MESSAGE_DANS_LE_TITRE = 70

/**
 * Les murs récurrents ancrés dans le code d'Autowin, au format des détecteurs de `audit-interne`.
 * Le titre ne porte pas le nombre de fils : il change à chaque passe, et la déduplication de la
 * veille compare les titres (`clesCandidat`).
 */
export function constatsDesMurs(
  registre: RegistreDesMurs,
  fichiers: readonly FichierAudite[],
  options: { seuil?: number; fils?: number } = {}
): ConstatInterne[] {
  const relus = options.fils ?? FILS_RELUS
  const recurrents = mursRecurrents(registre, options)
  // Indexé seulement s'il y a un mur à ancrer : sans registre, la passe ne paie rien.
  const code = recurrents.length ? indexerLeCode(fichiers) : undefined
  return recurrents.flatMap(({ signature, fils }) => {
    const ancre = code && ligneQuiProduit(signature, fichiers, code)
    if (!ancre) return []
    const outil = signature.slice(0, signature.indexOf('::'))
    // La tête du message plutôt que le message brut : un résultat JSON commence par ses clés.
    const court =
      ancre.tete.length > MESSAGE_DANS_LE_TITRE
        ? `${ancre.tete.slice(0, MESSAGE_DANS_LE_TITRE - 1)}…`
        : ancre.tete
    return [
      {
        classe: 'mur-recurrent' as const,
        titre: `L'outil « ${outil} » bute au même endroit dans plusieurs fils : « ${court} »`,
        ancrage: `${ancre.chemin}:${ancre.ligne}`,
        citation: ancre.texte.trim(),
        // Le registre ne garde que les fils qui ont buté sur un outil : le compte se dit tel quel.
        consequence: `${fils} des ${relus} derniers fils qui ont buté sur un outil ont reçu cette erreur : soit le geste est légitime et la garde est à assouplir, soit la description de l'outil laisse l'agent le tenter et c'est elle qu'il faut corriger.`,
        effort: 'petit' as const,
        valeur: fils >= 10 ? ('forte' as const) : ('moyenne' as const)
      }
    ]
  })
}
