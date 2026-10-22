/**
 * LA SEULE PORTE VERS `fs.watch` DANS LE PROCESSUS PRINCIPAL — elle canonicalise TOUJOURS le chemin.
 *
 * Défaut reproduit deux fois. Le 2026-08-31 : `fs.watch` sur un dossier atteint par un nom court
 * 8.3 de Windows (`C:\Users\PRENOM~1.NOM\...`, la forme que rend `os.tmpdir()` sur ce poste) fait
 * ABORTER le processus : `Assertion failed: !_wcsnicmp(filename, dir, dirlen), file
 * src\win\fs-event.c, line 72`, code 127. libuv compare le nom LONG que Windows lui rend dans
 * l'événement au chemin COURT qu'on lui a donné : ils diffèrent, il assert. Corrigé alors par
 * `realCanonique`, mais dans `providers/workspace-mutation-evidence.ts` SEULEMENT. Le 2026-10-19,
 * un nouveau veilleur (`store/surveillance-references-git.ts`, 0d1b527a) a rappelé `watch` en
 * direct : la suite entière mourait de nouveau en code 127 (contrôle final de conv-1056,
 * 2026-10-22).
 *
 * La cause de la RÉCIDIVE n'était pas un oubli isolé : chaque nouveau veilleur devait se souvenir
 * de canonicaliser. Désormais il passe par ici, et `surveiller-dossier.test.ts` refuse tout autre
 * fichier de `src/main` qui importerait `watch` de `node:fs`.
 *
 * Un `abort()` en C n'est pas une exception JS : ni `try/catch` ni `watcher.on('error')` ne le
 * rattrapent. Seule la canonicalisation AVANT l'appel protège.
 */
import { realpathSync, watch, type FSWatcher, type WatchListener } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Forme CANONIQUE (nom long, casse réelle) d'un chemin — la seule que `fs.watch` accepte sans tuer
 * le processus. Un chemin encore absent (cas normal : on surveille l'apparition d'un fichier) n'a
 * pas de realpath : on canonicalise alors son parent et on rattache le nom.
 */
export function realCanonique(chemin: string): string {
  try {
    return realpathSync.native(chemin)
  } catch {
    const parent = dirname(chemin)
    if (parent === chemin) return chemin
    try {
      return join(realpathSync.native(parent), basename(chemin))
    } catch {
      return chemin
    }
  }
}

/** `fs.watch` sur la forme canonique de `chemin` ; mêmes options, même veilleur rendu. */
export function surveillerDossier(
  chemin: string,
  options: { persistent?: boolean; recursive?: boolean },
  ecouteur: WatchListener<string>
): FSWatcher {
  return watch(realCanonique(chemin), options, ecouteur)
}
