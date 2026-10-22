/**
 * « ESSAIE 3 FAÇONS » : LE CONTRÔLE DE RESSEMBLANCE (conv-1057, 2026-10-22).
 *
 * Constat : les trois branches reçoivent trois consignes différentes (`trois-facons.ts`), mais rien
 * ne vérifiait que leurs RÉSULTATS diffèrent. Elles travaillent en même temps sans se voir, et sur
 * une petite tâche deux consignes mènent souvent au même correctif : on payait trois tours pour un
 * seul avis, et la carte montrait deux lignes aux mêmes chiffres sans le dire.
 *
 * La mesure, sans modèle IA : chaque façon est comparée à ses voisines de la MÊME photo de départ.
 *  - même arbre git (l'état du code de la copie) = IDENTIQUE, au caractère près ;
 *  - sinon, la PART de lignes changées en commun : |A ∩ B| / |A ∪ B| sur les lignes ajoutées ou
 *    retirées, chacune rattachée à son fichier. Une ligne est normalisée (blancs écrasés) pour qu'une
 *    indentation différente ne fasse pas deux lignes ; une ligne sans lettre ni chiffre (`}`, `);`)
 *    est écartée, sinon deux façons se ressembleraient par leurs accolades ; un binaire compte par
 *    son contenu (son blob), jamais comme « zéro ligne ».
 * Chaque façon rend la plus proche des autres. À part égale, une façon identique passe devant, puis
 * le plus petit rang. Une façon sans changement est sans objet, et n'est la plus proche de personne.
 *
 * check: ressemblance-des-facons.test.ts — rouge avant ce module (module absent), dont un essai sur
 * de vraies copies : deux au même correctif, une différente, une sans changement.
 */
import type { RessemblanceDUneFacon } from '../shared/essai-trois-facons'
import type { EcartDeLEssai } from './garder-un-essai'
import { defaultGitRunner, type GitRunner } from './run-autoclose'

const SEPARATEUR = '\u0000'
const PORTE_DU_SENS = /[\p{L}\p{N}]/u

/**
 * Les lignes changées d'un diff unifié (`git diff --unified=0`), chacune rattachée à son fichier.
 * La clé du fichier est l'en-tête `diff --git` tel que git l'écrit : deux façons du même dépôt
 * l'écrivent à l'identique, sans qu'il faille démêler les guillemets d'un chemin.
 */
export function lignesChangeesDuDiff(patch: string): Set<string> {
  const lignes = new Set<string>()
  let fichier = ''
  let blob = ''
  let dansEntete = false
  for (const brute of patch.split('\n')) {
    if (brute.startsWith('diff --git ')) {
      fichier = brute.slice('diff --git '.length).trimEnd()
      blob = ''
      dansEntete = true
      continue
    }
    if (dansEntete) {
      if (brute.startsWith('@@')) dansEntete = false
      else if (brute.startsWith('index ')) blob = brute.slice('index '.length).split(' ')[0] ?? ''
      else if (brute.startsWith('Binary files ') || brute.startsWith('GIT binary patch'))
        lignes.add([fichier, 'binaire', blob.split('..').at(-1) ?? ''].join(SEPARATEUR))
      continue
    }
    const signe = brute[0]
    if (signe !== '+' && signe !== '-') continue
    const contenu = brute.slice(1).replace(/\s+/gu, ' ').trim()
    if (!PORTE_DU_SENS.test(contenu)) continue
    lignes.add([fichier, signe, contenu].join(SEPARATEUR))
  }
  return lignes
}

export type EntreeDeRessemblance =
  | {
      id: string
      ok: true
      rang: number
      /** La photo de départ : deux photos différentes ne se comparent pas. */
      photo: string
      /** L'arbre git de ce que la copie porte maintenant. */
      arbre: string
      lignes: ReadonlySet<string>
    }
  | { id: string; ok: false; raison: string }

function partCommune(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let communes = 0
  for (const ligne of a) if (b.has(ligne)) communes += 1
  const union = a.size + b.size - communes
  return union === 0 ? 0 : communes / union
}

export function ressemblanceDesFacons(
  entrees: readonly EntreeDeRessemblance[]
): Map<string, RessemblanceDUneFacon> {
  const resultat = new Map<string, RessemblanceDUneFacon>()
  for (const entree of entrees) {
    if (!entree.ok) {
      resultat.set(entree.id, { etat: 'sans-objet', raison: entree.raison })
      continue
    }
    let meilleure: { avec: number; part: number; identique: boolean } | null = null
    for (const autre of entrees) {
      if (!autre.ok || autre.id === entree.id || autre.photo !== entree.photo) continue
      const identique = autre.arbre === entree.arbre
      const candidate = {
        avec: autre.rang,
        part: identique ? 1 : partCommune(entree.lignes, autre.lignes),
        identique
      }
      const passeDevant =
        !meilleure ||
        candidate.part > meilleure.part ||
        (candidate.part === meilleure.part &&
          (candidate.identique !== meilleure.identique
            ? candidate.identique
            : candidate.avec < meilleure.avec))
      if (passeDevant) meilleure = candidate
    }
    resultat.set(
      entree.id,
      meilleure
        ? { etat: 'mesuree', ...meilleure }
        : { etat: 'sans-objet', raison: 'aucune autre façon à comparer' }
    )
  }
  return resultat
}

/** Le diff complet de la façon depuis sa photo, en lecture seule (deux objets, aucun index). */
export async function lignesChangeesDeLEssai(entree: {
  copie: string
  photo: string
  arbre: string
  runGit?: GitRunner
}): Promise<Set<string>> {
  const git = entree.runGit ?? (await defaultGitRunner())
  const patch = await git(
    [
      'diff',
      '--unified=0',
      '--no-renames',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--full-index',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      entree.photo,
      entree.arbre
    ],
    entree.copie
  )
  return lignesChangeesDuDiff(patch)
}

/**
 * La ressemblance des façons à partir de leurs écarts (`ecartDeLEssai`), telle que la carte la lit.
 * Une façon dont les lignes ne se lisent pas le dit, sans empêcher les autres d'être comparées.
 */
export async function ressemblanceDesEcarts(
  facons: ReadonlyArray<{ id: string; copie: string; ecart: EcartDeLEssai }>,
  runGit?: GitRunner
): Promise<Map<string, RessemblanceDUneFacon>> {
  const entrees = await Promise.all(
    facons.map(async ({ id, copie, ecart }): Promise<EntreeDeRessemblance> => {
      if (!ecart.ok) return { id, ok: false, raison: 'écart illisible' }
      if (ecart.fichiers.length === 0)
        return { id, ok: false, raison: 'aucun changement à comparer' }
      try {
        const lignes = await lignesChangeesDeLEssai({
          copie,
          photo: ecart.photo,
          arbre: ecart.arbre,
          runGit
        })
        return {
          id,
          ok: true,
          rang: ecart.nom.rang,
          photo: ecart.photo,
          arbre: ecart.arbre,
          lignes
        }
      } catch (erreur) {
        return {
          id,
          ok: false,
          raison: `illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`
        }
      }
    })
  )
  return ressemblanceDesFacons(entrees)
}
