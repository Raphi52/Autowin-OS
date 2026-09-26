/**
 * LA LISTE D'AUTORITÉ DE PRODUCTION — quelles cibles sont de la production, et lesquelles ne le sont
 * pas. Lue au démarrage depuis un fichier de déclaration, écrit par un HUMAIN.
 *
 * POURQUOI UN FICHIER, ET PAS DU CODE. Le classifieur (`prod-guard.ts`) refuse toute règle de nom,
 * et il a raison : `RIG_LE_PUY_MARTIN` ressemble à un greffe et n'en est pas un, `RIG_AMIENS` ne
 * contient pas le mot « prod » et c'est une base de production. Seule une DÉCLARATION explicite peut
 * trancher. Ce fichier est cette déclaration ; il n'est jamais écrit par l'application ni par le
 * modèle.
 *
 * ABSENT OU ILLISIBLE = LISTE VIDE, ET UNE LISTE VIDE BLOQUE TOUT (« inconnu vaut prod »). Ce n'est
 * pas une panne silencieuse : c'est le comportement le plus fermé, choisi exprès. Un fichier effacé
 * ne peut donc pas OUVRIR la production — au pire il la ferme, et l'utilisateur le voit
 * immédiatement. C'est le même principe que `autorisations-permanentes.ts` (« un fichier corrompu ne
 * doit jamais ouvrir un droit »), poussé un cran plus loin.
 *
 * LE CHARGEMENT RAPPORTE SES DÉGÂTS. `chargerAutoriteProd` rend aussi les ANOMALIES : fichier
 * introuvable, JSON invalide, entrées écartées et pourquoi. Sans cela, une faute de frappe dans une
 * déclaration ferait disparaître une ligne en silence, et la cible correspondante deviendrait
 * bloquante sans que personne comprenne pourquoi.
 *
 * FORME DU FICHIER — JSON, un tableau d'entrées ou un objet `{ "entrees": [...] }` :
 *   [
 *     { "nature": "base", "nom": "RIG_AMIENS", "classe": "prod", "motif": "greffe exploité" },
 *     { "nature": "base", "nom": "RIG_MAQUETTE", "classe": "non-prod" },
 *     { "nature": "chemin", "nom": "D:/Deploiement/Prod", "classe": "prod" }
 *   ]
 * Natures acceptées : base · serveur · chemin · branche · service. Classes : prod · non-prod.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  construireAutoriteProd,
  type AutoriteProd,
  type EntreeAutorite,
  type NatureCible
} from '../prod-guard'

const NATURES: readonly NatureCible[] = ['base', 'serveur', 'chemin', 'branche', 'service']

export function cheminAutoriteProd(racine: string): string {
  return join(racine, 'prod-autorite.json')
}

export interface ChargementAutorite {
  autorite: AutoriteProd
  /** Ce qui a été réellement retenu — à afficher pour que l'utilisateur vérifie sa déclaration. */
  retenues: number
  /**
   * Ce qui a mal tourné, en clair. Vide = tout va bien. Non vide = des cibles sont peut-être
   * bloquantes sans que ce soit voulu.
   */
  anomalies: string[]
}

/** Valide UNE déclaration. Rend l'entrée, ou le motif du rejet — jamais un demi-objet. */
function lireEntree(brut: unknown, index: number): EntreeAutorite | string {
  if (!brut || typeof brut !== 'object') return `entrée ${index} : ce n'est pas un objet`
  const objet = brut as Partial<EntreeAutorite>
  if (typeof objet.nature !== 'string' || !NATURES.includes(objet.nature as NatureCible)) {
    return `entrée ${index} : nature « ${String(objet.nature)} » inconnue (attendu : ${NATURES.join(', ')})`
  }
  if (typeof objet.nom !== 'string' || objet.nom.trim().length === 0) {
    return `entrée ${index} : nom manquant ou vide`
  }
  if (objet.classe !== 'prod' && objet.classe !== 'non-prod') {
    return `entrée ${index} (${objet.nom}) : classe « ${String(objet.classe)} » invalide (attendu : prod ou non-prod)`
  }
  const entree: EntreeAutorite = {
    nature: objet.nature as NatureCible,
    nom: objet.nom,
    classe: objet.classe
  }
  if (typeof objet.motif === 'string' && objet.motif.trim().length > 0) entree.motif = objet.motif
  return entree
}

/**
 * CHARGE LA LISTE. Ne lève JAMAIS : toute erreur devient une anomalie rapportée et une liste vide,
 * parce qu'une exception au démarrage empêcherait l'application de s'ouvrir — donc de corriger le
 * fichier fautif.
 */
export function chargerAutoriteProd(racine: string): ChargementAutorite {
  const chemin = cheminAutoriteProd(racine)
  let texte: string
  try {
    texte = readFileSync(chemin, 'utf8')
  } catch {
    return {
      autorite: construireAutoriteProd([]),
      retenues: 0,
      anomalies: [
        `Aucun fichier de déclaration (${chemin}) : toute cible est traitée comme de la production.`
      ]
    }
  }

  let brut: unknown
  try {
    brut = JSON.parse(texte)
  } catch {
    return {
      autorite: construireAutoriteProd([]),
      retenues: 0,
      anomalies: [
        `Fichier de déclaration illisible (${chemin}, JSON invalide) : toute cible est traitée comme de la production.`
      ]
    }
  }

  const tableau = Array.isArray(brut)
    ? brut
    : Array.isArray((brut as { entrees?: unknown })?.entrees)
      ? ((brut as { entrees: unknown[] }).entrees as unknown[])
      : undefined
  if (!tableau) {
    return {
      autorite: construireAutoriteProd([]),
      retenues: 0,
      anomalies: [
        `Fichier de déclaration mal formé (${chemin}) : un tableau d'entrées est attendu. Toute cible est traitée comme de la production.`
      ]
    }
  }

  const entrees: EntreeAutorite[] = []
  const anomalies: string[] = []
  tableau.forEach((element, index) => {
    const lue = lireEntree(element, index)
    if (typeof lue === 'string') anomalies.push(lue)
    else entrees.push(lue)
  })

  const autorite = construireAutoriteProd(entrees)
  // Une entrée valide peut encore disparaître à la construction : doublon, ou conflit tranché vers
  // `prod`. On le signale plutôt que de laisser un écart inexpliqué entre le fichier et l'effet réel.
  if (autorite.entrees.length < entrees.length) {
    anomalies.push(
      `${entrees.length - autorite.entrees.length} déclaration(s) en double ou en conflit : la plus prudente (prod) l'emporte.`
    )
  }
  return { autorite, retenues: autorite.entrees.length, anomalies }
}
