/**
 * SURVEILLER LES RÉFÉRENCES GIT, pour que la liste des travaux non publiés suive le dépôt.
 *
 * Défaut constaté le 2026-10-19 (conv-360, /salvage) : treize références supprimées à la main
 * (`git update-ref -d`, `git stash drop`) restaient listées dans `get_state.travauxNonPublies`.
 * Cause : le relevé est mis en cache SANS expiration (`run-worktree-coordinator.ts`,
 * `travauxNonPubliesCaches`) et ne se refait que sur nos propres gestes — fin de run, publication,
 * tri. Un geste git fait HORS de l'app ne le refaisait jamais ; seul un redémarrage le corrigeait.
 *
 * On ne remet PAS d'expiration par le temps : c'est elle qui gelait la fenêtre 18 s par minute
 * (mesure du 2026-08-28). On écoute le FAIT lui-même : un fichier de référence qui change.
 *
 * Ce module ne lance AUCUN processus git : il lit le système de fichiers. Coût à vide : deux
 * veilleurs du système, aucun sondage.
 */
import { readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * Le répertoire git COMMUN d'un dépôt (celui qui porte `refs/` et `packed-refs`), sans lancer git.
 *
 * `.git` est un dossier pour un dépôt ordinaire ; c'est un FICHIER (« gitdir: … ») pour une copie
 * de travail liée, dont le dossier propre pointe vers le commun par son fichier `commondir`.
 */
export function repertoireGitCommun(depot: string): string | undefined {
  const pointGit = join(depot, '.git')
  try {
    if (statSync(pointGit).isDirectory()) return pointGit
    const lien = /^gitdir:\s*(.+)$/m.exec(readFileSync(pointGit, 'utf8'))
    if (!lien) return undefined
    const propre = isAbsolute(lien[1].trim()) ? lien[1].trim() : resolve(depot, lien[1].trim())
    try {
      return resolve(propre, readFileSync(join(propre, 'commondir'), 'utf8').trim())
    } catch {
      return propre
    }
  } catch {
    return undefined
  }
}

/**
 * Ce changement peut-il changer la liste des travaux non publiés ?
 *
 * Le relevé lit `HEAD`, les branches (`refs/heads/…`, dont `autowin/recovery/…` et la branche de
 * base) et les adresses `refs/autowin/{rescue,integration}/…`. Il ignore les branches distantes et
 * les étiquettes : un `git fetch` ne doit pas relancer de relevé. Les fichiers `.lock` sont l'étape
 * intermédiaire d'une écriture git ; son aboutissement (le renommage) produit son propre signal.
 *
 * `nom` est relatif au dossier surveillé ; `null` (plateforme qui ne le dit pas) compte comme un
 * changement — un relevé de trop vaut mieux qu'une liste fausse.
 */
export function changementTouchantLeRecensement(
  dossier: 'racine' | 'refs',
  nom: string | null
): boolean {
  if (nom === null) return true
  const chemin = nom.replace(/\\/g, '/')
  if (chemin.endsWith('.lock')) return false
  if (dossier === 'racine') return chemin === 'packed-refs' || chemin === 'HEAD'
  return (
    chemin === 'heads' ||
    chemin.startsWith('heads/') ||
    chemin === 'autowin' ||
    chemin.startsWith('autowin/')
  )
}

/**
 * Appelle `siChange` après tout changement de référence qui touche le relevé, regroupé : une
 * rafale (un salvage supprime treize références d'affilée) ne produit qu'UN appel, `delaiMs`
 * après le dernier signal.
 *
 * Rend la fonction qui arrête la surveillance, ou `undefined` quand le dépôt n'est pas
 * surveillable (pas de `.git`, veilleur refusé par le système) : le relevé garde alors ses
 * déclencheurs internes, exactement comme avant.
 *
 * `persistent: false` : la surveillance ne retient jamais l'application ouverte.
 */
export function surveillerReferencesGit(
  depot: string,
  siChange: () => void,
  options: { delaiMs?: number } = {}
): (() => void) | undefined {
  const commun = repertoireGitCommun(depot)
  if (!commun) return undefined
  const delaiMs = options.delaiMs ?? 500
  const veilleurs: FSWatcher[] = []
  let minuterie: ReturnType<typeof setTimeout> | undefined
  let arrete = false

  const arreter = (): void => {
    arrete = true
    if (minuterie) clearTimeout(minuterie)
    minuterie = undefined
    for (const veilleur of veilleurs.splice(0)) {
      try {
        veilleur.close()
      } catch {
        // Un veilleur déjà fermé par le système n'a plus rien à libérer.
      }
    }
  }

  const signaler = (): void => {
    if (arrete) return
    if (minuterie) clearTimeout(minuterie)
    minuterie = setTimeout(() => {
      minuterie = undefined
      if (!arrete) siChange()
    }, delaiMs)
    minuterie.unref?.()
  }

  const enPanne = (erreur: unknown): void => {
    if (arrete) return
    // Le dépôt a disparu ou le système retire le veilleur : on le DIT, et le relevé retombe sur
    // ses déclencheurs internes (fin de run, publication, tri) — le comportement d'avant.
    console.warn(
      `[travaux non publiés] surveillance des références git arrêtée (${commun})`,
      erreur
    )
    arreter()
  }

  try {
    veilleurs.push(
      watch(commun, { persistent: false }, (_type, nom) => {
        if (changementTouchantLeRecensement('racine', nom)) signaler()
      })
    )
    veilleurs.push(
      watch(join(commun, 'refs'), { persistent: false, recursive: true }, (_type, nom) => {
        if (changementTouchantLeRecensement('refs', nom)) signaler()
      })
    )
  } catch (erreur) {
    enPanne(erreur)
    return undefined
  }
  for (const veilleur of veilleurs) veilleur.on('error', enPanne)
  return arreter
}
