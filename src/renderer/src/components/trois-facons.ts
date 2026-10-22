/**
 * « ESSAIE 3 FAÇONS » — le texte envoyé à chaque branche (conv-1038, 2026-10-21).
 *
 * Constat du scout : pour comparer des approches, l'utilisateur ouvrait plusieurs fils à la main ;
 * l'arène, la mosaïque et la branche existaient sans rien pour les relier. La même demande part
 * dans trois branches du fil, chacune dans sa copie séparée (`photo-du-code.ts`,
 * `ouvrirCopiesDEssai`), avec une façon IMPOSÉE : sans elle, trois tours du même modèle sur le même
 * texte rendraient trois fois le même avis, pour trois fois le prix.
 */
import {
  nomDeCopieDEssai,
  type ComparaisonDUneFacon,
  type RessemblanceDUneFacon
} from '../../../shared/essai-trois-facons'

// La 3e façon est la plus CRÉATIVE (choix utilisateur, conv-1057, 2026-10-22) : « une approche
// différente des deux plus évidentes » obligeait la branche à deviner ce que font les deux autres,
// qu'elle ne voit pas.
export const FACONS = [
  'la plus simple qui réponde à la demande',
  'la plus robuste, quitte à être plus longue',
  'la plus créative, quitte à sortir des sentiers battus'
] as const

export function demandePourLaFacon(demande: string, rang: number, total: number): string {
  const facon = FACONS[rang % FACONS.length]
  return [
    demande.trim(),
    '',
    `(Essai ${rang + 1}/${total} — façon imposée : ${facon}. Les autres branches essaient la même demande autrement, chacune dans sa copie séparée : ne publie rien, ne fusionne rien. Termine par ce que tu as changé, la preuve que ça marche, et ce que ça coûte, pour que les essais se comparent.)`
  ].join('\n')
}

const MARQUE = /\s+—\s+façon \d+\/\d+$/u

export function titreDeLaFacon(titre: string, rang: number, total: number): string {
  return `${titre.replace(MARQUE, '').trim()} — façon ${rang + 1}/${total}`
}

/*
 * LA CARTE DE COMPARAISON (conv-1038, 2026-10-21 — idée 6 : « une carte compare les écarts, les tests
 * et le coût, et fusionne la gagnante »). Les branches d'un même essai se reconnaissent au nom de leur
 * copie (`nomDeCopieDEssai`) : même fil, même instant. Les phrases ci-dessous mettent en mots ce que
 * le processus principal a MESURÉ — l'écart de la copie depuis sa photo, ce que les vérifications ont
 * rendu, ce que les appels ont coûté — sans rien arrondir vers le mieux.
 * check: trois-facons.comparaison.test.ts — 6 cas rouges avant ces fonctions, dont un fil `conv-10`
 * voisin de `conv-1` et un autre essai du même fil, qui ne doivent pas être regroupés.
 */

export interface FaconDUnEssai {
  id: string
  titre: string
  rang: number
}

export function faconsDuMemeEssai(
  convs: ReadonlyArray<{ id: string; title: string; projectPath?: string }>,
  id: string
): FaconDUnEssai[] {
  const nom = nomDeCopieDEssai(convs.find((conv) => conv.id === id)?.projectPath)
  if (!nom) return []
  return convs
    .flatMap((conv) => {
      const autre = nomDeCopieDEssai(conv.projectPath)
      return autre && autre.fil === nom.fil && autre.quand === nom.quand
        ? [{ id: conv.id, titre: conv.title, rang: autre.rang }]
        : []
    })
    .sort((a, b) => a.rang - b.rang)
}

type Ecart = Extract<ComparaisonDUneFacon, { ok: true }>['ecart']
type Bilan = Extract<ComparaisonDUneFacon, { ok: true }>['bilan']

const pluriel = (nombre: number, mot: string): string => `${nombre} ${mot}${nombre > 1 ? 's' : ''}`

export function phraseDeLEcart(ecart: Ecart): string {
  if (!ecart.ok) return `écart illisible : ${ecart.raison}`
  if (ecart.fichiers.length === 0) return 'aucun changement'
  const binaires = ecart.fichiers.filter((fichier) => fichier.ajouts === null).length
  return [
    pluriel(ecart.fichiers.length, 'fichier'),
    `+${ecart.ajouts} −${ecart.retraits}`,
    ...(binaires > 0 ? [pluriel(binaires, 'binaire')] : [])
  ].join(' · ')
}

export function phraseDesVerifications(bilan: Bilan): string {
  if (bilan.vertes === 0 && bilan.rouges === 0) return 'aucune lancée'
  return [
    ...(bilan.vertes > 0 ? [pluriel(bilan.vertes, 'verte')] : []),
    ...(bilan.rouges > 0 ? [pluriel(bilan.rouges, 'rouge')] : [])
  ].join(' · ')
}

export const LIBELLES_ETAT_DE_LA_FACON: Record<Bilan['etat'], string> = {
  'pas-parti': 'pas encore partie',
  'en-cours': 'en cours',
  fini: 'finie',
  echec: 'en échec',
  arrete: 'arrêtée'
}

/** Le coût d'une branche, tiré des lignes de `costBreakdown` (appels dédoublonnés par le main). */
export function coutDesLignes(
  lignes: ReadonlyArray<{ costUsd: number; unpricedCalls?: number }>
): { usd: number; partiel: boolean } | null {
  if (lignes.length === 0) return null
  const usd = lignes.reduce((somme, ligne) => somme + (Number(ligne.costUsd) || 0), 0)
  return {
    usd: Math.round(usd * 10_000) / 10_000,
    partiel: lignes.some((ligne) => (ligne.unpricedCalls ?? 0) > 0)
  }
}

export function phraseDuCout(cout: { usd: number; partiel: boolean } | null): string {
  if (!cout) return 'inconnu'
  const montant = `${cout.usd.toFixed(2).replace('.', ',')} $`
  return cout.partiel ? `au moins ${montant}` : montant
}

/*
 * LA RESSEMBLANCE (conv-1057, 2026-10-22 — calculée par `src/main/ressemblance-des-facons.ts`).
 * Les arrondis ne mentent pas : un code qui n'est pas identique ne s'affiche jamais « 100 % », et
 * une ligne commune ne s'affiche jamais « 0 % ».
 */
export function phraseDeLaRessemblance(ressemblance: RessemblanceDUneFacon | undefined): string {
  if (!ressemblance) return 'Autowin doit redémarrer pour la mesurer'
  if (ressemblance.etat === 'sans-objet') return ressemblance.raison
  const { avec, part, identique } = ressemblance
  if (identique) return `identique à la façon ${avec}`
  if (part >= 1) return `mêmes lignes que la façon ${avec}, code différent`
  if (part <= 0) return 'aucune ligne commune avec les autres façons'
  const pourcent = Math.round(part * 100)
  if (pourcent < 1) return `moins de 1 % de lignes communes avec la façon ${avec}`
  return `${Math.min(99, pourcent)} % de lignes communes avec la façon ${avec}`
}

/** Seuil d'AFFICHAGE seulement (mise en évidence) : la phrase garde le chiffre exact. */
const SEUIL_TRES_PROCHE = 0.8

export function estTresProche(ressemblance: RessemblanceDUneFacon | undefined): boolean {
  return (
    ressemblance?.etat === 'mesuree' &&
    (ressemblance.identique || ressemblance.part >= SEUIL_TRES_PROCHE)
  )
}
