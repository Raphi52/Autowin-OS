import { describe, expect, it } from 'vitest'
import { isDeliberateAbort, isNonActionableWall, suppressionFor } from './watchdog-suppression'

/**
 * La suppression protège Auto-Kaizen d'incidents qu'il ne peut PAS corriger : abandon volontaire,
 * panne fournisseur, mur non actionnable. Un incident non supprimé lance un agent — et sur un mur
 * (quota, token expiré) cet agent ne fait qu'ajouter du bruit.
 *
 * Motivation mesurée : sur 952 conversations, 720 portent un échec, amplifié par 2248 alertes
 * « 🚨 Auto-Kaizen suspendu ». Une part de ces alertes vient d'échecs NON actionnables passés à
 * travers la suppression — dont le token OAuth expiré de conv-1086.
 */
describe('suppression — un token d’auth expiré est un MUR, pas un défaut à kaizen', () => {
  // La chaîne EXACTE vue sur conv-1086 (2026-08-13).
  const conv1086 =
    'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.'

  it('la chaîne réelle de conv-1086 est désormais supprimée (non-actionable)', () => {
    expect(suppressionFor('Phase build échec', conv1086)).toBe('non-actionable')
    expect(isNonActionableWall('', conv1086)).toBe(true)
  })

  it('couvre les formulations d’auth expirée, quel que soit le fournisseur', () => {
    for (const detail of [
      'OAuth token expired',
      'access token has expired',
      'Please re-authenticate to continue',
      'authentication_error: invalid token',
      'Invalid API key provided',
      'HTTP 401 — auth token expired',
      '401 Unauthorized: oauth session ended'
    ]) {
      expect(isNonActionableWall('', detail), detail).toBe(true)
    }
  })

  it('CONTRÔLE NÉGATIF : un vrai défaut mentionnant 401 par hasard n’est PAS avalé', () => {
    // « 401 » comme numéro de ligne / de test, sans vocabulaire d'authentification, reste un défaut
    // à analyser — sinon on masquerait de vrais bugs.
    expect(isNonActionableWall('', 'assertion failed at foo.test.ts:401')).toBe(false)
    expect(isNonActionableWall('', 'expected 401 items but got 400')).toBe(false)
    expect(
      suppressionFor('Phase build échec', 'TypeError: cannot read x at line 401')
    ).toBeUndefined()
  })
})

/**
 * ABANDON VOULU — la suppression doit reconnaître le marqueur `[abort]`, pas seulement le mot
 * « annulé ».
 *
 * Défaut mesuré le 2026-09-02, run
 * `.autowin-data/autowin-os/runs/conv-14/kaizen-conv-13-est-bloquee-mtk5a9fg-workspace/RUN.md` :
 * l'utilisateur clique Stop, le run finit `red` en le DISANT honnêtement
 * (« [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat) »), et cet échec
 * traverse la suppression — donc réveille un agent et relance un chantier payant sur un arrêt voulu.
 *
 * La cause est en amont, le 2026-08-18 : `abortFailure` a cessé d'écrire « claude CLI annulé » pour
 * écrire « [abort] claude CLI interrompu : <raison> ». `provider-failure-diagnosis.ts` a suivi le
 * nouveau marqueur ; les deux gardes de suppression sont restés sur l'ANCIEN vocabulaire. Le
 * changement d'émetteur n'a pas été propagé à ses lecteurs.
 *
 * Le jumeau `auto-kaizen-supervisor` a depuis été supprimé (l'ancien superviseur auto-kaizen et son
 * câblage sont partis) : il ne reste qu'un garde à vérifier, celui de ce module.
 */
describe('suppression — le marqueur [abort] est un abandon voulu', () => {
  // La chaîne EXACTE du Journal de conv-14 (2026-09-02), telle qu'elle remonte au garde.
  const conv14 =
    'Phase kaizen — appel du rôle subagent INTERROMPU avant sa fin : [abort] claude CLI interrompu : ' +
    "arret demande par l'utilisateur (Stop du chat) · last-event=none · stderr=none. Ce n'est pas " +
    'une panne : ni claude ni le binding du rôle ne sont en cause.'

  it('la chaîne réelle de conv-14 est reconnue comme abandon et supprimée', () => {
    expect(isDeliberateAbort('Orchestration en échec', conv14)).toBe(true)
    expect(suppressionFor('Orchestration en échec', conv14)).toBe('aborted')
  })

  it('couvre les quatre providers, quelle que soit la raison rapportée', () => {
    for (const detail of [
      "[abort] codex exec interrompu : raison non rapportee par l'appelant",
      '[abort] claude CLI interrompu : conversation-deleted',
      '[abort] Kimi Code interrompu : run remplace',
      '[abort] Envoi Gemini interrompu : arret demande'
    ]) {
      expect(isDeliberateAbort('un outil a echoue', detail), detail).toBe(true)
    }
  })

  it('CONTRÔLE NÉGATIF : un arrêt imposé par le BUDGET reste un mur, pas un abandon', () => {
    // L'ordre compte. Le devis coupe l'appel par le même mécanisme, donc le même marqueur — mais la
    // cause est le plafond. L'étiqueter « aborted » ferait perdre « combien de runs le budget a
    // coûté ». Même règle que `provider-failure-diagnosis.ts` : budget testé AVANT l'annulation.
    const budget = '[abort] codex exec interrompu : Budget USD depasse (12.00)'
    expect(isDeliberateAbort('Orchestration en échec', budget)).toBe(false)
    expect(suppressionFor('Orchestration en échec', budget)).toBe('non-actionable')
  })

  it('CONTRÔLE NÉGATIF : un vrai échec terminal qui dit « interrompu » n’est PAS avalé', () => {
    // Le défaut symétrique, et celui qui coûte le plus cher : `providers/claude.ts` lève
    // « Claude a interrompu l'appel : … » sur un event `result` avec `is_error: true` — une panne
    // TERMINALE. Elle ne porte pas `[abort]` et doit continuer de mériter un agent.
    for (const detail of [
      "Claude a interrompu l'appel : max_tokens",
      'la transaction a ete aborted par la base de donnees',
      "le processus a ete interrompu par une erreur d'assertion",
      'expected 3 to be 4'
    ]) {
      expect(isDeliberateAbort('un outil a echoue', detail), detail).toBe(false)
    }
    expect(
      suppressionFor('un outil a echoue', "Claude a interrompu l'appel : max_tokens")
    ).toBeUndefined()
  })
})
