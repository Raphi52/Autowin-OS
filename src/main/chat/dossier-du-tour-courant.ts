import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * LE DOSSIER DE TRAVAIL DU TOUR, PORTE PAR LE TOUR LUI-MEME.
 *
 * Le dossier de travail etait GLOBAL et fige au demarrage (`os.ts`, `executionWorkspace`). Le tour de
 * chat a cesse d'en dependre le 2026-09-08 (le cwd du CLI est PASSE, cf. `dossierDeTravailDuTour`),
 * mais les COMMANDES declenchees pendant ce meme tour le lisaient encore : le modele parlait d'un
 * projet et ecrivait dans un autre.
 *
 * Pourquoi un stockage de contexte asynchrone et NON un champ du bus : plusieurs tours tournent en
 * parallele (deux conversations rangees dans deux projets). Un champ mutable pose au debut d'un
 * `exec` serait ecrase par le tour voisin entre deux `await` — chacun se volerait le dossier de
 * l'autre. C'est le meme piege que `process.env`, deja nomme dans `bascule-dossier-conversation.ts`.
 * `AsyncLocalStorage` suit la chaine d'`await` de CHAQUE appel, sans passer le dossier en argument a
 * travers les dizaines de methodes privees du bus.
 */
const stockage = new AsyncLocalStorage<string>()

/** Execute `travail` avec `dossier` pour dossier de travail. Vide → on laisse le repli en place. */
export function avecDossierDuTour<T>(dossier: string | undefined, travail: () => T): T {
  const propre = dossier?.trim()
  return propre ? stockage.run(propre, travail) : travail()
}

/** Le dossier du tour en cours, ou `undefined` hors de tout tour (appel IPC direct, demarrage). */
export function dossierDuTourCourant(): string | undefined {
  return stockage.getStore()
}
