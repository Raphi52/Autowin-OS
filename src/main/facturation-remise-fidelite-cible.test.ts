import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ORACLE D'ABSENCE — et non un test de comportement.
 *
 * Une demande de correction a visé `src/main/facturation/remise-fidelite-inexistante.ts`
 * (fonction `calculerRemiseFidelite`, arrondi au centime supérieur au lieu de l'inférieur).
 * Cette cible n'existe pas dans ce dépôt : ni fichier, ni symbole, ni trace dans l'historique
 * git complet (`git log --all -S`). Le domaine « facturation » appartient à RIG, autre dépôt.
 *
 * Écrire un test d'arrondi ici aurait exigé de CRÉER la fonction, donc de fabriquer le bug
 * avant de le « corriger ». Ce fichier fige à la place le fait vérifiable, de façon FALSIFIABLE :
 * le jour où la cible apparaît réellement dans le dépôt, ce test devient ROUGE et signale qu'il
 * faut écrire le vrai test d'arrondi (entrée témoin : montant × taux = 0,12345 € doit rendre
 * 0,12 et non 0,13 ; un `Math.ceil` ferait échouer cette entrée).
 */
const RACINE = join(__dirname, '..', '..')
const CIBLE = join(RACINE, 'src', 'main', 'facturation', 'remise-fidelite-inexistante.ts')

describe('cible facturation/remise-fidelite (absente du dépôt)', () => {
  it("le fichier visé n'existe pas", () => {
    expect(existsSync(CIBLE)).toBe(false)
  })

  it("le symbole calculerRemiseFidelite n'est présent dans aucun fichier suivi", () => {
    let sortie = ''
    try {
      sortie = execFileSync('git', ['grep', '-l', '-i', 'calculerRemiseFidelite'], {
        cwd: RACINE,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch (erreur) {
      // `git grep` sort en code 1 quand il ne trouve RIEN : c'est le cas attendu, pas une panne.
      const statut = (erreur as { status?: number }).status
      if (statut !== 1) throw erreur
    }

    /*
      Un fichier qui ne peut que CITER le symbole ne prouve pas sa présence : ce fichier-ci, et tout
      artefact de test ou de preuve. Mesuré le 2026-08-22 — l'oracle est passé rouge parce que
      `scripts/cdp-relance-jusquau-vert-proof.mjs:81` porte le symbole dans une CHAÎNE DE PROMPT
      (« Corrige le bug de la fonction `calculerRemiseFidelite` dans … »), pas dans du code.

      Une autre session a « réparé » en SUPPRIMANT ce fichier. Supprimer un oracle parce qu'il sonne,
      c'est desserrer une assertion jusqu'à ce qu'elle passe. On le RESSERRE plutôt : il reste
      falsifiable sur la SOURCE — le jour où la cible apparaît vraiment dans `src/`, il redevient
      rouge — et il cesse de compter les citations.
    */
    const citationSeule = (chemin: string): boolean =>
      /\.test\.[cm]?[jt]sx?$/.test(chemin) || chemin.startsWith('scripts/')

    const suivis = sortie
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !citationSeule(l))

    expect(suivis).toEqual([])
  })
})
