import { describe, expect, it } from 'vitest'
import { DEFAULT_CDP_PORT, listeningPorts, resolveCdpPort } from './cdp-port'

// Sortie `netstat -ano` réelle (Windows FR) : la 1ʳᵉ ligne est en ÉCOUTE, la 2ᵉ est une connexion
// sortante vers un port distant — elle NE doit pas compter comme un port occupé localement.
const NETSTAT = [
  '  Proto  Adresse locale         Adresse distante       État            PID',
  '  TCP    127.0.0.1:9223         0.0.0.0:0              LISTENING       41508',
  '  TCP    192.168.1.10:52345     140.82.121.4:9224      ESTABLISHED     1234',
  '  TCP    [::1]:9225             [::]:0                 LISTENING       777',
  ''
].join('\r\n')

describe('listeningPorts', () => {
  it('ne retient que les ports en ÉCOUTE, IPv4 et IPv6', () => {
    const ports = listeningPorts(NETSTAT)
    expect(ports.has(9223)).toBe(true) // écoute
    expect(ports.has(9225)).toBe(true) // écoute IPv6 [::1]:9225
    expect(ports.has(9224)).toBe(false) // port DISTANT d'une connexion sortante → libre localement
  })

  it('sortie vide ou illisible → aucun port occupé (pas d’exception)', () => {
    expect(listeningPorts('').size).toBe(0)
    expect(listeningPorts('n’importe quoi').size).toBe(0)
  })
})

describe('resolveCdpPort', () => {
  it('port préféré libre → on le garde', () => {
    const r = resolveCdpPort(() => new Set([1234]))
    expect(r).toEqual({ port: DEFAULT_CDP_PORT, moved: false, forced: false })
  })

  it('port occupé par un socket orphelin → prend le suivant libre et le signale', () => {
    // Cas vécu : PID en LISTENING sur 9223 alors que le process n'existe plus (socket hérité).
    const r = resolveCdpPort(() => new Set([9223, 9224]))
    expect(r).toEqual({ port: 9225, moved: true, forced: false })
  })

  it('AUTOWIN_CDP_PORT force la valeur, sans sonder', () => {
    let probed = false
    const r = resolveCdpPort(
      () => {
        probed = true
        return new Set<number>()
      },
      { AUTOWIN_CDP_PORT: '9300' }
    )
    expect(r).toEqual({ port: 9300, moved: false, forced: true })
    expect(probed).toBe(false)
  })

  it('valeur forcée absurde → ignorée, on repasse par la sonde', () => {
    const r = resolveCdpPort(() => new Set<number>(), { AUTOWIN_CDP_PORT: 'zéro' })
    expect(r.port).toBe(DEFAULT_CDP_PORT)
    expect(r.forced).toBe(false)
  })

  it('sonde indisponible (pas de netstat) → port préféré, jamais d’échec de démarrage', () => {
    const r = resolveCdpPort(() => {
      throw new Error('netstat introuvable')
    })
    expect(r).toEqual({ port: DEFAULT_CDP_PORT, moved: false, forced: false })
  })

  it('toute la plage occupée → garde le port préféré (pas de boucle infinie)', () => {
    const busy = new Set<number>()
    for (let p = DEFAULT_CDP_PORT; p < DEFAULT_CDP_PORT + 50; p += 1) busy.add(p)
    expect(resolveCdpPort(() => busy)).toEqual({
      port: DEFAULT_CDP_PORT,
      moved: false,
      forced: false
    })
  })
})
