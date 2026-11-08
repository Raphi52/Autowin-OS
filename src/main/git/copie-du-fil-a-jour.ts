import { copyFileSync } from 'node:fs'
import { avecUneCopieDeLIndex } from '../orchestration/garder-un-essai'
import { defaultGitRunner, type GitRunner } from '../runs/run-autoclose'
import { avancerLaBaseDuFil, lireLaBaseDuFil } from './photo-du-code'

/*
 * LA COPIE D'UN FIL SUIT MAIN. Une copie s'ouvre à la photo du dossier partagé, puis rien ne la
 * faisait avancer : le travail que les autres fils publiaient ensuite dans main n'y arrivait jamais.
 * Sur un fil long, l'agent lisait et testait un code de plus en plus vieux, et chaque passage de la
 * porte risquait davantage un conflit.
 *
 * AU DÉBUT DE CHAQUE TOUR, la copie est remise à l'état de main — SEULEMENT si elle ne porte rien qui
 * ne soit déjà entré dans main : son arbre (fichiers non suivis compris, ignorés exclus) est celui de
 * sa base, c'est-à-dire exactement ce que la porte a publié. Le passage va alors de l'arbre de la base
 * à celui de main (`read-tree -m -u`), fichier par fichier : rien de ce que main ne porte pas ne reste.
 * Une copie qui porte un écart (porte refusée, en attente) ne bouge pas : la fusionner déciderait à la
 * place de l'utilisateur.
 *
 * ORDRE : la copie d'abord, la base ensuite. La base avancée sur une copie restée en arrière ferait
 * publier, au passage suivant, le retrait de tout ce que main a reçu. L'inverse (copie avancée, base
 * restée) ne fait que republier ce que main contient déjà, que la fusion à trois voies absorbe.
 * La base avance jusqu'au commit de main : la copie porte alors tout main, la base peut donc l'être.
 */

export type MiseAJourDeLaCopie =
  | { fait: 'deja-a-jour' }
  | { fait: 'mise-a-jour'; fichiers: number; main: string; base?: string }
  | { fait: 'laissee'; raison: string }

const message = (erreur: unknown): string =>
  erreur instanceof Error ? erreur.message.trim() : String(erreur)

/** Le commit que nomme `quoi` dans `dossier`, ou `null` (`rev-parse --verify -q` sort en 1). */
async function commit(git: GitRunner, dossier: string, quoi: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', '--verify', '-q', `${quoi}^{commit}`], dossier)).trim() || null
  } catch (erreur) {
    if ((erreur as { code?: unknown } | null)?.code === 1) return null
    throw erreur
  }
}

/**
 * Remet la copie d'un fil à l'état de main (la HEAD du dépôt partagé) quand rien n'y serait perdu.
 * Ne lève pas : chaque refus est rendu avec sa raison, pour être dit dans le fil.
 */
export async function mettreLaCopieDuFilAJour(entree: {
  copie: string
  conversationId: string
  /** Le dépôt partagé : main est sa HEAD, là où la porte fait entrer le travail des fils. */
  depot: string
  runGit?: GitRunner
}): Promise<MiseAJourDeLaCopie> {
  const { copie, conversationId } = entree
  try {
    const git = entree.runGit ?? (await defaultGitRunner())
    const base = await lireLaBaseDuFil({ dossier: copie, conversationId, runGit: git })
    if (!base) return { fait: 'laissee', raison: 'la copie n’a pas de base' }
    const main = await commit(git, entree.depot, 'HEAD')
    if (!main) return { fait: 'laissee', raison: 'main est introuvable' }
    const arbre = async (quoi: string): Promise<string> =>
      (await git(['rev-parse', `${quoi}^{tree}`], copie)).trim()
    const [arbreBase, arbreMain] = await Promise.all([arbre(base), arbre(main)])
    if (arbreBase === arbreMain) return { fait: 'deja-a-jour' }
    const fichiers = (await git(['diff', '--name-only', '-z', arbreBase, arbreMain], copie))
      .split('\0')
      .filter(Boolean).length

    const posee = await avecUneCopieDeLIndex(copie, git, async ({ env, indexReel }) => {
      await git(['add', '-A', '--', '.'], copie, { env })
      const arbreCopie = (await git(['write-tree'], copie, { env })).trim()
      if (arbreCopie !== arbreBase) return false
      // L'index copié vaut l'arbre de la base, fichiers déjà relus : seul l'écart vers main s'écrit.
      await git(['read-tree', '-m', '-u', arbreBase, arbreMain], copie, { env })
      copyFileSync(env.GIT_INDEX_FILE, indexReel)
      return true
    })
    if (!posee)
      return {
        fait: 'laissee',
        raison: 'elle porte du travail qui n’est pas encore entré dans main'
      }
    await git(['update-ref', '--no-deref', 'HEAD', main], copie)
    const avancee = await avancerLaBaseDuFil({
      dossier: copie,
      conversationId,
      depuis: base,
      vers: main,
      runGit: git
    })
    return { fait: 'mise-a-jour', fichiers, main, ...(avancee.ok ? { base: avancee.sha } : {}) }
  } catch (erreur) {
    return { fait: 'laissee', raison: `git a refusé : ${message(erreur)}` }
  }
}

/** La ligne dite dans le fil ; `null` quand il n'y a rien à dire (déjà à jour). */
export function ligneDeMiseAJour(issue: MiseAJourDeLaCopie): string | null {
  if (issue.fait === 'deja-a-jour') return null
  if (issue.fait === 'mise-a-jour')
    return `🔄 Copie du fil mise à jour avec main : ${issue.fichiers} fichier${issue.fichiers > 1 ? 's' : ''} venu${issue.fichiers > 1 ? 's' : ''} des autres fils.`
  return `⚠️ Copie du fil pas mise à jour avec main : ${issue.raison}.`
}
