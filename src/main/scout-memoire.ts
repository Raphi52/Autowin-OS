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
import { MOTIFS_REFUS, parseScoutTable, type MotifRefus } from '../shared/scout-table'
import type { OutcomeLearningEventV1, OutcomeObservedV1 } from '../shared/run-learning'
import { estSelectionDeScout, lotDeLaSelection, voieDeLaSelection } from '../shared/selection-scout'
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
  /**
   * Ce que l'utilisateur en a fait, lu dans le message de sélection du run suivant. « ignoree » :
   * aucune piste de ce scout n'a été prise avant le scout suivant du même dépôt (piste 2, conv-1033).
   */
  choix?: 'prise' | 'laissee' | 'ignoree'
  /**
   * Le run qui a traité la piste prise (celui du message de sélection). Son résultat est déjà noté
   * par l'app (`OutcomeObservedV1`) : on le relit là, sans second suivi (piste 1, conv-1033).
   */
  traitePar?: string
  /**
   * La voie qui a traité la piste prise, lue sur le message de sélection (conv-1080) : `directe`
   * (build → jugement) ou `complete` (cadrage → build → nettoyage → jugement). Avec le résultat du
   * run (`traitePar`), c'est la mesure qui dira si le seuil de la correction directe est le bon.
   */
  voie?: 'directe' | 'complete'
  /** « Pourquoi pas ? » : la raison donnée en un clic sur la piste décochée (piste 2, conv-1033). */
  motif?: MotifRefus
}

/** La classe de fin d'un run, telle que l'app la note déjà (`outcome-learning/events-v1.jsonl`). */
export type ClasseResultatRun = NonNullable<OutcomeObservedV1['terminalClass']>

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
  ecrireMemoireScout(chemin, [
    ...marquerScoutsIgnores(memoire.entrees, depot, entree.run),
    ...ajouts
  ])
}

/*
 * UN SCOUT DONT RIEN N'EST PRIS (piste 2, conv-1033). Sans sélection, aucun message n'arrive :
 * `noterChoixScout` sort avant d'écrire, et le scout restait sans trace de son échec — 6 runs scout
 * sur 10 dans `scout-pistes.json` le 21/10. Le scout SUIVANT du même dépôt le constate : chaque run
 * précédent sans aucun choix passe en « ignoree ». Le run en cours est exclu (une réparation n'est
 * pas un scout suivant) ; une sélection tardive le remplace par « prise »/« laissee ».
 */
function marquerScoutsIgnores(
  entrees: EntreeMemoireScout[],
  depot: string,
  runEnCours: string
): EntreeMemoireScout[] {
  const runsJuges = new Set(entrees.filter((e) => e.depot === depot && e.choix).map((e) => e.run))
  return entrees.map((e) =>
    e.depot === depot && e.run !== runEnCours && !runsJuges.has(e.run)
      ? { ...e, choix: 'ignoree' }
      : e
  )
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
 * Les pistes PRISES, lues dans un message de sélection : ses lignes « Quoi : », sinon ses lignes
 * numérotées sans leurs suffixes (« — ancrage », « — preuve », « — pertinence »). Une demande libre
 * n'est pas une sélection : liste vide.
 */
export function titresChoisisDansLaDemande(demande: string): string[] {
  const texte = demande ?? ''
  // L'en-tête du message de sélection, source unique partagée (`shared/selection-scout.ts`).
  if (!estSelectionDeScout(texte)) return []
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
 *
 * LOTS (conv-1080) : une sélection découpée arrive en plusieurs messages, un par lot. Le lot 1
 * remet le scout à plat comme une sélection d'un seul tenant ; les lots suivants AJOUTENT leurs
 * pistes sans toucher aux autres — sinon le lot 2 aurait marqué « laissee » les pistes prises par
 * le lot 1 et effacé le run qui les a traitées.
 */
export function noterChoixScout(entree: {
  depot: string
  demande: string
  maintenant: string
  /** Le run qui porte la sélection : il TRAITE les pistes prises (piste 1, conv-1033). */
  run?: string
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
  const lot = lotDeLaSelection(entree.demande)
  const lotSuivant = lot !== null && lot.numero > 1
  const voie = voieDeLaSelection(entree.demande)
  const entrees = memoire.entrees.map((e): EntreeMemoireScout => {
    if (e.depot !== depot || e.run !== source.run) return e
    const prise = prises.some((p) => memePiste(p, e.titre))
    if (lotSuivant && !prise) return e
    const suivante: EntreeMemoireScout = { ...e }
    delete suivante.traitePar
    delete suivante.voie
    if (!prise) return { ...suivante, choix: 'laissee' }
    return {
      ...suivante,
      choix: 'prise',
      ...(entree.run ? { traitePar: entree.run } : {}),
      ...(voie ? { voie } : {})
    }
  })
  ecrireMemoireScout(chemin, entrees)
}

/**
 * Le DERNIER résultat de chaque run : un run repris ou réparé en a plusieurs (67 runs sur 443 dans
 * `events-v1.jsonl` le 21/10), et l'échec d'une tentative déjà réparée ne dit plus rien. Un résultat
 * sans classe se lit sur son statut : vert = livré, sinon indéterminé.
 */
export function dernierResultatParRun(
  resultats: ReadonlyArray<
    Pick<OutcomeObservedV1, 'runId' | 'createdAt' | 'status'> & {
      terminalClass?: OutcomeObservedV1['terminalClass']
    }
  >
): Map<string, ClasseResultatRun> {
  const derniers = new Map<string, { quand: string; classe: ClasseResultatRun }>()
  for (const r of resultats) {
    const connu = derniers.get(r.runId)
    if (connu && connu.quand > r.createdAt) continue
    const classe = r.terminalClass ?? (r.status === 'succeeded' ? 'delivered' : 'indeterminate')
    derniers.set(r.runId, { quand: r.createdAt, classe })
  }
  return new Map([...derniers].map(([run, { classe }]) => [run, classe]))
}

/** Les résultats de runs du journal de l'app (`OutcomeLearningLedger.read().events`), le dernier par run. */
export function resultatsDesEvenements(
  evenements: readonly OutcomeLearningEventV1[]
): Map<string, ClasseResultatRun> {
  return dernierResultatParRun(
    evenements.flatMap((evenement) => (evenement.kind === 'outcome' ? [evenement.value] : []))
  )
}

/** Lit la classe de fin d'un run ; `undefined` tant qu'il n'est pas fini ou s'il est inconnu. */
export type LecteurResultatRun = (run: string) => ClasseResultatRun | undefined

/** Les pistes prises dont le run qui les a traitées a LIVRÉ, la plus récente d'abord, sans doublon. */
export function pistesDejaLivrees(entree: {
  depot: string
  resultatDuRun: LecteurResultatRun
  chemin?: string
}): Array<{ titre: string; run: string }> {
  const depot = cleDepot(entree.depot)
  const vues = new Set<string>()
  const livrees: Array<{ titre: string; run: string }> = []
  const entrees = lireMemoireScout(entree.chemin ?? cheminMemoireScout()).entrees
  for (const e of [...entrees].sort((a, b) => b.vuLe.localeCompare(a.vuLe))) {
    if (e.depot !== depot || e.choix !== 'prise' || !e.traitePar) continue
    if (entree.resultatDuRun(e.traitePar) !== 'delivered') continue
    const cle = cleTitre(e.titre)
    if (vues.has(cle)) continue
    vues.add(cle)
    livrees.push({ titre: e.titre, run: e.traitePar })
  }
  return livrees
}

/*
 * LES PISTES QUE L'UTILISATEUR A VRAIMENT JUGÉES (piste 5, conv-1033). Un scout réparé garde une
 * ligne par VERSION de son tableau, et la sélection les marque toutes : run-8e6410f195c5-1 comptait
 * 93 lignes jugées pour 11 versions, alors que son dernier tableau — le seul affiché — en avait 9.
 * Seule la DERNIÈRE version de chaque run compte : un titre qui n'existe que dans une version
 * antérieure n'a jamais été vu, il ne peut pas avoir été « laissé ». « ignoree » n'est pas un choix
 * entre pistes : elle reste hors du taux de prise.
 */
function pistesJugees(entrees: readonly EntreeMemoireScout[], depot: string): EntreeMemoireScout[] {
  return dernierTableauDeChaqueRun(entrees, depot).filter(
    (e) => e.choix === 'prise' || e.choix === 'laissee'
  )
}

/** Les lignes du dépôt qui appartiennent à la DERNIÈRE version du tableau de leur run. */
function dernierTableauDeChaqueRun(
  entrees: readonly EntreeMemoireScout[],
  depot: string
): EntreeMemoireScout[] {
  const derniereVersion = new Map<string, string>()
  for (const e of entrees) {
    if (e.depot !== depot) continue
    const connue = derniereVersion.get(e.run)
    if (connue === undefined || e.vuLe > connue) derniereVersion.set(e.run, e.vuLe)
  }
  return entrees.filter((e) => e.depot === depot && e.vuLe === derniereVersion.get(e.run))
}

/**
 * Le motif d'une piste laissée (« Pourquoi pas ? », piste 2 de conv-1033), sur le DERNIER scout du
 * dépôt qui la proposait — toutes ses versions, comme la sélection. Le panneau ne connaît ni le run
 * ni le dépôt : le titre suffit, comme pour le message de sélection. Faux si aucune piste ne répond.
 */
export function noterMotifScout(entree: {
  depot: string
  titre: string
  motif: MotifRefus
  chemin?: string
}): boolean {
  const chemin = entree.chemin ?? cheminMemoireScout()
  const depot = cleDepot(entree.depot)
  const memoire = lireMemoireScout(chemin)
  const source = memoire.entrees
    .filter((e) => e.depot === depot && memePiste(entree.titre, e.titre))
    .sort((a, b) => b.vuLe.localeCompare(a.vuLe))[0]
  if (!source) return false
  ecrireMemoireScout(
    chemin,
    memoire.entrees.map((e) =>
      e.depot === depot && e.run === source.run && memePiste(entree.titre, e.titre)
        ? { ...e, motif: entree.motif }
        : e
    )
  )
  return true
}

/**
 * Les motifs donnés sur le dernier tableau de chaque run, comptés : « 2 déjà fait, 1 hors sujet ».
 * Une piste recochée puis PRISE n'a pas été refusée : son motif ne compte plus.
 */
function motifsDesRefus(entrees: readonly EntreeMemoireScout[], depot: string): string {
  const comptes = new Map<MotifRefus, number>()
  for (const e of dernierTableauDeChaqueRun(entrees, depot)) {
    if (e.motif && e.choix !== 'prise') comptes.set(e.motif, (comptes.get(e.motif) ?? 0) + 1)
  }
  return [...comptes]
    .sort((a, b) => b[1] - a[1])
    .map(([motif, n]) => `${n} ${MOTIFS_REFUS[motif]}`)
    .join(', ')
}

/** En dessous, un taux de prise est du bruit : le bilan se tait plutôt que d'orienter sur 2 cas. */
export const MIN_PISTES_JUGEES = 5

/**
 * Le bilan des choix RÉELS sur ce dépôt, rendu au scout suivant : combien de pistes sont prises, la
 * note moyenne des prises face à celle des laissées, et le taux de prise par type. C'est la note
 * « ajustée sur ce que l'utilisateur choisit vraiment » (piste 7 de conv-890) : le scout reçoit la
 * mesure, au lieu de noter sur son seul avis. Moins de `MIN_PISTES_JUGEES` : chaîne vide.
 */
export function bilanDesChoix(entree: {
  depot: string
  chemin?: string
  /** Le résultat déjà noté par l'app pour le run qui a traité une piste prise (piste 1). */
  resultatDuRun?: LecteurResultatRun
}): string {
  const depot = cleDepot(entree.depot)
  const toutes = lireMemoireScout(entree.chemin ?? cheminMemoireScout()).entrees
  const jugees = pistesJugees(toutes, depot)
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
  const motifs = motifsDesRefus(toutes, depot)
  const ignores = new Set(
    toutes.filter((e) => e.depot === depot && e.choix === 'ignoree').map((e) => e.run)
  ).size
  const faits = [
    `TES CHOIX RÉELS sur ce dépôt (${jugees.length} pistes jugées) : ${prises.length} prises sur ${jugees.length}`,
    `note moyenne des prises ${moyenne(prises)}, des laissées ${moyenne(laissees)}`,
    ...(types ? [`prises par type : ${types}`] : []),
    ...(entree.resultatDuRun ? [livraisonDesPrises(prises, entree.resultatDuRun)] : []),
    ...(entree.resultatDuRun ? [livraisonParVoie(prises, entree.resultatDuRun)] : []),
    ...(ignores > 0
      ? [`${ignores} ${ignores > 1 ? 'scouts' : 'scout'} sans aucune piste prise`]
      : []),
    ...(motifs ? [`motifs des refus : ${motifs}`] : [])
  ].filter(Boolean)
  return (
    faits.join(' ; ') +
    ". Note d'après ce qui est réellement pris : une piste du genre de celles laissées ne passe pas devant."
  )
}

/*
 * CE QUE SONT DEVENUES LES PISTES PRISES (piste 1, conv-1033) : le résultat du run qui les a traitées,
 * lu dans ce que l'app note déjà. Seuls les runs FINIS comptent ; aucun → rien n'est dit. « en échec »
 * reste un fait sur le RUN, pas un verdict sur la piste : la classe d'un échec est déduite d'un motif
 * de texte (`commands.ts`), et un run peut échouer pour une cause sans rapport avec elle.
 */
function livraisonDesPrises(
  prises: readonly EntreeMemoireScout[],
  resultatDuRun: LecteurResultatRun
): string {
  const classes = prises
    .map((e) => (e.traitePar ? resultatDuRun(e.traitePar) : undefined))
    .filter((c): c is ClasseResultatRun => c !== undefined)
  if (classes.length === 0) return ''
  const livrees = classes.filter((c) => c === 'delivered').length
  const enEchec = classes.filter((c) => c === 'defect').length
  const autres = classes.length - livrees - enEchec
  return [
    `prises traitées : ${livrees} ${livrees > 1 ? 'livrées' : 'livrée'}, ${enEchec} en échec`,
    ...(autres > 0 ? [`${autres} ${autres > 1 ? 'interrompues' : 'interrompue'}`] : [])
  ].join(', ')
}

/** Le bilan d'une voie : pistes prises traitées par un run FINI, et combien de ces runs ont livré. */
export interface BilanDUneVoie {
  traitees: number
  livrees: number
}

/**
 * LA MESURE DU WORKFLOW INTELLIGENT (conv-1080) : pour chaque voie, les pistes prises dont le run a
 * fini, et celles qu'il a livrées. C'est l'option « noter puis régler » des routeurs entraînés sur
 * leurs résultats (Not Diamond, RouteLLM) ramenée à ce qu'on peut compter honnêtement : un run
 * couvre tout son lot, donc une piste livrée est une piste d'un lot livré. Les seuils du choix
 * (`voieDeLaPiste`) ne bougent pas seuls : la mesure les ÉCLAIRE.
 */
export function bilanDesVoies(entree: {
  depot: string
  resultatDuRun: LecteurResultatRun
  chemin?: string
}): Record<'directe' | 'complete', BilanDUneVoie> {
  const depot = cleDepot(entree.depot)
  const prises = pistesJugees(
    lireMemoireScout(entree.chemin ?? cheminMemoireScout()).entrees,
    depot
  ).filter((e) => e.choix === 'prise')
  return compterParVoie(prises, entree.resultatDuRun)
}

function compterParVoie(
  prises: readonly EntreeMemoireScout[],
  resultatDuRun: LecteurResultatRun
): Record<'directe' | 'complete', BilanDUneVoie> {
  const bilan = {
    directe: { traitees: 0, livrees: 0 },
    complete: { traitees: 0, livrees: 0 }
  }
  for (const e of prises) {
    if (!e.voie || !e.traitePar) continue
    const classe = resultatDuRun(e.traitePar)
    if (classe === undefined) continue
    bilan[e.voie].traitees += 1
    if (classe === 'delivered') bilan[e.voie].livrees += 1
  }
  return bilan
}

/** « par voie : correction directe 2/3 livrées, workflow complet 0/4 » — vide sans aucune voie notée. */
function livraisonParVoie(
  prises: readonly EntreeMemoireScout[],
  resultatDuRun: LecteurResultatRun
): string {
  const bilan = compterParVoie(prises, resultatDuRun)
  const morceaux = [
    ...(bilan.directe.traitees > 0
      ? [`correction directe ${bilan.directe.livrees}/${bilan.directe.traitees} livrées`]
      : []),
    ...(bilan.complete.traitees > 0
      ? [`workflow complet ${bilan.complete.livrees}/${bilan.complete.traitees} livrées`]
      : [])
  ]
  return morceaux.length > 0 ? `par voie : ${morceaux.join(', ')}` : ''
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
export function facteursDesChoix(entree: {
  depot: string
  chemin?: string
  /** L'instant du calcul (ISO) : l'âge de chaque choix s'y mesure. Défaut : maintenant. */
  maintenant?: string
}): FacteursChoix {
  const depot = cleDepot(entree.depot)
  const jugees = pistesJugees(
    lireMemoireScout(entree.chemin ?? cheminMemoireScout()).entrees,
    depot
  )
  const prises = jugees.filter((e) => e.choix === 'prise').length
  if (jugees.length < MIN_PISTES_JUGEES || prises === 0 || prises === jugees.length) return {}
  const instant = Date.parse(entree.maintenant ?? new Date().toISOString())
  const poids = (e: EntreeMemoireScout): number => poidsDuChoix(e.vuLe, instant)
  const somme = (liste: readonly EntreeMemoireScout[]): number =>
    liste.reduce((total, e) => total + poids(e), 0)
  const prisesDe = (liste: readonly EntreeMemoireScout[]): EntreeMemoireScout[] =>
    liste.filter((e) => e.choix === 'prise')
  const lisse = (pris: number, total: number): number => (pris + 1) / (total + 2)
  const global = lisse(somme(prisesDe(jugees)), somme(jugees))
  const facteurs: FacteursChoix = {}
  for (const type of ['fix', 'new'] as const) {
    const du = jugees.filter((e) => e.type === type)
    if (du.length < MIN_PISTES_PAR_TYPE) continue
    const brut = lisse(somme(prisesDe(du)), somme(du)) / global
    const facteur = Math.round(Math.min(1.5, Math.max(0.5, brut)) * 100) / 100
    if (Math.abs(facteur - 1) >= 0.05) facteurs[type] = facteur
  }
  return facteurs
}

/*
 * UN CHOIX VIEILLIT (piste 6, conv-1033). Les 11 premières pistes prises venaient des 15 et 16/10,
 * d'une même séance sur les animations, et pesaient autant qu'un choix d'hier sur un tout autre
 * sujet. Le poids d'un choix est divisé par deux toutes les `DEMI_VIE_CHOIX_JOURS`. 14 jours est un
 * choix, pas une mesure : assez court pour qu'une séance d'il y a un mois ne pèse plus qu'un quart.
 * Les seuils (`MIN_PISTES_JUGEES`, `MIN_PISTES_PAR_TYPE`) restent en nombre de pistes réelles.
 */
export const DEMI_VIE_CHOIX_JOURS = 14
const JOUR_MS = 24 * 60 * 60 * 1000

/** Poids d'un choix vu à `vuLe` ; une date illisible (ou future) garde le poids plein. */
function poidsDuChoix(vuLe: string, instant: number): number {
  const vu = Date.parse(vuLe)
  if (!Number.isFinite(vu) || !Number.isFinite(instant) || vu >= instant) return 1
  return 0.5 ** ((instant - vu) / JOUR_MS / DEMI_VIE_CHOIX_JOURS)
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
  const sujet = racinesDuSujet(entree.demande ?? '')
  const runsDuSujet = runsQueLaDemandeDesigne(historique, sujet)
  const candidats: { titre: string; run?: string }[] = [
    ...historique,
    ...(entree.stockVeille ?? []).map((titre) => ({ titre }))
  ]
  const vus = new Set<string>()
  const tetes: string[][] = []
  const titres: string[] = []
  for (const { titre, run } of candidats) {
    const cle = cleTitre(titre)
    if (!cle || vus.has(cle)) continue
    vus.add(cle)
    // Filtrer AVANT la borne : les 60 titres les plus récents peuvent tous être hors sujet.
    const duSujet = (run !== undefined && runsDuSujet.has(run)) || toucheLeSujet(titre, sujet)
    if (sujet.length > 0 && !duSujet) continue
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
 * récents, car c'est là que le scout risque le plus de refaire le précédent.
 * fix-ok: bloc réel de la consigne du scout de conv-339 (fixture scout-conv-339-deja-propose.txt) :
 * 36 titres d'outillage sur 60 passaient, « mot de passe tapé dans le chat » 3 fois (scout-memoire.test.ts).
 */

/*
 * LE SUJET D'UNE PISTE SE LIT AUSSI SUR SON RUN. Un scout répond à UNE demande : ses pistes en
 * partagent le sujet, même quand leurs mots diffèrent. Filtrées titre par titre, les 9 pistes du
 * scout de conv-339 sur les humains n'en gardaient qu'une (« Humains filmés en volume ») : « peau »,
 * « visages », « passants », « ombres », « foule » ne disent pas « humains », et le scout suivant sur
 * le sujet les aurait reproposées. Un mot de la demande désigne donc les runs ENTIERS dont un titre
 * le porte — s'il est rare : présent dans un run sur cinq au plus. Un mot courant ne désigne rien,
 * sinon tout revient : sur la mémoire réelle du 19/10 (18 runs), « humain » est dans 1 run, « chat »
 * dans 4, « outil » dans 6. Un nom de code entre accents graves ne compte pas : « `load_graph` est
 * héritée » cite un objet en passant, et faisait revenir les 57 titres du scout sur les outils pour
 * une demande sur le graphe du chat. Limite : un run qui n'a jamais employé un mot de la demande
 * n'est reconnu que titre par titre.
 * fix-ok: rejeu de `pistesDejaConnues` sur `scout-pistes.json` réel, demande de conv-339 : 1 titre
 * sur les humains rendu, contre les 9 pistes de run-f085fcccbb82-1 (objection du juge).
 */
function runsQueLaDemandeDesigne(
  historique: readonly EntreeMemoireScout[],
  sujet: readonly string[]
): Set<string> {
  const designes = new Set<string>()
  if (sujet.length === 0) return designes
  const racinesParRun = new Map<string, string[]>()
  const lignesParTableau = new Map<string, number>()
  for (const e of historique) {
    if (typeof e.run !== 'string' || !e.run) continue
    const horsCode = e.titre.replace(/`[^`]*`/gu, ' ')
    racinesParRun.set(e.run, [...(racinesParRun.get(e.run) ?? []), ...racinesDuSujet(horsCode)])
    const tableau = `${e.run}\u0000${e.vuLe}`
    lignesParTableau.set(tableau, (lignesParTableau.get(tableau) ?? 0) + 1)
  }
  const plafond = Math.max(1, Math.floor(racinesParRun.size / 5))
  const grands = new Set(
    [...lignesParTableau]
      .filter(([, lignes]) => lignes > MAX_LIGNES_D_UN_SUJET)
      .map(([tableau]) => tableau.split('\u0000')[0]!)
  )
  for (const mot of sujet) {
    const runs = [...racinesParRun]
      .filter(([, racines]) => racines.some((racine) => memeRacine(racine, mot)))
      .map(([run]) => run)
    if (runs.length <= plafond) for (const run of runs) if (!grands.has(run)) designes.add(run)
  }
  return designes
}

/*
 * UN GRAND TABLEAU N'A PAS UN SUJET. « Un scout = un sujet » vaut pour un tableau de scout ordinaire :
 * sur la mémoire réelle du 19/10, 17 runs sur 18 n'ont que des tableaux de 3 à 9 lignes (un run
 * refait garde une ligne par version : 3 × 9 pour celui de conv-339). Le 18e, run-b83811373741-1,
 * a des tableaux de 25 et 27 lignes : un inventaire des outils, du navigateur, de Teams, du coffre et
 * du téléphone. « téléphone » n'y est que dans 2 titres, et ramenait ses 57 titres. Un run dont un
 * tableau dépasse 12 lignes ne revient donc que titre par titre. 12 sépare le plus grand tableau
 * d'un sujet mesuré (9) du plus petit inventaire (25). Limite : un mot rare pris dans un autre sens
 * fait encore revenir un petit tableau — « prévenir le modèle », « peuvent finir ».
 * fix-ok: rejeu de pistesDejaConnues sur scout-pistes.json réel : 49, 31 et 31 titres pour les trois
 * demandes du juge (téléphone, Teams et Outlook, coffre), tout run-b83811373741-1 compris.
 */
const MAX_LIGNES_D_UN_SUJET = 12

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
 * Deux textes libres (titre de piste, sujet de commit) redisent-ils la même piste ? Même règle que
 * le dédoublonnage des pistes connues : la tête de chaque texte, ses racines, 80 % du plus court.
 */
export function memeSujetQue(a: string, b: string): boolean {
  return reditLaMemePiste(racinesDuSujet(teteDuTitre(a)), racinesDuSujet(teteDuTitre(b)))
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
