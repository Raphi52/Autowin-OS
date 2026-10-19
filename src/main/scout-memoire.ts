/**
 * LA MÉMOIRE DES PISTES DÉJÀ PROPOSÉES PAR UN SCOUT — pour qu'un scout ne refasse pas le précédent.
 *
 * Relu dans les traces le 30/09 : conv-616 et conv-624, lancés à 2 h 37 d'écart (horodatage de leurs
 * dossiers de run) sur le même sujet, reprennent 3 pistes sur 8 — écriture du cache (616 n°5 / 624
 * n°6), tri des conversations (n°2 / n°3), préfixe du juge (n°3 / n°2). La
 * mémoire anti-doublon EXISTAIT, mais pour la veille seule : `veille/scout-visible.ts` relit le stock
 * `veille-candidats.json` (écartées comprises) et passe les titres à `construirePromptScoutInterne`.
 * Or seuls `veille/passe.ts` et `veille/veille-ipc.ts` écrivent ce stock : les scouts du chat n'y
 * laissent rien, et n'en lisent rien.
 *
 * D'où un petit historique LOCAL (même patron que `veille/candidats-store.ts` : JSON dans la racine de
 * données, écrit dans un temporaire puis renommé), clé par dépôt, et la même borne de 60 titres que
 * le scout de la veille. Pas de relecture des traces des runs : 670 traces pour 225 Mo, et les
 * anciennes ne gardent pas le texte du scout.
 * fix-ok: seuls veille/passe.ts et veille/veille-ipc.ts ecrivent `veille-candidats.json` (5 pistes
 * dans le stock reel) ; conv-616/624 sont des scouts du chat, que ce stock n'a jamais vus.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { parseScoutTable } from '../shared/scout-table'
import { lireStockVeille } from './veille/candidats-store'

/** Même borne que le scout de la veille (`veille/scout-interne.ts`, `dejaConnus.slice(0, 60)`). */
export const MAX_PISTES_CONNUES = 60
/** Au-delà, les plus anciennes sortent : un historique qui grossit sans fin coûte à chaque scout. */
const MAX_ENTREES = 600
const MAX_TITRE = 160

export interface EntreeMemoireScout {
  depot: string
  titre: string
  vuLe: string
  run: string
  /** La note du tableau, quand elle est lisible : c'est ce que le bilan des choix confronte. */
  note?: number
  type?: 'fix' | 'new'
  /** Ce que l'utilisateur en a fait, lu dans le message de sélection du run suivant. */
  choix?: 'prise' | 'laissee'
}

export interface MemoireScout {
  entrees: EntreeMemoireScout[]
}

export function cheminMemoireScout(): string {
  return join(ensureAutowinAppData(), 'scout-pistes.json')
}

/** Un dépôt se reconnaît quelle que soit l'écriture du chemin (casse Windows, barres, fin). */
export function cleDepot(depot: string): string {
  return resolve(depot).replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase()
}

const cleTitre = (titre: string): string =>
  titre
    .replace(/[*`]/gu, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()

/** Relit l'historique. Absent ou illisible → vide, jamais une exception. */
export function lireMemoireScout(chemin = cheminMemoireScout()): MemoireScout {
  if (!existsSync(chemin)) return { entrees: [] }
  try {
    const brut = JSON.parse(readFileSync(chemin, 'utf8')) as Partial<MemoireScout> | null
    const entrees = Array.isArray(brut?.entrees) ? brut.entrees : []
    return {
      entrees: entrees.filter(
        (e): e is EntreeMemoireScout =>
          !!e &&
          typeof e.depot === 'string' &&
          typeof e.titre === 'string' &&
          typeof e.vuLe === 'string'
      )
    }
  } catch {
    // Un JSON corrompu ne bloque pas le scout ; le fichier reste sur le disque, la prochaine
    // écriture le remplace.
    return { entrees: [] }
  }
}

/** Verse les titres du tableau d'une sortie de scout dans l'historique. Sans tableau : rien. */
export function noterPistesScout(entree: {
  depot: string
  texte: string
  run: string
  maintenant: string
  chemin?: string
}): void {
  const lignes = parseScoutTable(entree.texte ?? '')
  if (!lignes) return
  const depot = cleDepot(entree.depot)
  const ajouts: EntreeMemoireScout[] = lignes
    .map((ligne) => ({
      depot,
      titre: ligne.what.replace(/\s+/gu, ' ').trim().slice(0, MAX_TITRE),
      vuLe: entree.maintenant,
      run: entree.run,
      ...(ligne.score !== undefined ? { note: ligne.score } : {}),
      ...(ligne.type ? { type: ligne.type } : {})
    }))
    .filter((e) => e.titre)
  if (ajouts.length === 0) return
  const chemin = entree.chemin ?? cheminMemoireScout()
  const memoire = lireMemoireScout(chemin)
  ecrireMemoireScout(chemin, [...memoire.entrees, ...ajouts])
}

function ecrireMemoireScout(chemin: string, entrees: EntreeMemoireScout[]): void {
  mkdirSync(dirname(chemin), { recursive: true })
  const temporaire = `${chemin}.tmp`
  writeFileSync(
    temporaire,
    JSON.stringify({ entrees: entrees.slice(-MAX_ENTREES) }, null, 2),
    'utf8'
  )
  renameSync(temporaire, chemin)
}

/**
 * L'en-tête du message de sélection (`redigerPromptWorkflowSelection`, `veille-candidats-message.ts`).
 * Le « T » est facultatif : la demande de conv-890 est arrivée en « raite ENSEMBLE… », collée sans
 * sa première lettre.
 */
const ENTETE_SELECTION =
  /(?:^|\n)\s*(?:t[âa]che\s*:\s*)?t?raite\s+(?:ensemble\s+ces\s+\d+\s+candidats|ce\s+candidat)\s+issus?\s+du\s+scout/iu

/**
 * Les pistes PRISES, lues dans un message de sélection : ses lignes « Quoi : », sinon ses lignes
 * numérotées sans leurs suffixes (« — ancrage », « — preuve », « — pertinence »). Une demande libre
 * n'est pas une sélection : liste vide.
 */
export function titresChoisisDansLaDemande(demande: string): string[] {
  const texte = demande ?? ''
  if (!ENTETE_SELECTION.test(texte)) return []
  const nettoyer = (brut: string): string => brut.replace(/\*\*/gu, '').replace(/\s+/gu, ' ').trim()
  const quoi = [...texte.matchAll(/^\s+Quoi : (.+)$/gmu)].map((m) => nettoyer(m[1]!))
  if (quoi.length > 0) return quoi.filter(Boolean)
  return [...texte.matchAll(/^\d+\.\s+(.+)$/gmu)]
    .map((m) => nettoyer(m[1]!.split(/ — (?:ancrage|preuve|pertinence)\b/u)[0]!))
    .filter(Boolean)
}

/** Même piste : titres égaux, ou titre gardé TRONQUÉ (`MAX_TITRE`) qui ouvre la piste prise. */
function memePiste(prise: string, gardee: string): boolean {
  const a = cleTitre(prise)
  const b = cleTitre(gardee)
  if (!a || !b) return false
  return a === b || (b.length >= MAX_TITRE - 10 && a.startsWith(b))
}

/**
 * Note ce que l'utilisateur a fait des pistes : sur le DERNIER scout de ce dépôt qui proposait au
 * moins une piste prise, chaque piste devient « prise » ou « laissee ». Demande libre, ou aucun
 * scout connu qui la proposait : rien n'est écrit.
 */
export function noterChoixScout(entree: {
  depot: string
  demande: string
  maintenant: string
  chemin?: string
}): void {
  const prises = titresChoisisDansLaDemande(entree.demande)
  if (prises.length === 0) return
  const chemin = entree.chemin ?? cheminMemoireScout()
  const depot = cleDepot(entree.depot)
  const memoire = lireMemoireScout(chemin)
  const source = memoire.entrees
    .filter((e) => e.depot === depot && prises.some((p) => memePiste(p, e.titre)))
    .sort((a, b) => b.vuLe.localeCompare(a.vuLe))[0]
  if (!source) return
  const entrees = memoire.entrees.map((e): EntreeMemoireScout => {
    if (e.depot !== depot || e.run !== source.run) return e
    return { ...e, choix: prises.some((p) => memePiste(p, e.titre)) ? 'prise' : 'laissee' }
  })
  ecrireMemoireScout(chemin, entrees)
}

/** En dessous, un taux de prise est du bruit : le bilan se tait plutôt que d'orienter sur 2 cas. */
export const MIN_PISTES_JUGEES = 5

/**
 * Le bilan des choix RÉELS sur ce dépôt, rendu au scout suivant : combien de pistes sont prises, la
 * note moyenne des prises face à celle des laissées, et le taux de prise par type. C'est la note
 * « ajustée sur ce que l'utilisateur choisit vraiment » (piste 7 de conv-890) : le scout reçoit la
 * mesure, au lieu de noter sur son seul avis. Moins de `MIN_PISTES_JUGEES` : chaîne vide.
 */
export function bilanDesChoix(entree: { depot: string; chemin?: string }): string {
  const depot = cleDepot(entree.depot)
  const jugees = lireMemoireScout(entree.chemin ?? cheminMemoireScout()).entrees.filter(
    (e) => e.depot === depot && e.choix
  )
  if (jugees.length < MIN_PISTES_JUGEES) return ''
  const prises = jugees.filter((e) => e.choix === 'prise')
  const laissees = jugees.filter((e) => e.choix === 'laissee')
  const moyenne = (liste: EntreeMemoireScout[]): string => {
    const notes = liste.map((e) => e.note).filter((n): n is number => typeof n === 'number')
    return notes.length ? String(Math.round(notes.reduce((a, b) => a + b, 0) / notes.length)) : '—'
  }
  const parType = (type: 'fix' | 'new', libelle: string): string | undefined => {
    const du = jugees.filter((e) => e.type === type)
    return du.length
      ? `${libelle} ${du.filter((e) => e.choix === 'prise').length}/${du.length}`
      : undefined
  }
  const types = [parType('fix', '🔧 fix'), parType('new', '🆕 new')].filter(Boolean).join(', ')
  const faits = [
    `TES CHOIX RÉELS sur ce dépôt (${jugees.length} pistes jugées) : ${prises.length} prises sur ${jugees.length}`,
    `note moyenne des prises ${moyenne(prises)}, des laissées ${moyenne(laissees)}`,
    ...(types ? [`prises par type : ${types}`] : [])
  ]
  return (
    faits.join(' ; ') +
    ". Note d'après ce qui est réellement pris : une piste du genre de celles laissées ne passe pas devant."
  )
}

/** En dessous, le taux de prise d'UN type est du bruit : ce type garde la note du modèle. */
export const MIN_PISTES_PAR_TYPE = 3

export type FacteursChoix = Partial<Record<'fix' | 'new', number>>

/**
 * LA NOTE AJUSTÉE SUR CE QUE L'UTILISATEUR PREND (piste 7 de conv-890, à la lettre) : pour chaque
 * type, son taux de prise rapporté au taux global, tous deux lissés (+1 / +2) pour qu'un petit
 * échantillon ne pèse pas comme un grand. Borné à [0,5 ; 1,5] ; un écart de moins de 5 % est omis.
 * Tout pris, ou rien : les choix ne départagent rien, aucun facteur.
 * fix-ok: le bilan (`bilanDesChoix`) n'était qu'un texte remis au modèle : la note restait SON avis
 * (objection du juge, conv-890) ; ce facteur est appliqué en code par `ajusterNotesSurChoix`.
 */
export function facteursDesChoix(entree: { depot: string; chemin?: string }): FacteursChoix {
  const depot = cleDepot(entree.depot)
  const jugees = lireMemoireScout(entree.chemin ?? cheminMemoireScout()).entrees.filter(
    (e) => e.depot === depot && e.choix
  )
  const prises = jugees.filter((e) => e.choix === 'prise').length
  if (jugees.length < MIN_PISTES_JUGEES || prises === 0 || prises === jugees.length) return {}
  const lisse = (pris: number, total: number): number => (pris + 1) / (total + 2)
  const global = lisse(prises, jugees.length)
  const facteurs: FacteursChoix = {}
  for (const type of ['fix', 'new'] as const) {
    const du = jugees.filter((e) => e.type === type)
    if (du.length < MIN_PISTES_PAR_TYPE) continue
    const brut = lisse(du.filter((e) => e.choix === 'prise').length, du.length) / global
    const facteur = Math.round(Math.min(1.5, Math.max(0.5, brut)) * 100) / 100
    if (Math.abs(facteur - 1) >= 0.05) facteurs[type] = facteur
  }
  return facteurs
}

/**
 * Les titres déjà proposés sur CE dépôt, le plus récent d'abord, doublons retirés, puis le stock de
 * la veille ; au plus `MAX_PISTES_CONNUES`. `sauf` retire les pistes du run en cours : une
 * réparation du scout ne doit pas se voir interdire sa propre liste.
 */
export function pistesDejaConnues(entree: {
  depot: string
  sauf?: string
  chemin?: string
  stockVeille?: readonly string[]
  /** La demande du run : seuls les titres qui en touchent le sujet sont gardés. */
  demande?: string
}): string[] {
  const depot = cleDepot(entree.depot)
  const historique = lireMemoireScout(entree.chemin ?? cheminMemoireScout())
    .entrees.filter((e) => e.depot === depot && (!entree.sauf || e.run !== entree.sauf))
    .sort((a, b) => b.vuLe.localeCompare(a.vuLe))
    .map((e) => e.titre)
  const sujet = racinesDuSujet(entree.demande ?? '')
  const vus = new Set<string>()
  const tetes: string[][] = []
  const titres: string[] = []
  for (const titre of [...historique, ...(entree.stockVeille ?? [])]) {
    const cle = cleTitre(titre)
    if (!cle || vus.has(cle)) continue
    vus.add(cle)
    // Filtrer AVANT la borne : les 60 titres les plus récents peuvent tous être hors sujet.
    if (sujet.length > 0 && !toucheLeSujet(titre, sujet)) continue
    const tete = racinesDuSujet(teteDuTitre(titre))
    if (tetes.some((connue) => reditLaMemePiste(tete, connue))) continue
    tetes.push(tete)
    titres.push(titre)
    if (titres.length >= MAX_PISTES_CONNUES) break
  }
  return titres
}

/*
 * SEULEMENT LES PISTES QUI TOUCHENT LA DEMANDE, ET UNE SEULE FOIS CHACUNE (conv-339).
 *
 * Un /scout sur les humains de l'Accueil (« ultra quali comme dans Cyberpunk ») a reçu 60 titres
 * « DÉJÀ PROPOSÉ » : les plus récents du dépôt, quel qu'en soit le sujet — outils, serveurs MCP,
 * navigateur, coffre de mots de passe —, dont 25 en « (ex-#N) » redisant un titre déjà listé. Du
 * contexte payé à chaque éclaireur, qui ne pouvait rien lui interdire d'utile.
 *
 * Règle lexicale, donc testable : un titre est gardé s'il partage une racine de mot avec la demande.
 * Une demande SANS sujet (« /scout améliore Autowin ») garde l'ancien comportement : tous les titres
 * récents, car c'est là que le scout risque le plus de refaire le précédent. Limite connue : un
 * synonyme ne se reconnaît pas (« humains » ne retrouve pas « passants »).
 * fix-ok: bloc réel de la consigne du scout de conv-339 (fixture scout-conv-339-deja-propose.txt) :
 * 36 titres d'outillage sur 60 passaient, « mot de passe tapé dans le chat » 3 fois (scout-memoire.test.ts).
 */

/** Mots qui ne disent rien du SUJET d'une demande ou d'une piste (sans accents, au singulier). */
const MOTS_CREUX = new Set(
  (
    'les des une est sont pas qui que quoi aux par sur ses son mes tes nos vos leur avec dans pour ' +
    'plus moins sans tout tous toute mais comme comment quand elle ils lui eux nous vous cette ces ' +
    'cet ceci cela etre avoir fait faire fai font peut peux doit encore deja aussi tres trop bien ' +
    'mieux ultra vraiment quel quelle dont soit soient sera entre apres avant depuis chaque autre ' +
    'meme rien aucun aucune jamais toujour pourquoi alor donc ainsi via ver chez sous lor afin car ' +
    'ont ici the and for with how what why this that from into amelio trouver trouve chercher ' +
    'cherche proposer propose rendre mettre corriger corrige idee piste scout autowin app ' +
    'application projet depot code chose truc nouveau nouvelle nouveaux meilleur meilleure faut ' +
    'veux voudrai aimerai besoin'
  ).split(' ')
)

/** Les racines des mots qui portent le sujet : minuscules, sans accents ni pluriel, 6 lettres au plus. */
function racinesDuSujet(texte: string): string[] {
  const racines = new Set<string>()
  const mots = texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
  for (const mot of mots) {
    if (mot.length < 3 || /^\d+$/u.test(mot)) continue
    const singulier = mot.length > 3 ? mot.replace(/[sx]$/u, '') : mot
    const racine = singulier.slice(0, 6)
    if (MOTS_CREUX.has(mot) || MOTS_CREUX.has(singulier) || MOTS_CREUX.has(racine)) continue
    racines.add(racine)
  }
  return [...racines]
}

/** « humain » et « humains », « quali » et « qualité » : même racine, ou l'une préfixe de l'autre. */
const memeRacine = (a: string, b: string): boolean =>
  a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))

function toucheLeSujet(titre: string, sujet: readonly string[]): boolean {
  return racinesDuSujet(titre).some((racine) => sujet.some((mot) => memeRacine(racine, mot)))
}

/** Le titre court : sa partie en gras quand il en a une, sinon sa première phrase ; sans « ex-#N ». */
function teteDuTitre(titre: string): string {
  const gras = /^\s*\*\*(.+?)\*\*/u.exec(titre)
  return (gras ? gras[1]! : titre.split(/\.\s/u)[0]!).replace(/ex-#\d+/giu, ' ')
}

/**
 * Deux titres redisent la même piste quand presque tous les mots du plus court sont dans l'autre :
 * « Peau moins plastique » / « Une peau moins plastique ». « Reflets des néons sur les passants » et
 * « Passants absents du reflet du sol » partagent 2 mots sur 3 : deux pistes, gardées toutes deux.
 */
function reditLaMemePiste(a: readonly string[], b: readonly string[]): boolean {
  const [court, long] = a.length <= b.length ? [a, b] : [b, a]
  if (court.length < 2) return false
  const communs = court.filter((racine) => long.some((autre) => memeRacine(racine, autre))).length
  return communs / court.length >= 0.8
}

/**
 * Les titres du stock de la veille nés d'un scout d'Autowin (écartés compris) — même filtre que
 * `veille/scout-visible.ts`. Les entrées des concurrents restent dehors : ce sont surtout les
 * correctifs de LEURS bugs, pas des pistes pour ce dépôt. Stock illisible → aucun titre.
 */
export function titresStockVeilleAutowin(chemin?: string): string[] {
  try {
    return lireStockVeille(chemin)
      .candidats.filter((candidat) => candidat.concurrent === 'Autowin OS')
      .map((candidat) => candidat.titre)
  } catch {
    return []
  }
}

/** Le bloc ajouté à la consigne du scout. Vide quand rien n'est connu : rien n'est payé en contexte. */
export function blocPistesDejaConnues(titres: readonly string[], bilan = ''): string {
  if (titres.length === 0) return bilan
  return [
    ...(bilan ? [bilan] : []),
    'DÉJÀ PROPOSÉ sur ce dépôt (scouts précédents et stock de la veille, écartées comprises) : ne les relistes pas comme neuves, cherche ailleurs. Si l’une reste la meilleure piste, reprends-la en la marquant « déjà proposée ».',
    ...titres.map((titre) => `- ${titre}`)
  ].join('\n')
}
