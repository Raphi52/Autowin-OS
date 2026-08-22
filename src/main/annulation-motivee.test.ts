import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { abortFailure, abortReasonText } from './providers/abort-diagnostic'

/**
 * UNE ANNULATION DIT POURQUOI — jusqu'au message que l'utilisateur lit.
 *
 * Défaut mesuré sur `conv-1369` le 2026-08-22. Un run de 28 min 33 s s'est terminé sur
 * « [abort] claude CLI interrompu : raison non rapportee par l'appelant », l'utilisateur a demandé
 * pourquoi, et l'application ne pouvait pas répondre. Le diagnostic proposait même une hypothèse
 * FAUSSE (« vérifie qu'un second lancement n'a pas interrompu le premier ») que le ledger réfute :
 * une seule commande `orchestrate` ce jour-là à cette heure.
 *
 * La cause était une asymétrie d'une ligne : `os:pilotChat:cancel` passait bien `'user'` au tour de
 * chat, puis appelait `bus.abortOrchestration(convId)` SANS argument — et c'est ce second signal que
 * le provider observe. L'information existait, elle était jetée au passage de frontière.
 *
 * C'est le même défaut que celui raconté par l'en-tête de `providers/abort-diagnostic.ts`
 * (« AbortSignal porte pourtant reason : la réponse était là, personne ne la lisait »), une couche
 * plus haut. Ce test garde les deux bouts : la fonction qui lit la raison, et le fait qu'aucun
 * appelant ne puisse plus l'omettre.
 */
describe('une annulation d orchestration dit pourquoi', () => {
  it('la raison traverse le signal jusqu au message lu par l utilisateur', () => {
    const controller = new AbortController()
    controller.abort("arret demande par l'utilisateur (Stop du chat)")
    const message = abortFailure('claude CLI', controller.signal).message
    expect(message).toContain("arret demande par l'utilisateur")
    // Et surtout : le message qui a laissé l'utilisateur sans réponse ne doit plus apparaître.
    expect(message).not.toContain('raison non rapportee')
  })

  it('un abort SANS raison reste signalé comme tel, il n invente rien', () => {
    // La contrepartie : on ne remplace pas une absence par une cause plausible. C'est exactement
    // l'erreur que le diagnostic a commise en suggérant un second lancement.
    const controller = new AbortController()
    controller.abort()
    expect(abortReasonText(controller.signal)).toBeUndefined()
    expect(abortFailure('claude CLI', controller.signal).message).toContain('raison non rapportee')
  })

  it('AUCUN appelant ne peut plus annuler une orchestration sans motif', () => {
    // Le paramètre est obligatoire côté type ; ce test garde l'intention pour un lecteur, et attrape
    // un `abort()` nu réintroduit directement sur le registre.
    const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')
    expect(source).toContain('abortOrchestration(convId: string, reason: string)')
    expect(source).toContain('controller.abort(reason)')
    // Un `abort()` nu sur une orchestration est ce qui a produit le message illisible.
    const registre = source.slice(source.indexOf('abortOrchestration'))
    expect(registre.slice(0, registre.indexOf('registerOrchestration'))).not.toMatch(
      /\.abort\(\s*\)/
    )
  })

  it('les deux chemins d annulation de l interface nomment leur motif', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    for (const canal of ['os:pilotChat:cancel', 'os:orchestrate:cancel']) {
      // Ancré sur l'ENREGISTREMENT du canal, pas sur la première mention : la première occurrence de
      // `os:orchestrate:cancel` est un commentaire, et mon oracle l'avait attrapé — un test qui lit un
      // commentaire au lieu du code ne garde rien.
      const debut = source.indexOf(`ipcMain.handle('${canal}'`)
      expect(debut, `le canal ${canal} doit etre enregistre`).toBeGreaterThan(0)
      const bloc = source.slice(debut, debut + 900)
      expect(bloc, `${canal} doit passer un motif d'annulation`).toMatch(
        /abortOrchestration\([\s\S]{0,120}(Stop|utilisateur)/
      )
    }
  })
})
