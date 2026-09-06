import { describe, it, expect } from 'vitest'
import { portsEnEcoute, premierPortLibre } from './port-libre.mjs'

const NETSTAT = `
  Proto  Adresse locale         Adresse distante       Etat            PID
  TCP    127.0.0.1:9280         0.0.0.0:0              LISTENING       42372
  TCP    127.0.0.1:9281         0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:9280         127.0.0.1:59300        TIME_WAIT       0
  TCP    [::]:9285              [::]:0                 LISTENING       999
`

describe('choix d un port libre', () => {
  it('lit les ports en ECOUTE, IPv6 comprise', () => {
    const ports = portsEnEcoute(NETSTAT)
    expect(ports.has(9280)).toBe(true)
    expect(ports.has(9285)).toBe(true)
  })

  /* Un port en TIME_WAIT n'est pas en ecoute : le compter interdirait un port parfaitement utilisable. */
  it('ignore les connexions qui ne sont pas en ecoute', () => {
    expect(portsEnEcoute('  TCP  127.0.0.1:9300  127.0.0.1:5  TIME_WAIT  0').size).toBe(0)
  })

  /* LE CAS QUI A CASSE LE BUILD : 9280 tenu par un processus mort. */
  it('saute un port occupe et prend le suivant', () => {
    expect(premierPortLibre(9280, portsEnEcoute(NETSTAT))).toBe(9282)
  })

  it('rend le port demande quand il est libre', () => {
    expect(premierPortLibre(9290, portsEnEcoute(NETSTAT))).toBe(9290)
  })

  it('rend undefined plutot que de balayer sans fin une machine saturee', () => {
    const tout = new Set(Array.from({ length: 40 }, (_, i) => 9280 + i))
    expect(premierPortLibre(9280, tout, 20)).toBeUndefined()
  })
})
