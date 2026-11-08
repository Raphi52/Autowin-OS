/**
 * LES CAPTURES D'UN BUREAU CACHÉ NE S'AFFICHENT PAS DANS LE FIL (2026-11-08) : « dans le chat je vois
 * des screenshots que tu prends en bureau caché […] je veux qu'ils apparaissent tous dans l'onglet
 * Bureaux cachés prévu pour ça ». L'onglet montre ces bureaux en direct ; le fil ne recopie plus leurs
 * images. Le modèle IA, lui, les reçoit toujours : seule la copie affichée dans le fil disparaît.
 *
 * Deux chemins amenaient ces images dans le fil :
 * - l'outil `bureau_cache_observer`, dont la pièce jointe était republiée comme carte du fil ;
 * - une capture écrite sur disque (scripts/hdesk-observe.ps1, scripts/ui-capture.mjs) puis ouverte
 *   par l'outil `Read` : ces scripts notent leurs fichiers dans `captures.jsonl`
 *   (scripts/bureau-cache-registre.mjs), lu ici.
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const JOURNAL_CAPTURES = 'captures.jsonl'

/** Outils dont l'image vient d'un bureau caché : elle part au modèle, pas dans le fil. */
const OUTILS_DE_BUREAU_CACHE = new Set(['bureau_cache_observer'])

export function imageDOutilMontreeDansLeFil(outil: string): boolean {
  return !OUTILS_DE_BUREAU_CACHE.has(outil)
}

/** Même dossier que hdesk-lancer.ps1 (`registreParDefaut`, hdesk-gestion.ts). */
function dossierRegistre(): string {
  return join(process.env.LOCALAPPDATA ?? tmpdir(), 'autowin-hdesk')
}

/**
 * Forme comparable d'un chemin Windows : absolu, barres obliques, minuscules. `/d/x` (Git Bash)
 * devient `d:/x` : l'agent écrit le chemin d'une façon, le script l'a noté de l'autre.
 */
export function cheminComparable(chemin: string): string {
  const bash = /^\/([a-zA-Z])\/(.*)$/.exec(chemin.trim())
  const windows = bash ? `${bash[1]}:/${bash[2]}` : chemin.trim()
  return resolve(windows).replaceAll('\\', '/').toLowerCase()
}

/** Chemins notés par les scripts de capture. Journal absent ou ligne abîmée : rien. */
export function capturesNotees(registre = dossierRegistre()): Set<string> {
  let texte = ''
  try {
    texte = readFileSync(join(registre, JOURNAL_CAPTURES), 'utf8')
  } catch {
    return new Set()
  }
  const chemins = new Set<string>()
  for (const ligne of texte.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!ligne.trim()) continue
    try {
      const entree = JSON.parse(ligne) as { chemin?: unknown }
      if (typeof entree?.chemin === 'string' && entree.chemin.trim())
        chemins.add(cheminComparable(entree.chemin))
    } catch {
      // Ligne abîmée (écriture coupée) : les autres restent lisibles.
    }
  }
  return chemins
}

/** Le fichier qu'un outil vient d'ouvrir est-il une capture de bureau caché ? */
export function estCaptureDeBureauCache(
  chemin: string | undefined,
  registre = dossierRegistre()
): boolean {
  if (!chemin?.trim()) return false
  return capturesNotees(registre).has(cheminComparable(chemin))
}
