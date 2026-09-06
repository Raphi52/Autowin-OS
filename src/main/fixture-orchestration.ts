import { execFileSync } from 'node:child_process'
import type { ExecutionEvidence, ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import type { BrainRetrievalResult } from './brain-retrieval'
import { ALL_ROLES, RoleModelConfig } from './roles'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * FIXTURE D'ORCHESTRATION — scénario `nominal`, son dépôt jetable et son garde-fou.
 *
 * Cadrage complet : `docs/fixture-orchestration-cadrage-2026-09-06.md`. En un paragraphe : trois
 * preuves hors-modèle observent l'ORCHESTRATEUR — politique de relance, outils d'un nœud skill,
 * propreté des bureaux après trois runs — et coûtent aujourd'hui de vrais agents. On remplace donc
 * le FOURNISSEUR, jamais le pipeline : les phases, les juges et les portes restent les vrais, seul
 * l'appel au modèle rend une réponse écrite d'avance.
 *
 * CE MODULE NE FAIT QUE LA MOITIÉ BASSE : le dépôt jetable, le garde-fou, et la réponse
 * déterministe. Le raccordement au registre de l'orchestrateur est une étape distincte.
 */

/** Le seul scénario implémenté pour l'instant. Un troisième ne s'ajoute pas « au cas où ». */
export type ScenarioOrchestration = 'nominal'

/**
 * MARQUEUR D'UN DÉPÔT JETABLE.
 *
 * Le garde-fou ne peut pas se contenter de « c'est un dépôt git » : le dépôt RÉEL en est un. Il
 * faut un signe que la fixture a POSÉ elle-même. Ce fichier est ce signe.
 */
export const MARQUEUR_DEPOT_JETABLE = '.autowin-depot-jetable'

/**
 * Le fichier que le scénario nominal fait écrire par le run.
 *
 * Nommé pour être reconnaissable au premier coup d'œil : si un jour il apparaît hors du dépôt
 * jetable, personne ne se demandera d'où il sort.
 */
export const FICHIER_ECRIT_PAR_LA_FIXTURE = 'FIXTURE-ORCHESTRATION-jetable.md'

/**
 * POURQUOI CE GARDE-FOU EXISTE, et pourquoi il lève au lieu d'avertir.
 *
 * Le plan de travail se résout en cascade (`resolveExecutionWorkspace`) et son avant-dernier repli
 * est le dépôt git DU DOSSIER DE L'EXÉCUTABLE : pour un paquet dans `dist/win-unpacked`, cela
 * remonte au dépôt réel. Ce n'est pas théorique — `scripts/cdp-relance-jusquau-vert-proof.mjs`
 * porte l'avertissement dans son en-tête, et un agent y a écrit un fichier le 2026-08-21.
 *
 * La fixture ÉCRIT (sans écriture, la copie de travail reste vide et le balayage la supprime par
 * son chemin trivial : la preuve serait verte par construction). Écrire dans le vrai dépôt à chaque
 * construction serait donc le prix d'une preuve — un prix inacceptable. Se fier à l'ordre de la
 * cascade serait un pari ; on VÉRIFIE.
 */
export function assertDepotJetable(workspace: string): void {
  if (!workspace) throw new Error('Fixture orchestration : aucun plan de travail fourni.')
  if (!existsSync(join(workspace, MARQUEUR_DEPOT_JETABLE)))
    throw new Error(
      `Fixture orchestration : « ${workspace} » ne porte pas ${MARQUEUR_DEPOT_JETABLE} — ` +
        "ce n'est pas un dépôt jetable, et la fixture refuse d'y écrire."
    )
  if (!existsSync(join(workspace, '.git')))
    throw new Error(
      `Fixture orchestration : « ${workspace} » porte le marqueur mais n'est pas un dépôt git.`
    )
}

/**
 * Crée le dépôt jetable et rend son chemin. Idempotent : rappelé sur un dépôt déjà créé, il le rend
 * tel quel plutôt que de l'écraser — un run interrompu ne doit pas perdre ce qu'il observait.
 *
 * L'identité git est posée LOCALEMENT : sur une machine sans `user.email` global, `git commit`
 * échoue, et la fixture tomberait sur une panne d'environnement au lieu de son sujet.
 */
export function creerDepotJetable(racine: string): string {
  if (existsSync(join(racine, MARQUEUR_DEPOT_JETABLE)) && existsSync(join(racine, '.git')))
    return racine
  mkdirSync(racine, { recursive: true })
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: racine, stdio: 'ignore' })
  }
  git('init', '-b', 'main')
  git('config', 'user.email', 'fixture@autowin.local')
  git('config', 'user.name', 'Fixture Orchestration')
  writeFileSync(
    join(racine, MARQUEUR_DEPOT_JETABLE),
    "Dépôt CRÉÉ par la fixture d'orchestration, et supprimable sans regret.\n",
    'utf8'
  )
  writeFileSync(
    join(racine, 'README.md'),
    '# Dépôt jetable\n\nUn run de fixture a besoin d’une base à laquelle se comparer.\n',
    'utf8'
  )
  git('add', '-A')
  git('commit', '-m', 'base du depot jetable')
  /*
   * UN DISTANT `origin`, LOCAL ET NU — trouvé en jouant le run, pas en lisant le code.
   *
   * Premier lancement réel du scénario nominal : le run s'arrête avant toute phase sur « Lancement
   * bloqué : le distant origin est absent ». Le contrôle est LÉGITIME — un run qui publie a besoin
   * de savoir où — et le dépôt réel en a un, donc rien ne l'avait révélé jusqu'ici.
   *
   * Le distant est un dépôt NU posé à côté : la publication reste réelle et vérifiable, sans jamais
   * sortir du profil isolé ni joindre le réseau.
   */
  const distant = `${racine}-origin.git`
  if (!existsSync(distant)) {
    mkdirSync(distant, { recursive: true })
    execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: distant, stdio: 'ignore' })
    git('remote', 'add', 'origin', distant)
    git('push', '-u', 'origin', 'main')
  }
  return racine
}

/** Le rôle que l'orchestrateur donne à l'appel en cours, tel qu'il le nomme lui-même. */
export type RoleAppel = 'judge' | 'orchestrator' | 'sous-agent'

/**
 * LA RÉPONSE DÉTERMINISTE DU SCÉNARIO `nominal` — un run qui passe au VERT du premier coup.
 *
 * Ce que la sonde observe n'est pas le texte : c'est la DÉCISION. Le juge doit donc rendre la forme
 * exacte que `lireVerdictJuge` accepte (le brief impose « VALIDE » ou « DEFAUT: <raison> »), et le
 * sous-agent doit produire une écriture réelle — sinon la copie de travail reste vide.
 *
 * Aucune commande mutante n'est émise par la fixture elle-même : c'est le run qui écrit, par le
 * chemin normal. Le déterminisme s'arrête où l'environnement commence.
 */
export function reponseFixtureNominale(role: RoleAppel): string {
  if (role === 'judge') return 'VALIDE'
  if (role === 'sous-agent')
    return (
      `<cmd>{"name":"edit_file","args":{"path":${JSON.stringify(FICHIER_ECRIT_PAR_LA_FIXTURE)},` +
      `"oldText":"","newText":"Écrit par la fixture d’orchestration.\n"}}</cmd>`
    )
  return 'Travail terminé.'
}

/**
 * LE DÉCLENCHEUR — un préfixe dans la tâche, comme pour les fixtures de chat.
 *
 * Rend le scénario demandé, ou `undefined` si la tâche n'en demande aucun.
 *
 * DEUX REFUS DÉLIBÉRÉS, chacun pour une raison différente :
 *   · hors instance isolée, le préfixe est IGNORÉ — pas d'erreur, pas de fixture : la porte ne doit
 *     simplement pas exister en production ;
 *   · un scénario INCONNU lève. Un préfixe mal orthographié qui retomberait silencieusement sur un
 *     vrai run payant serait le pire des résultats — mieux vaut une erreur bruyante.
 */
export const PREFIXE_FIXTURE_ORCHESTRATION = '[[autowin-fixture-orchestration]]'

export function scenarioDemande(
  task: string,
  argv: readonly string[] = process.argv
): ScenarioOrchestration | undefined {
  if (!task.startsWith(PREFIXE_FIXTURE_ORCHESTRATION)) return undefined
  if (!argv.includes('--isolated-test-instance')) return undefined
  const demande = task.slice(PREFIXE_FIXTURE_ORCHESTRATION.length).trim().split(/\s+/)[0] ?? ''
  if (demande !== 'nominal')
    throw new Error(
      `Fixture orchestration : scénario inconnu « ${demande} ». Le seul implémenté est « nominal ».`
    )
  return 'nominal'
}

/**
 * LE RÔLE DE L'APPEL, déduit du libellé que l'orchestrateur donne lui-même à chaque envoi.
 *
 * L'orchestrateur passe par `sendWithRoleContext(<libellé>, <rôle>, …)` : le rôle est donc déjà
 * nommé à la source. On le traduit dans le vocabulaire de la fixture plutôt que de deviner d'après
 * le contenu du prompt — deviner d'après le texte, c'est exactement ce qui a fait échouer quatre
 * sondes cette semaine.
 */
export function roleDeLAppel(role: string): RoleAppel {
  if (role === 'judge') return 'judge'
  if (role === 'orchestrator') return 'orchestrator'
  return 'sous-agent'
}

/**
 * LE FOURNISSEUR DE LA FIXTURE — il rend une réponse écrite d'avance, sans appeler personne.
 *
 * Il ne remplace QUE le fournisseur : les phases, les juges, les portes et les bureaux restent les
 * vrais. C'est toute la thèse du cadrage — un pipeline factice ne prouverait rien du produit.
 *
 * `role` lui est donné par l'appelant, qui le tient de l'orchestrateur lui-même : la fixture ne
 * devine JAMAIS d'après le contenu du prompt.
 */
export function fournisseurFixtureOrchestration(
  scenario: ScenarioOrchestration
): ProviderAdapter {
  return {
    id: ID_FOURNISSEUR_FIXTURE,
    /*
     * ELLE DÉCLARE UN EXÉCUTEUR LOCAL — et elle en produit vraiment l'effet.
     *
     * Trouvé en jouant le run : « Phase build — le rôle subagent est bindé sur
     * autowin-orchestration-fixture : Provider sans exécuteur local outillé ». Le contrôle est
     * juste. Chez les vrais fournisseurs CLI, c'est l'AGENT qui écrit les fichiers, pas
     * l'orchestrateur : une fixture qui remplace l'agent doit donc écrire à sa place, sinon la
     * copie de travail reste vide — et le cadrage a établi qu'une copie vide rend la preuve des
     * bureaux verte par construction.
     */
    supportsExecution: true,
    async *send(
      _messages: unknown,
      options?: { execution?: { phaseAppelante?: string; cwd?: string } }
    ): AsyncGenerator<StreamChunk, SendResult, void> {
      /*
       * LA PHASE VIENT DE L'ORCHESTRATEUR, PAS DU TEXTE.
       *
       * `options.execution.phaseAppelante` est posé par `executionOptions` à chaque envoi. Deviner
       * le rôle d'après le contenu du prompt serait exactement le défaut qui a fait échouer quatre
       * sondes cette semaine : un libellé change, et la fixture répond à côté sans le dire.
       */
      const role = roleDeLAppel(options?.execution?.phaseAppelante ?? '')
      const cwd = options?.execution?.cwd
      if (role === 'sous-agent' && cwd) {
        /*
         * L'ÉCRITURE PASSE PAR LE GARDE-FOU, ici aussi et surtout.
         *
         * C'est le seul endroit du produit où cette fixture touche un disque. Le cwd est une copie
         * de travail du dépôt jetable : elle en porte donc le marqueur, puisqu'il est COMMITTÉ. Si
         * un jour ce n'est pas le cas, on lève au lieu d'écrire.
         */
        assertDepotJetable(cwd)
        writeFileSync(
          join(cwd, FICHIER_ECRIT_PAR_LA_FIXTURE),
          'Écrit par la fixture d’orchestration, dans un dépôt jetable.\n',
          'utf8'
        )
      }
      const texte =
        scenario === 'nominal' && role === 'sous-agent'
          ? 'Fichier écrit, et sa présence vérifiée par une commande.'
          : reponseFixtureNominale(role)
      yield { delta: texte }
      return {
        text: texte,
        provider: ID_FOURNISSEUR_FIXTURE,
        systemInjected: true,
        // La preuve accompagne la MUTATION : c'est la phase qui écrit qui doit la porter.
        ...(role === 'sous-agent' && cwd
          ? { executionEvidence: [preuveExecutableDeLEcriture(cwd)] }
          : {})
      }
    }
  } as ProviderAdapter
}

/**
 * LE CONTEXTE BRAIN, NEUTRALISÉ — sinon le déterminisme s'arrête au premier appel au Brain.
 *
 * Le contexte injecté dépend d'un index et d'un corpus qui vivent HORS du dépôt : deux runs
 * identiques n'y trouvent pas forcément la même chose. Le retriever étant déjà une dépendance
 * substituable, on lui rend un vide constant.
 */
export const retrieveBrainNeutre = (): Promise<BrainRetrievalResult> =>
  // `empty` et non `unavailable` : le Brain n'est pas EN PANNE, il n'a simplement rien a dire —
  // et un run ne doit pas croire a une panne d'infrastructure la ou il n'y en a pas.
  Promise.resolve({ context: '', status: 'empty' })

/** L'identifiant du fournisseur de la fixture — un seul, pour tous les rôles. */
export const ID_FOURNISSEUR_FIXTURE = 'autowin-orchestration-fixture'

/**
 * LES QUATRE RÔLES POINTÉS SUR LA FIXTURE.
 *
 * Trouvé en jouant le run : substituer le registre ne suffit pas. Les rôles gardaient leur liaison
 * vers `claude`, et le run tombait sur « Provider inconnu: claude (connus:
 * autowin-orchestration-fixture) ». Le message était juste — c'est la substitution qui était à
 * moitié faite. Les QUATRE rôles (orchestrator, subagent, judge, scout) doivent être liés, sinon le
 * premier rôle oublié rappelle un vrai fournisseur, et la fixture n'est plus gratuite.
 */
export function rolesFixture(): RoleModelConfig {
  return new RoleModelConfig(
    Object.fromEntries(
      ALL_ROLES.map((role) => [role, { provider: ID_FOURNISSEUR_FIXTURE, model: 'deterministe' }])
    )
  )
}

/**
 * LA PREUVE EXÉCUTABLE — réellement exécutée, jamais déclarée.
 *
 * La porte `done-without-proof` refuse le vert sans « au moins une preuve d'exécution ok ». La
 * tentation serait de rendre un `ok: true` de complaisance : ce serait neutraliser une porte, ce que
 * le cadrage interdit — et fabriquer précisément le faux vert que ce chantier combat.
 *
 * On exécute donc une VRAIE commande, dont on rapporte le VRAI code de sortie : `git status
 * --porcelain` sur le fichier que la fixture vient d'écrire. L'oracle est déterministe et
 * falsifiable — si l'écriture n'a pas eu lieu, la sortie est vide et la preuve est `ok: false`.
 */
export function preuveExecutableDeLEcriture(cwd: string): ExecutionEvidence {
  const commande = `git status --porcelain -- ${FICHIER_ECRIT_PAR_LA_FIXTURE}`
  let sortie = ''
  let code = 0
  try {
    sortie = execFileSync(
      'git',
      ['status', '--porcelain', '--', FICHIER_ECRIT_PAR_LA_FIXTURE],
      { cwd, encoding: 'utf8' }
    )
  } catch (erreur) {
    code = 1
    sortie = erreur instanceof Error ? erreur.message : String(erreur)
  }
  const vue = sortie.includes(FICHIER_ECRIT_PAR_LA_FIXTURE)
  return {
    type: 'command_execution',
    kind: 'verification',
    status: vue && code === 0 ? 'completed' : 'failed',
    ok: vue && code === 0,
    oracleStable: true,
    summary: vue
      ? `Le fichier ${FICHIER_ECRIT_PAR_LA_FIXTURE} est bien présent dans la copie de travail.`
      : `Le fichier ${FICHIER_ECRIT_PAR_LA_FIXTURE} est ABSENT : l'écriture n'a pas eu lieu.`,
    command: commande,
    exitCode: code,
    stdout: sortie.slice(0, 500),
    path: FICHIER_ECRIT_PAR_LA_FIXTURE,
    paths: [FICHIER_ECRIT_PAR_LA_FIXTURE],
    workspaceRoot: cwd
  }
}
