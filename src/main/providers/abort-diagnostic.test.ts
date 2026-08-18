import { describe, expect, it } from 'vitest'
import { abortFailure } from './abort-diagnostic'

/**
 * CE QUI A RENDU UNE CONVERSATION INACCEPTABLE (2026-08-18).
 *
 * L'utilisateur voit : « Phase frame — le rôle subagent est bindé sur codex (gpt-5.6-sol) : codex
 * exec annulé ». Il demande pourquoi. L'agent n'a que ce libellé : il spécule (arrêt du processus,
 * timeout, interruption du provider…), puis affirme « quota Codex épuisé » sur la foi de traces
 * D'AUTRES appels, avant de devoir se rétracter. Trois tours perdus, une fausse cause affirmée.
 *
 * L'information existait pourtant à trois couches de là : `execution-supervisor` appelle
 * `controller.abort(reason)` avec une raison PRÉCISE — « budget duree depasse (600000 ms) »,
 * « Budget USD depasse (…) », « Reprise refusee : 2 appel(s) provider encore actif(s). » — et le
 * handler d'abort du provider la remplaçait par une chaîne constante. `AbortSignal.reason` portait
 * la réponse ; personne ne la lisait.
 *
 * Ces tests tiennent le contrat : la raison remonte, le diagnostic déjà accumulé remonte avec elle,
 * et son ABSENCE se dit au lieu de se taire.
 */
describe('abortFailure — un abort dit POURQUOI', () => {
  const signalAvecRaison = (raison: unknown): AbortSignal => {
    const controleur = new AbortController()
    controleur.abort(raison)
    return controleur.signal
  }

  it('porte la raison exacte passée à `controller.abort()`', () => {
    const erreur = abortFailure('codex exec', signalAvecRaison('budget duree depasse (600000 ms)'))
    expect(erreur.message).toContain('budget duree depasse (600000 ms)')
    // Le libellé de l'action reste, pour situer QUI s'est interrompu.
    expect(erreur.message).toContain('codex exec')
  })

  it('DIT que la raison manque au lieu de se taire', () => {
    // `abort()` sans argument : le navigateur/Node met une `AbortError` générique en `reason`.
    const controleur = new AbortController()
    controleur.abort()
    const erreur = abortFailure('codex exec', controleur.signal)
    expect(erreur.message).toMatch(/raison non rapport/i)
    // Surtout : il ne doit RIEN inventer.
    expect(erreur.message).not.toMatch(/quota|usage limit|timeout/i)
  })

  it('joint le diagnostic déjà accumulé — c’est LUI qui portait « usage limit »', () => {
    const erreur = abortFailure('codex exec', signalAvecRaison('arret impose'), {
      lastStructuredError: '{"type":"error","message":"You\'ve hit your usage limit."}',
      stderr: 'codex: quota exhausted'
    })
    expect(erreur.message).toContain('usage limit')
    expect(erreur.message).toContain('quota exhausted')
    expect(erreur.message).toContain('arret impose')
  })

  it('nomme explicitement ce qui manque, plutôt que de laisser un trou', () => {
    const erreur = abortFailure('claude CLI', signalAvecRaison('budget tokens depasse'))
    // Sans tampon de diagnostic (cas de claude/kimi/gemini), les champs sont dits « none » —
    // un lecteur sait alors que rien n'a ete capture, et non que rien ne s'est passe.
    expect(erreur.message).toContain('last-event=none')
    expect(erreur.message).toContain('stderr=none')
  })

  it('distingue une annulation DELIBEREE d’un arret impose', () => {
    // Un clic « Stop » ou une suppression de conversation : ce n'est pas un defaut, et le mot doit
    // le refleter. Le run reste en echec, mais sa cause est nommee pour ce qu'elle est.
    const utilisateur = abortFailure('codex exec', signalAvecRaison('conversation-deleted'))
    expect(utilisateur.message).toContain('conversation-deleted')

    const impose = abortFailure('codex exec', signalAvecRaison('budget duree depasse (1000 ms)'))
    expect(impose.message).toContain('budget duree depasse')
  })

  it('accepte une raison non textuelle sans la perdre ni jeter', () => {
    // `abort(new Error('...'))` est legal : la raison n'est pas forcement une chaine.
    const erreur = abortFailure('codex exec', signalAvecRaison(new Error('provider injoignable')))
    expect(erreur.message).toContain('provider injoignable')
  })

  it('fonctionne sans signal du tout', () => {
    const erreur = abortFailure('codex exec', undefined)
    expect(erreur).toBeInstanceOf(Error)
    expect(erreur.message).toMatch(/raison non rapport/i)
  })
})
