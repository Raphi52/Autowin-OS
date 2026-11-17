import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  fauteDeSeparation,
  nomsDesProfils,
  racineDesProfils,
  termesDesProfils
} from '../../../scripts/identite-entreprise.mjs'
import { DOSSIER_ENTREPRISE } from '../profil/identite-entreprise'
import type { GitRunner } from '../runs/run-autoclose'

const executer = promisify(execFile)

export type ResultatDeSeparation =
  { ok: true; avertissement?: string } | { ok: false; raison: string }

/**
 * CONTRÔLE DE SÉPARATION D'UN COMMIT POSÉ PAR L'APP. La règle est celle de `.githooks/pre-commit`
 * (`fauteDeSeparation`, dans `scripts/identite-entreprise.mjs`), appliquée à ce que le commit emporte :
 * son message, puis chaque fichier qu'il ajoute ou modifie par rapport à `base`, lu dans `arbre`.
 *
 * Pourquoi : `git commit-tree` ne lance aucun crochet. Sans ce contrôle, un commit posé par l'app
 * entre dans l'historique avec le nom, et il faut réécrire l'historique pour le retirer.
 *
 * Aucun profil d'entreprise sur ce poste : rien à garder, le commit passe. Un profil mal formé : le
 * commit passe avec un avertissement, comme dans le crochet ; le pré-envoi vers GitHub refuse alors.
 * Un contrôle qui ne peut pas tourner ne refuse pas un commit (règle de `scripts/separation-avant-push.mjs`).
 */
type ReglesDuPoste =
  | { etat: 'aucune' }
  | { etat: 'mal-formees' }
  | {
      etat: 'lues'
      noms: ReturnType<typeof nomsDesProfils>
      termes: ReturnType<typeof termesDesProfils>['termes']
    }

/** Noms et termes réservés des profils d'entreprise du poste, trouvés depuis `copie` (copie liée comprise). */
function reglesDuPoste(copie: string): ReglesDuPoste {
  const profils = racineDesProfils(copie)
  if (!profils) return { etat: 'aucune' }
  const { termes, erreurs } = termesDesProfils(profils)
  if (erreurs.length > 0) return { etat: 'mal-formees' }
  return { etat: 'lues', noms: nomsDesProfils(profils), termes }
}

/**
 * Le texte nomme-t-il une entreprise du poste ? La règle du contrôle ci-dessous, pour qui COMPOSE un
 * message de commit avant lui (`titreDeCommitAuto`) : un titre écarté ici ne fera pas refuser le commit.
 * Sans profil, ou profil mal formé, rien n'est réservé : le contrôle laisse alors passer le message.
 */
export function texteReserve(copie: string): (texte: string) => boolean {
  const regles = reglesDuPoste(copie)
  if (regles.etat !== 'lues') return () => false
  return (texte) => Boolean(fauteDeSeparation(texte, regles.noms, regles.termes))
}

export async function controleDeSeparation(entree: {
  copie: string
  base: string
  arbre: string
  message: string
  git: GitRunner
}): Promise<ResultatDeSeparation> {
  const regles = reglesDuPoste(entree.copie)
  if (regles.etat === 'aucune') return { ok: true }
  // fix-ok: src/main/git/controle-de-separation.ts — cause mesurée : le refus sur profil mal formé contredisait la règle du script et du crochet (commit passe avec avertissement) ; le test épinglait ce refus.
  if (regles.etat === 'mal-formees')
    return {
      ok: true,
      avertissement:
        'Contrôle des noms d’entreprise non fait pour ce commit : un profil d’entreprise de ce poste est mal formé. Rien ne part vers GitHub sans contrôle : le pré-envoi refuse tant que le profil n’est pas corrigé.'
    }
  const { noms, termes } = regles

  const fautes: string[] = []
  if (fauteDeSeparation(entree.message, noms, termes)) fautes.push('message du commit')
  const sortie = await entree.git(
    [
      'diff',
      '--raw',
      '-z',
      '--no-renames',
      '--no-abbrev',
      '--diff-filter=AM',
      entree.base,
      entree.arbre
    ],
    entree.copie
  )
  for (const { chemin, oid } of fichiersAjoutesOuModifies(sortie)) {
    if (chemin.startsWith(`${DOSSIER_ENTREPRISE}/`)) continue
    if (fauteDeSeparation(chemin, noms, termes)) {
      fautes.push(`${chemin} (chemin)`)
      continue
    }
    const { stdout } = await executer('git', ['cat-file', 'blob', oid], {
      cwd: entree.copie,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    })
    if (fauteDeSeparation(stdout, noms, termes)) fautes.push(`${chemin} (contenu)`)
  }

  if (fautes.length === 0) return { ok: true }
  return {
    ok: false,
    raison: `Commit refusé : ce qui est commité porte un nom ou un terme d’entreprise (${[...new Set(fautes)].join(', ')}). Retirer le nom ou le terme, puis relancer.`
  }
}

/**
 * Les fichiers qu'une sortie `diff --raw -z` nomme : `:<mode> <mode> <oid> <oid> <statut>`, NUL,
 * chemin, NUL. Un sous-module (mode 160000) n'est pas un fichier : son contenu ne part pas.
 */
function fichiersAjoutesOuModifies(sortie: string): { chemin: string; oid: string }[] {
  const jetons = sortie.split('\0')
  const fichiers: { chemin: string; oid: string }[] = []
  for (let i = 0; i + 1 < jetons.length; i += 2) {
    const [, modeNouveau, , oidNouveau] = jetons[i].split(' ')
    if (modeNouveau === '160000') continue
    fichiers.push({ chemin: jetons[i + 1], oid: oidNouveau })
  }
  return fichiers
}
