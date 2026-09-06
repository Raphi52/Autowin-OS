import { execFileSync } from 'node:child_process'
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
