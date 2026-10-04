/**
 * ENVOI VERS UNE AUTRE CONVERSATION SANS ATTENDRE LA FIN DE SON TOUR.
 *
 * `chat_send` avec `conversationId` reutilisait `runPrompt` des taches planifiees, qui attend la FIN
 * du tour cible (index.ts, `await runPilotChat`). Un agent qui ouvrait 7 fils ne pouvait donc les
 * lancer qu'un par un : mesure du 2026-10-02 (conv-40 -> conv-41/42/43), chaque envoi partait 0,1 a
 * 0,2 s apres la fin du precedent, ~2 min 15 chacun.
 *
 * Ici on rend la main des que le tour est ENREGISTRE comme actif dans le fil cible. Si le tour
 * echoue ou se termine avant meme d'etre enregistre, son resultat est rendu tel quel : un echec de
 * demarrage reste visible. Les taches planifiees, elles, gardent l'attente complete (`runPrompt`).
 */
export interface ResultatLancement {
  ok: boolean
  turnId?: string
  error?: string
}

export async function lancerSansAttendre(
  demarrer: () => Promise<ResultatLancement>,
  attendreDemarrage: () => Promise<boolean>,
  signalerEchecTardif: (erreur: unknown) => void
): Promise<ResultatLancement> {
  const tour = demarrer()
  // Le tour continue seul : son echec tardif ne doit pas devenir une promesse rejetee orpheline.
  tour.then(
    (r) => {
      if (!r.ok) signalerEchecTardif(r.error ?? 'cause non renseignee')
    },
    (e) => signalerEchecTardif(e)
  )
  const fini = tour.then(
    (r) => ({ fini: true as const, r }),
    (e: unknown) => ({
      fini: true as const,
      r: { ok: false, error: e instanceof Error ? e.message : String(e) }
    })
  )
  const demarre = attendreDemarrage().then((actif) => ({ fini: false as const, actif }))
  const premier = await Promise.race([fini, demarre])
  if (premier.fini) return premier.r
  if (premier.actif) return { ok: true }
  // Demarrage non observe dans le delai : le tour peut encore partir, on ne le declare pas en echec
  // (un renvoi creerait un doublon), mais on le DIT.
  return { ok: true, error: 'demarrage du tour non encore observe ; il peut demarrer plus tard' }
}
