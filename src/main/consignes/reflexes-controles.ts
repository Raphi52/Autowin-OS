/**
 * CHAQUE RÉFLEXE DE LA CONSTITUTION, LE CODE QUI LE TIENT, ET LE SIGNE QU'ON L'A SAUTÉ.
 *
 * Une règle écrite que rien ne contrôle se lit, puis s'oublie. Ce tableau dit, pour chacun des 14
 * réflexes de `constitution.ts`, quel code l'applique réellement (fichier + symbole), ou qu'aucun ne
 * le peut (« jugement — pas de contrôle possible »), et à quoi on voit dans une trace qu'il a été
 * sauté. La constitution n'est pas touchée : le tableau la regarde.
 *
 * `reflexes-controles.test.ts` le tient : un réflexe sans ligne, un fichier déplacé ou un symbole
 * renommé le font passer au rouge. Une ligne « jugement » est l'endroit où un futur contrôle
 * manque ; en écrire un, c'est remplacer la mention par son fichier.
 */

export const JUGEMENT = 'jugement — pas de contrôle possible' as const

export interface ControleDuReflexe {
  /** Chemin depuis la racine du dépôt, en `/`. */
  fichier: string
  /** Fonction ou constante de ce fichier qui applique le réflexe. */
  symbole: string
}

export interface LigneReflexe {
  numero: number
  reflexe: string
  controles: readonly ControleDuReflexe[] | typeof JUGEMENT
  /** Ce qu'on lit dans une trace quand le réflexe a été sauté. */
  signe: string
}

export const REFLEXES_CONTROLES: readonly LigneReflexe[] = [
  {
    numero: 1,
    reflexe: 'Question dérivable du fil ou du dépôt : énoncer l’hypothèse et avancer',
    controles: JUGEMENT,
    signe: 'le tour se termine sur une question dont la réponse est déjà dans le fil ou le dépôt'
  },
  {
    numero: 2,
    reflexe: 'Pas de « fait » ni de « vert » sans preuve hors modèle',
    controles: [
      { fichier: 'src/main/gates/hooks.ts', symbole: 'requireProofBeforeGreen' },
      { fichier: 'src/main/gates/hooks.ts', symbole: 'requireVisualProofForFrontDiff' },
      { fichier: 'src/main/gardes/root-execution-contract.ts', symbole: 'rootRequirementChecks' }
    ],
    signe:
      '« vert » sans code de sortie ni capture dans la trace, ou interface modifiée sans capture'
  },
  {
    numero: 3,
    reflexe: 'Un rapport se vérifie sur l’artefact réel, jamais sur parole',
    controles: [{ fichier: 'src/main/juge/objections-juge.ts', symbole: 'rejouerTestsDuJuge' }],
    signe:
      'un reproche du juge bloque alors que son propre `TEST:` passe déjà (rejeu « non reproduit »)'
  },
  {
    numero: 4,
    reflexe:
      'Demande en forme de solution : remonter au besoin, chercher l’existant avant de créer',
    controles: JUGEMENT,
    signe: 'un fichier ou une fonction créés alors qu’un équivalent existait déjà (doublon)'
  },
  {
    numero: 5,
    reflexe: 'Objectif ouvert : plusieurs options notées, l’utilisateur tranche',
    controles: JUGEMENT,
    signe: 'une seule voie proposée, ou une option choisie sans que l’utilisateur ait tranché'
  },
  {
    numero: 6,
    reflexe: 'Leçon écrite après la cause vérifiée, déposée ou écrite, jamais promise',
    controles: JUGEMENT,
    signe:
      'une ligne « la prochaine fois, je ferai X », ou une leçon dont la cause n’a pas été reproduite'
  },
  {
    numero: 7,
    reflexe: 'Bloqué après deux ou trois approches : en changer, ne pas répéter',
    controles: [
      { fichier: 'src/main/gates/hooks.ts', symbole: 'detectBlindFixLoop' },
      { fichier: 'src/main/gates/stopgate.ts', symbole: 'memeRefus' },
      { fichier: 'src/main/modeles/route-drift.ts', symbole: 'exprimeUnDoute' }
    ],
    signe:
      'trois éditions du même fichier sans cause nommée, ou le même refus du juge deux fois de suite'
  },
  {
    numero: 8,
    reflexe:
      'Se relire avant un verdict ou une conclusion négative ; sonder avant de dire « impossible »',
    controles: JUGEMENT,
    signe: '« bloqué » ou « impossible » sans la liste de ce qui a été sondé'
  },
  {
    numero: 9,
    reflexe: 'Agir sur le nommé seulement',
    controles: [
      { fichier: 'src/main/gardes/root-execution-contract.ts', symbole: 'ciblesNommees' },
      { fichier: 'src/main/gardes/root-execution-contract.ts', symbole: 'cibleNommeeTouchee' }
    ],
    signe:
      'la cible nommée reste intacte, ou des fichiers non nommés changent « par cohérence » (ce second côté n’est pas contrôlé)'
  },
  {
    numero: 10,
    reflexe: 'Une opération sûre, bornée et réversible ne se re-confirme pas : elle se fait',
    controles: JUGEMENT,
    signe:
      'le tour finit sur « je continue ? » ou sur une vérification recommandée au lieu d’être faite'
  },
  {
    numero: 11,
    reflexe: 'Beaucoup de lecture : lecture ciblée, rendre la conclusion',
    controles: JUGEMENT,
    signe: 'un arbre entier lu « pour le contexte », ou le contenu lu recopié dans la réponse'
  },
  {
    numero: 12,
    reflexe: 'Changement de sujet : une ligne de point d’étape',
    controles: JUGEMENT,
    signe: 'une tâche commencée qui disparaît du fil sans « livrée » ni « suspendue »'
  },
  {
    numero: 13,
    reflexe: 'Kaizen : éditions précises, vérifiées, chacune en commit dédié',
    controles: JUGEMENT,
    signe: 'plusieurs améliorations mêlées dans un seul changement, ou une édition sans preuve'
  },
  {
    numero: 14,
    reflexe: 'Dépôt partagé : prévenir le conflit avant d’écrire',
    controles: [
      { fichier: 'src/shared/garde-git-destructeur.ts', symbole: 'refusGitDestructeur' },
      { fichier: 'scripts/garde-ecriture-hors-copie.mjs', symbole: 'refusEcritureHorsCopie' }
    ],
    signe:
      '`git stash`, `reset --hard` ou une écriture dans le dossier partagé depuis une copie de travail'
  }
]
