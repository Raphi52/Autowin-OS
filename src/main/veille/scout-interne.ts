/**
 * SCOUT INTERNE — des candidats d'AJOUT nés de l'app elle-même, pas d'un changelog concurrent.
 *
 * Demande utilisateur du 2026-08-13 : l'onglet Tickets > « Autowin OS » ne doit pas proposer que des
 * idées venues des concurrents — un scout doit analyser les conversations réellement loggées
 * (Observatory : cost.jsonl, prompt-observability, runs), les workflows et le code, et en tirer des
 * candidats de NOUVELLES CAPACITÉS. C'est le pendant « ajouts » d'`audit-interne` (qui, lui, produit
 * les corrections, par détecteurs déterministes) : ici la découverte est un jugement, donc un agent —
 * mais la PREUVE reste exigée, comme pour la veille web : chaque candidat porte un ancrage interne
 * (`fichier:ligne`) et une citation recopiée d'un artefact réellement lu. `trierCandidats` refuse déjà
 * ce qui n'en porte pas — le même contrôle en aval que pour le web, aucun chemin privilégié.
 */
export interface ParametresScoutInterne {
  /** Racine du dépôt — le scout y lit le code et les workflows. */
  racineDepot: string
  /** Racine de données de l'app — cost.jsonl, prompt-observability/, runs/, turn-journals/. */
  racineDonnees: string
}

export function construirePromptScoutInterne(params: ParametresScoutInterne): string {
  return [
    'Tu analyses Autowin OS DE L’INTÉRIEUR pour proposer des NOUVELLES CAPACITÉS (features), pas des',
    'corrections de bugs. Tes matières premières sont les traces d’usage réelles et le code :',
    `- traces d’usage : ${params.racineDonnees} (cost.jsonl, prompt-observability/, runs/, turn-journals/) ;`,
    `- code et workflows : ${params.racineDepot} (src/main, src/renderer, .claude/workflows s’il existe).`,
    '',
    'Cherche ce que l’usage RÉEL réclame : gestes répétés à la main dans les conversations, frictions',
    'visibles dans les runs (reprises, échecs récurrents d’une même famille), données loggées mais',
    'jamais exploitées par une vue, workflows que les utilisateurs recomposent à chaque fois.',
    '',
    'MÉTHODE OBLIGATOIRE — explore AVANT de répondre :',
    '1. Ouvre RÉELLEMENT plusieurs artefacts (au moins 5 fichiers : traces d’usage ET code) avec les',
    '   commandes `find_in_files` (motif regex → chemin:ligne) et `read_file` (lignes numérotées,',
    '   pagination from/lines). Une réponse sans lecture préalable ne vaut rien et sera rejetée.',
    '2. Écris ensuite une courte synthèse humaine dans un bloc fermé ```html-render, direction',
    '   « transparence totale » (choix utilisateur du 14/08) : AUCUN panneau ni fond opaque — la',
    '   typographie se pose sur le fond sombre de l’app ; sections séparées par des filets fins',
    '   dégradés or (rgba(212,169,79,.55)→.06) ; kickers en petites capitales monospace or',
    '   (#d4a94f-#e3ba55) ; texte #dde3ee, interlignes 1.7+ ; chemins en chips monospace discrètes',
    '   (fond rgba(255,255,255,.045), bordure rgba(255,255,255,.13)) ; candidats en lignes espacées',
    '   titre — ancrage — score or aligné à droite ; jamais de halos, aucun JavaScript. Contenu :',
    '   fichiers lus, 2-3 lignes de constats, puis les candidats retenus.',
    '3. Termine par le tableau JSON strict, en dernière position du message, DANS UN BLOC DE CODE',
    '   ```json … ``` : c’est une charge utile pour la machine — hors bloc de code, il salit la',
    '   conversation que l’utilisateur lit. Une seule entrée par candidat, compacte :',
    '```json',
    '[{"type":"ajout","titre":"...","url":"src/main/fichier.ts:123","dateSource":"...","citation":"...","langue":"fr","pertinence":0}]',
    '```',
    '',
    'Règles :',
    '- `type` vaut TOUJOURS `ajout` : les corrections internes ont leur propre canal (audit interne).',
    '- `url` est un ANCRAGE INTERNE dans le DÉPÔT : `src/...:ligne` ou `scripts/...:ligne` — le code',
    '  qui prouve le manque (la vue qui n’exploite pas la donnée, le geste sans raccourci…). Les traces',
    '  d’usage INSPIRENT le candidat mais l’ancrage vit dans le code : un log est volatil, le code se',
    '  vérifie. Jamais une URL web, jamais un chemin que tu n’as pas ouvert.',
    '- `citation` est une ligne RECOPIÉE MOT POUR MOT du fichier ancré. C’est elle qu’un vérificateur',
    '  rejouera : une citation introuvable fait rejeter le candidat.',
    '- `dateSource` : la date de l’artefact lu si elle existe (horodatage de trace), sinon la date du jour.',
    '- `pertinence` : entier 0-100 — la valeur de la capacité pour Autowin OS, prouvée par l’usage',
    '  observé. En cas de doute, sous-note.',
    '- 3 à 8 candidats maximum : garde les plus forts, pas un inventaire.',
    '- Rien de solide à proposer → tableau vide [], mais SEULEMENT après avoir lu et listé dans ta',
    '  synthèse les fichiers explorés : un [] sans lecture citée est un refus de travail, pas un résultat.'
  ].join('\n')
}
