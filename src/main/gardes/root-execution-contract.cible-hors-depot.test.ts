import { describe, expect, it } from 'vitest'
import { cibleNommeeTouchee, ciblesNommees, etatDeCloture } from './root-execution-contract'
import type { ExecutionEvidence } from '../providers/types'

/**
 * UN FICHIER QUI N'EST PAS DANS LE DÉPÔT DU RUN N'EST PAS UN FICHIER À MODIFIER.
 *
 * Vécu le 21/11/2026 sur un lot de plan (refonte d'une application dont l'ancienne version vit dans
 * un autre dépôt) : le motif du chef citait l'ancienne version comme preuve, « l'écran V2 utilise
 * son éditeur, qui enregistre InnerHtml TEL QUEL (Ancien_Metier\Editeur.cs:228-231) ». Le contrôle
 * final a exigé la modification de ce fichier, absent du dépôt du lot, et a refusé trois fois de
 * suite un travail juste (73 min) ; la relance du lot citait encore la même phrase.
 *
 * Les tournures (« déjà employé dans », « alors que ») ne couvriront jamais toutes les façons de
 * citer une preuve. Le fait sûr est ailleurs : une ligne ancrée désigne un fichier existant, et un
 * chemin dont même le dossier n'existe pas dans la copie du run vise un autre dépôt.
 */
const COPIE = 'D:/AutoWinOS/.autowin-data/autowin-os/copies-de-taches/run-1'
const DANS_LA_COPIE = new Set(
  ['serveur/courriels', 'serveur/courriels/gestion.cs', 'src/main'].map((chemin) =>
    `${COPIE}/${chemin}`.toLowerCase()
  )
)
const existe = (chemin: string): boolean =>
  DANS_LA_COPIE.has(chemin.replace(/\\/g, '/').toLowerCase())

const MOTIF_DU_CHEF =
  "Un seul point, et l'erreur vient de ma demande : tu as raison, l'écran V2 utilise son éditeur, " +
  'qui enregistre InnerHtml TEL QUEL (Ancien_Metier\\Editeur.cs:228-231). Tout nettoyer retire la ' +
  'mise en forme : ne retire que le code dangereux.'

function mutation(chemin: string): ExecutionEvidence {
  return {
    kind: 'mutation',
    status: 'completed',
    ok: true,
    summary: 'edit',
    paths: [`${COPIE}/${chemin}`]
  } as ExecutionEvidence
}

describe('cible nommée hors du dépôt du run', () => {
  it('le fichier de l’ancienne version, cité comme preuve, n’est pas une cible', () => {
    expect(ciblesNommees(MOTIF_DU_CHEF, existe, COPIE)).toEqual([])
  })

  it('le lot qui a modifié ses propres fichiers ferme sans « Cible nommée » manquée', () => {
    const phases = [
      {
        phase: 'build',
        text: 'fait',
        executionEvidence: [mutation('Serveur/Courriels/Gestion.cs')]
      }
    ]
    const cloture = etatDeCloture(MOTIF_DU_CHEF, phases, true, true, COPIE)
    expect(cloture.dod.map((c) => c.label).join(' | ')).not.toContain('Cible nommee')
  })

  it('un fichier du dépôt cité avec sa ligne reste une cible, et son oubli bloque toujours', () => {
    const demande = 'Corrige Serveur\\Courriels\\Gestion.cs:120 pour garder la mise en forme.'
    expect(ciblesNommees(demande, existe, COPIE)).toEqual(['serveur/courriels/gestion.cs'])
    expect(cibleNommeeTouchee(demande, [mutation('Pont/Autre.cs')], existe, COPIE)).toBe('manquee')
  })

  it('un fichier déplacé dont le dossier existe encore reste une cible (rangement de dossiers)', () => {
    expect(ciblesNommees('Corrige src/main/crash-handlers.ts:32.', existe, COPIE)).toEqual([
      'src/main/crash-handlers.ts'
    ])
  })

  it('sans copie connue, rien ne change : le chemin cité reste une cible', () => {
    expect(ciblesNommees(MOTIF_DU_CHEF, existe)).toEqual(['ancien_metier/editeur.cs'])
  })
})
