import { describe, expect, it } from 'vitest'
import {
  MOTIF_STOP_DU_CHAT,
  estArretParStop,
  interruptionSansDefaut,
  motifArreterUnFil
} from './arret-par-stop'

describe('estArretParStop — un appel coupé par le bouton Stop du chat', () => {
  it('reconnaît l’erreur d’abort réelle de conv-955, même enveloppée par la phase', () => {
    expect(
      estArretParStop(
        "Phase clean — appel du rôle subagent INTERROMPU avant sa fin : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat)\nlast-event=none\nstderr=none."
      )
    ).toBe(true)
    expect(estArretParStop(`[abort] codex exec interrompu : ${MOTIF_STOP_DU_CHAT}`)).toBe(true)
  })

  it('ne prend pas un autre arrêt pour un Stop', () => {
    expect(
      estArretParStop(
        '[abort] claude CLI interrompu : remplacee par un nouveau lancement sur la meme conversation'
      )
    ).toBe(false)
    expect(
      estArretParStop(
        '[abort] claude CLI interrompu : filet de crash : exception non catchee dans le process principal'
      )
    ).toBe(false)
    expect(
      estArretParStop("[abort] claude CLI interrompu : raison non rapportee par l'appelant")
    ).toBe(false)
  })

  it('en parallèle, ne dit Stop que si CHAQUE modèle a été coupé par le Stop', () => {
    const tete = "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie"
    const coupe = (modele: string) =>
      `• ${modele} : [abort] ${modele} interrompu : ${MOTIF_STOP_DU_CHAT}\nlast-event=none\nstderr=none`
    expect(estArretParStop([tete, coupe('claude'), coupe('codex')].join('\n'))).toBe(true)
    expect(
      estArretParStop([tete, coupe('claude'), '• codex (gpt-5.6) : usage limit reached'].join('\n'))
    ).toBe(false)
  })

  it('ne prend pas une citation du motif pour un Stop — il faut la signature de l’émetteur', () => {
    expect(estArretParStop(`Le grep trouve « ${MOTIF_STOP_DU_CHAT} » dans index.ts`)).toBe(false)
    expect(
      estArretParStop(`[abort] claude CLI interrompu : ${MOTIF_STOP_DU_CHAT} puis autre chose`)
    ).toBe(false)
    expect(estArretParStop(`• codex : quota\n• claude : ${MOTIF_STOP_DU_CHAT}`)).toBe(false)
    expect(estArretParStop(undefined)).toBe(false)
    expect(estArretParStop('')).toBe(false)
  })
})

/**
 * UN RUN COUPÉ PAR UNE LIMITE D'USAGE OU PAR UN ARRÊT VOULU N'A RIEN DE DÉFECTUEUX.
 *
 * Relevé du 05 au 07/11/2026 : dix demandes notées « refusé — échec : Fan-out build (rôle subagent) :
 * aucun modèle n'a produit de sortie ». Aucune n'était une panne : huit butaient sur la limite de
 * 5 heures du compte Claude, deux avaient été coupées par un autre fil (`arreter_un_fil`). Les textes
 * ci-dessous sont recopiés des journaux de tour de ces demandes.
 */
describe('interruptionSansDefaut — limite d’usage ou arrêt voulu, pas une panne', () => {
  const tete = "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie"
  const QUOTA_REEL = `${tete}\n• claude (claude-opus-5-5) : Claude a interrompu l'appel : You've hit your 5-hour limit · resets 12:50pm (Europe/Paris)`
  const ARRET_PAR_UN_FIL_HISTORIQUE = `${tete}\n• claude (claude-opus-5-5) : arret demande par conv-1667 (arreter_un_fil) : Lot 2 parti sans le code du lot 1 (resté dans sa copie, bloqué par le contrôle final) : il le referait en double et serait bloqué pareil.`

  it('la limite d’usage réelle d’un fan-out', () => {
    expect(interruptionSansDefaut(QUOTA_REEL)).toBe('limite-d-usage')
  })

  it('l’arrêt d’un fil par un autre, sous sa forme historique sans signature', () => {
    expect(interruptionSansDefaut(ARRET_PAR_UN_FIL_HISTORIQUE)).toBe('arret-voulu')
  })

  it('l’arrêt d’un fil par un autre, signé par l’émetteur d’abort, même enveloppé par la phase', () => {
    const motif = motifArreterUnFil('conv-1667', 'Lot 5 parti sans le pont IPC du lot 1')
    expect(
      interruptionSansDefaut(`[abort] appel provider interrompu : ${motif}\nlast-event=none`)
    ).toBe('arret-voulu')
    expect(
      interruptionSansDefaut(
        `Phase build — appel du rôle subagent INTERROMPU avant sa fin : [abort] claude CLI interrompu : ${motif}\nlast-event=none\nstderr=none.`
      )
    ).toBe('arret-voulu')
    expect(
      interruptionSansDefaut(
        `${tete}\n• claude (claude-opus-5-5) : [abort] appel provider interrompu : ${motif}`
      )
    ).toBe('arret-voulu')
  })

  it('le bouton Stop du chat est aussi un arrêt voulu', () => {
    expect(
      interruptionSansDefaut(
        `${tete}\n• claude (opus) : [abort] claude CLI interrompu : ${MOTIF_STOP_DU_CHAT}`
      )
    ).toBe('arret-voulu')
  })

  it('un modèle sur sa limite et l’autre coupé par Stop : rien de défectueux', () => {
    expect(
      interruptionSansDefaut(
        `${QUOTA_REEL}\n• codex (gpt-5.6) : [abort] codex exec interrompu : ${MOTIF_STOP_DU_CHAT}`
      )
    ).toBe('limite-d-usage')
  })

  it('une vraie panne reste une panne — discriminants', () => {
    expect(
      interruptionSansDefaut(
        `${tete}\n• codex (gpt-5.6) : codex non authentifié — lance \`codex login\``
      )
    ).toBeUndefined()
    expect(
      interruptionSansDefaut(
        `${tete}\n• claude (claude-opus-5-5) : Claude a interrompu l'appel : error_during_execution · 0.0000 USD`
      )
    ).toBeUndefined()
    // Un modèle en panne à côté d'un modèle sur sa limite : la panne ne se cache pas.
    expect(
      interruptionSansDefaut(`${QUOTA_REEL}\n• codex (gpt-5.6) : codex CLI exit 1`)
    ).toBeUndefined()
    // Un abort pour une autre raison (relance, filet de crash) n'est pas un arrêt voulu.
    expect(
      interruptionSansDefaut(
        `${tete}\n• claude (opus) : [abort] claude CLI interrompu : remplacee par un nouveau lancement sur la meme conversation`
      )
    ).toBeUndefined()
    expect(interruptionSansDefaut(undefined)).toBeUndefined()
    expect(interruptionSansDefaut('')).toBeUndefined()
  })

  it('une CITATION du motif d’arrêt n’est pas un arrêt — il faut l’émetteur', () => {
    expect(
      interruptionSansDefaut(
        `${tete}\n• claude (opus) : le test cherche « arret demande par conv-1 (arreter_un_fil) : x » et échoue`
      )
    ).toBeUndefined()
    expect(
      interruptionSansDefaut(
        'Le grep trouve « arret demande par conv-1 (arreter_un_fil) : x » dans un fichier'
      )
    ).toBeUndefined()
  })
})
