/**
 * LE RÉSULTAT VALIDÉ PART AVANT LA FIN DU RUN (piste 3 de conv-914).
 *
 * Le résultat ne sortait qu'au retour du run, APRÈS les étapes jouées après la validation
 * (enregistrement des leçons, récupération) : l'utilisateur attendait pour lire un travail déjà
 * validé (3 min 49 sur conv-911 d'après l'analyse de conv-914). L'orchestrateur envoie donc cette
 * étape dès la validation ; l'ordre des étapes suivantes, `valid` et `gate` ne changent pas.
 *
 * OÙ ELLE SE LIT : onglet « Runs » du panneau de droite (`WorkflowsPanel` → `StepThread` →
 * `SubAgentStep`, qui montre cette ligne puis le texte complet). Dans le chat, elle ne s'attache qu'à
 * une ligne « gate » déjà annoncée (refus préalable) et n'y montre que cette ligne, pas le résultat :
 * la ligne dit donc OÙ lire, jamais « ci-dessous ». Tenu par `ChatView.parts.resultat-valide.test.tsx`.
 *
 * Module partagé : la MÊME étape est produite par `orchestrator.ts` et rendue par ce test.
 */
// fix-ok: run-a8a70cd0ee56-1 réparation 3 — la ligne nommait le « panneau Workflows » ; l'onglet
// visible s'appelle « Runs » (WorkflowsPanel.tsx:21). L'ancienne phrase réinjectée fait échouer
// 2 tests (code 1).
export const LIGNE_RESULTAT_VALIDE =
  'Travail validé — le résultat complet se lit dès maintenant dans l’onglet Runs, à droite du ' +
  'chat, sans attendre la fin du run. La suite ne change pas ce verdict.'

export function etapeResultatValide(resultat: string): {
  step: 'gate'
  role: 'gate'
  detail: string
  text: string
} {
  return { step: 'gate', role: 'gate', detail: LIGNE_RESULTAT_VALIDE, text: resultat }
}
