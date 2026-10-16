/**
 * Le MODÈLE de prompt d'une tâche du Task Manager — une seule source, lue par deux publics :
 *  - l'agent, dans la description de la commande `task_create` (src/main/commands.ts), forme courte ;
 *  - l'utilisateur, en exemple grisé du champ « Prompt envoyé » (TaskManagerView.tsx), forme longue.
 *
 * Demande de l'utilisateur (conv-983, 2026-10-16) : « dans autowin utilise-la dès que possible ».
 * Pourquoi ces blocs, et pas d'autres :
 *  - le prompt part SEUL dans la conversation (`runtime.runPrompt(conversationId, prompt)`,
 *    src/main/task-manager/chat-dispatch.ts) : aucun fil n'est relu, il doit se suffire ;
 *  - « Fait = » : c'est la PRÉSENCE du critère dans le prompt qui fait la justesse — banc /arena du
 *    2026-09-07, même tâche : 9/28 contrôles en échec sans critère, 28/28 verts avec (commit
 *    3142b58a). Exiger en plus de « boucler jusqu'au vert » coûtait +34 % sans être plus juste : le
 *    modèle ne le demande donc pas ;
 *  - « Si rien à faire » : sans sortie prévue pour ce cas, l'agent fabrique du travail (modèle : la
 *    tâche mails, src/main/task-manager/watchdog-mail.ts) ;
 *  - aucune limite de temps (préférence de l'utilisateur, 2026-10-01).
 * Pour une règle de surveillance, l'événement et la ligne `ISSUE:` sont ajoutés par l'app
 * (`buildWatchdogPrompt`) : le prompt ne les répète pas.
 */

interface BlocDuModele {
  /** Ce qui ouvre la ligne, tel que l'auteur l'écrit. */
  tete: string
  /** Forme courte, pour une description d'outil lue à chaque tour. */
  court: string
  /** Forme complète, avec exemples, pour l'écran. */
  long: string
}

const BLOCS: readonly BlocDuModele[] = [
  { tete: '<Verbe> <cible nommée> —', court: 'pourquoi', long: 'pourquoi, en une phrase.' },
  {
    tete: 'Contexte :',
    court: 'ce que l’agent ne peut pas deviner',
    long: 'ce que l’agent ne peut pas deviner (chemins, comptes, état attendu).'
  },
  {
    tete: 'Fait =',
    court: 'critère vérifiable (exit 0, fichier présent, N lignes)',
    long: 'critère vérifiable (commande + exit 0, fichier présent, N lignes rendues).'
  },
  {
    tete: 'Si rien à faire :',
    court: 'la sortie exacte à rendre',
    long: 'la sortie exacte à rendre (ex. « RAS »).'
  },
  {
    tete: 'Interdit :',
    court: 'ce qui ne doit jamais être touché ni envoyé',
    long: 'ce qui ne doit jamais être touché ni envoyé.'
  },
  {
    tete: 'Rends :',
    court: 'le format, avec une dernière ligne repérable',
    long: 'le format, avec une dernière ligne repérable (ex. ETAT: vert | rouge).'
  }
]

const RACCOURCI_SKILL = '/<skill> <objet> : <résultat attendu>'

/** Forme longue, une ligne par bloc : l'exemple grisé du champ prompt de l'écran. */
export const MODELE_PROMPT_TACHE = [
  ...BLOCS.map((bloc) => `${bloc.tete} ${bloc.long}`),
  `Ou, si une skill le fait déjà : ${RACCOURCI_SKILL}`
].join('\n')

/** Forme courte, sur une ligne : ce que l'agent lit dans la description de `task_create`. */
export const MODELE_PROMPT_TACHE_COURT = `${BLOCS.map((bloc) => `${bloc.tete} ${bloc.court}`).join(
  ' / '
)} ; ou, si une skill fait déjà le travail : ${RACCOURCI_SKILL}`

/** Les têtes de ligne du modèle, dans l'ordre : ce que les tests vérifient dans chaque forme. */
export const TETES_DU_MODELE_PROMPT_TACHE: readonly string[] = BLOCS.map((bloc) => bloc.tete)
