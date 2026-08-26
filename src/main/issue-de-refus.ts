/**
 * TOUT REFUS PORTE SA SORTIE.
 *
 * DEFAUT VECU le 2026-08-25 (conv-1404). `edit_file` a ete refuse HUIT fois de suite sur le meme
 * message. Le refus disait ce qui n'allait pas, jamais quoi faire. L'agent a donc retente la seule
 * chose qu'il savait faire — la meme edition — jusqu'a ce que le budget d'appels coupe le tour :
 * travail perdu, demande perdue, et un utilisateur bloque devant un mur sans poignee.
 *
 * LE LECTEUR DE CES MESSAGES N'EST PAS SEULEMENT HUMAIN. C'est l'agent, et c'est lui qui decide de
 * la suite. Un constat nu le laisse deviner ; un constat SUIVI D'UN GESTE lui donne une prise. La
 * bascule est la meme que celle obtenue le matin meme avec `natureDeLEchec` : nommer la nature d'un
 * echec a remplace huit tentatives aveugles par une correction ciblee.
 *
 * REGLE, tenue par le test d'exhaustivite : un motif ajoute ici SANS sortie fait echouer la suite.
 * Une paraphrase polie du probleme ne compte pas — la sortie doit contenir un VERBE D'ACTION.
 *
 * DEFAUT DE CE MODULE, corrige le 2026-08-25 quelques heures apres sa livraison : deux sorties
 * renvoyaient vers un « bouton de nettoyage » et une reprise « depuis le panneau Worktrees » qui
 * N'EXISTAIENT PAS — la vue n'avait que « choisir un depot » et « rafraichir ». Orienter vers un
 * geste impossible coute PLUS qu'un refus nu : on fait chercher avant de laisser au meme mur. Les
 * gestes existent desormais (`BureauxConserves.tsx`) et le test `issue-de-refus.affordances`
 * verifie que chaque geste nomme ici correspond a un bouton reellement rendu.
 *
 * CE QUE CE MODULE N'EST PAS : une facon d'assouplir une garde. Les refus gardes ici restent des
 * refus ; ils cessent seulement d'etre des culs-de-sac. Quand un refus peut etre EVITE, la reponse
 * n'est pas une meilleure phrase, c'est de le supprimer — comme le pre-vol `base-dirty` ce meme jour.
 */

export type MotifRefus =
  | 'isolation-indisponible'
  | 'isolation-impossible'
  | 'verification-indisponible'
  | 'publication-differee'
  | 'budget-appels'
  | 'budget-depense'
  | 'commande-inconnue'
  | 'capacite-desactivee'
  | 'publication-copie-absente'
  | 'publication-non-publiee'
  | 'publication-conflit'
  | 'publication-copie-liberee'
  | 'publication-sur-branche'
  | 'publication-copie-verrouillee'

/**
 * Constat court, en tete du message : ce qui vient de se passer.
 *
 * LES LIBELLES D'ORIGINE SONT CONSERVES A L'IDENTIQUE, deliberement. Des gardes existants les
 * asseyent (`/budget.*appels/i`, `/appels provider/i`, ...) et d'autres chemins les lisent : les
 * reecrire aurait casse des tests qui protegent un comportement REEL, pour un gain purement
 * cosmetique. Ce module AJOUTE une sortie, il ne renomme rien.
 */
const CONSTATS: Record<MotifRefus, string> = {
  'isolation-indisponible': 'isolation workspace indisponible',
  'isolation-impossible': 'Isolation bloquée',
  'verification-indisponible': 'Vérification du bureau impossible',
  'publication-differee': 'Le bureau a été conservé : publication automatique incomplète',
  'budget-appels': "Budget d'appels provider atteint",
  'budget-depense': 'Budget USD atteint',
  'commande-inconnue': 'Commande inconnue',
  'capacite-desactivee': 'Capacité désactivée',
  'publication-copie-absente': 'Publication impossible (outcome absente) : le bureau n’existe plus',
  'publication-non-publiee':
    'Publication non aboutie (outcome blocked) : le travail n’est pas arrivé sur la base',
  'publication-conflit':
    'Publication en conflit (outcome conflict) : la base a changé sous le bureau',
  'publication-copie-liberee':
    'Rien à publier (outcome libere) : le bureau a été libéré sans travail à porter',
  'publication-sur-branche':
    'Bureau libéré, travail SAUVEGARDÉ (outcome preserve-et-libere) : il vit sur une branche',
  'publication-copie-verrouillee':
    'Bureau verrouillé (outcome refuse) : la copie n’a pas pu être fermée'
}

/**
 * LA SORTIE, motif par motif. Chacune nomme un GESTE que son lecteur peut poser tout de suite.
 *
 * Exporte pour que le test d'exhaustivite parcoure la table plutot qu'une liste recopiee a la main :
 * une liste recopiee se perime en silence, c'est exactement ce qui a laisse trois inventaires de
 * `kind` diverger dans ce depot (voir `pilot-events.test.ts`).
 */
export const ISSUES_CONNUES: Record<MotifRefus, string> = {
  'isolation-indisponible':
    "Le moteur de bureaux n'est pas actif pour ce projet. Ouvre le panneau Worktrees pour l'activer, ou relance l'edition une fois le projet rattache a un depot git.",
  'isolation-impossible':
    "Le bureau n'a pas pu etre cree. Ouvre Worktrees, section « Bureaux conserves », et purge un bureau qui ne sert plus, puis relance — le travail deja fait n'est pas perdu.",
  'verification-indisponible':
    "Rien ne prouve cette edition : le projet ne declare aucun script « test ». Declare-le dans package.json pour obtenir une preuve, ou reprends l'edition en assumant explicitement l'absence de verification.",
  'publication-differee':
    "Le bureau est conserve : rien n'est perdu. Ouvre Worktrees, section « Bureaux conserves » : « Voir le diff » pour juger, « Reprendre » pour republier, « Purger » pour jeter.",
  'budget-appels':
    "Le tour a consomme tous ses appels. Reprends avec « Reprendre en precisant » pour repartir du travail deja fait, ou decoupe la demande en deux etapes plus courtes.",
  'budget-depense':
    "Le tour a atteint son plafond de depense. Reduis la portee de la demande, ou relance en autorisant un budget plus large dans les reglages d'orchestration.",
  'commande-inconnue':
    "Cette commande n'existe pas dans le catalogue. Relis la liste des commandes disponibles et choisis la plus proche.",
  'capacite-desactivee':
    "Cette capacite est desactivee pour ce projet. Ouvre les reglages pour l'activer, ou choisis une commande equivalente encore active.",
  'publication-copie-absente':
    "Ne cherche pas ce bureau, il n'existe plus : ton edition n'a rien ecrit. Relance-la depuis le debut ; si elle echoue encore ici, appelle `retrospective` sur cette conversation pour voir ce que les tours precedents ont deja tente.",
  'publication-non-publiee':
    "Le travail est dans le bureau mais pas sur la base. Ouvre Worktrees, section « Bureaux conserves », « Voir le diff » pour juger puis « Reprendre » pour republier -- ne refais pas l'edition, elle est deja ecrite.",
  'publication-conflit':
    "La base a bouge pendant ton edition : republier a l'identique echouera pareil. Ouvre Worktrees, section « Bureaux conserves », « Voir le diff » pour voir ce qui s'oppose, et resous le conflit avant de reprendre.",
  'publication-copie-liberee':
    "Il n'y a rien a recuperer : le bureau a ete libere sans aucun changement a porter. Verifie que ton edition visait bien un fichier existant, puis relance-la.",
  'publication-sur-branche':
    "Ton travail n'est PAS perdu : il a ete pousse sur une branche dediee avant que le bureau soit libere. Ouvre Worktrees pour retrouver cette branche et la fusionner -- refaire l'edition creerait un doublon.",
  'publication-copie-verrouillee':
    "Un processus tient encore la copie (souvent un test ou un watcher encore vivant). Attends qu'il se termine et relance la MEME edition ; si elle echoue a nouveau, ferme ce qui tourne sur ce bureau avant de reprendre."
}

/** La sortie du motif, ou une chaine vide si le motif est inconnu — on n'invente pas un geste. */
export function issuePour(motif: MotifRefus): string {
  return ISSUES_CONNUES[motif] ?? ''
}

/**
 * Le message complet : CONSTAT, puis detail eventuel, puis SORTIE. L'ordre compte — le lecteur doit
 * savoir ce qui s'est passe avant de savoir quoi faire.
 */
export function refusAvecIssue(motif: MotifRefus, detail?: string): string {
  const constat = CONSTATS[motif] ?? 'Refus'
  const tete = detail ? `${constat} : ${detail}` : constat
  const issue = issuePour(motif)
  return issue ? `${tete} — ${issue}` : tete
}

/**
 * Les issues de publication d'un bureau, telles que les rend `WorktreeManager`.
 *
 * Seules figurent ici celles qui font ECHOUER la mutation. `merged`, `nothing`, `cleanup-pending`
 * et `published-residue` sont des succes ou des reports : elles ne produisent aucun refus.
 */
export type OutcomeDePublication =
  | 'absente'
  | 'blocked'
  | 'conflict'
  | 'libere'
  | 'preserve-et-libere'
  | 'refuse'

/**
 * Chaque issue a SON motif, donc son constat et son geste.
 *
 * Les six retombaient sur `publication-differee`, un message unique qui promettait « Ouvre
 * Worktrees, section Bureaux conserves » -- geste IMPOSSIBLE sur `absente` et `libere`, ou le
 * bureau n'existe plus, et geste FAUX sur `preserve-et-libere`, ou le travail vit sur une branche.
 */
const MOTIF_PAR_OUTCOME: Record<OutcomeDePublication, MotifRefus> = {
  absente: 'publication-copie-absente',
  blocked: 'publication-non-publiee',
  conflict: 'publication-conflit',
  libere: 'publication-copie-liberee',
  'preserve-et-libere': 'publication-sur-branche',
  refuse: 'publication-copie-verrouillee'
}

/**
 * Le refus d'une publication, nomme par CE QUI s'est passe.
 *
 * `detail` sert a ce que le message porte la circonstance (fichiers en conflit, nom de branche),
 * jamais le nom de l'outil : `edit_file` est deja affiche au-dessus du message, le repeter
 * consommait la seule place ou une information utile pouvait tenir.
 */
export function refusPourOutcome(outcome: OutcomeDePublication, detail?: string): string {
  return refusAvecIssue(MOTIF_PAR_OUTCOME[outcome], detail)
}
