/**
 * LES RUNS EN COURS, COMPTÉS PAR LE MOTEUR, pour la mascotte du bureau (conv-1196, 2026-10-28 —
 * scout « à quoi pourrait servir la mascotte », ligne 1 retenue par l'utilisateur : le compte des
 * runs se fige une fois la fenêtre principale fermée).
 *
 * Avant, la bille recevait ce nombre de l'interface (`os:presence`, envoyé par `ChatView`). Fenêtre
 * fermée, plus personne ne l'envoyait : un run fini pendant qu'Autowin vivait dans la zone de
 * notification laissait « au travail · 1 » jusqu'au retour de la fenêtre ; au démarrage, aucun run
 * n'était compté tant que l'onglet Chat n'avait pas été ouvert (`App.tsx` ne monte `ChatView`
 * qu'à sa première visite).
 *
 * Le moteur compte donc lui-même, sur les événements qu'il diffuse déjà (`broadcast` dans
 * `index.ts`, passage unique de `orchestrate-start` / `orchestrate-end`). Même règle que la liste de
 * l'interface (`reduceScopedLiveRuns`, `chat-view-model.ts`) : un run par fil, un nouveau départ
 * remplace l'ancien, une fin qui nomme un AUTRE run du même fil ne ferme rien, un événement sans fil
 * est ignoré. Module sans Electron : testé seul.
 */

/** Ce que le compte lit d'un événement de l'app (`AppEvent`, `commands.ts`). */
export type EvenementDeRun = { type: string; convId?: string; runPath?: string }

export type CompteDesRuns = {
  /** À appeler sur CHAQUE événement diffusé : seuls le départ et la fin d'un run comptent. */
  evenement: (evenement: EvenementDeRun) => void
  nombre: () => number
}

export function creerCompteDesRuns(): CompteDesRuns {
  /** Fil -> run en cours (son chemin quand l'événement le donne). */
  const enCours = new Map<string, string | undefined>()
  return {
    evenement: ({ type, convId, runPath }) => {
      if (!convId) return
      if (type === 'orchestrate-start') {
        enCours.set(convId, runPath)
        return
      }
      if (type !== 'orchestrate-end' || !enCours.has(convId)) return
      const runDuFil = enCours.get(convId)
      if (runPath && runDuFil && runPath !== runDuFil) return
      enCours.delete(convId)
    },
    nombre: () => enCours.size
  }
}
