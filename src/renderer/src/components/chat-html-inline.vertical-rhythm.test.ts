// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { clampVerticalRhythm, prepareChatHtml } from './chat-html-inline'

describe('rythme vertical des blocs html-render', () => {
  it('plafonne les marges verticales genereuses', () => {
    expect(clampVerticalRhythm('margin-top', '48px')).toBe('18px')
    expect(clampVerticalRhythm('padding-block', '3rem')).toBe('18px')
    expect(clampVerticalRhythm('gap', '40px')).toBe('18px')
  })

  it('laisse intactes les valeurs deja sobres et les axes horizontaux', () => {
    expect(clampVerticalRhythm('margin-top', '10px')).toBe('10px')
    expect(clampVerticalRhythm('padding-left', '60px')).toBe('60px')
    expect(clampVerticalRhythm('padding', '40px 60px')).toBe('18px 60px')
    expect(clampVerticalRhythm('margin', '30px 12px 30px 24px')).toBe('18px 12px 18px 24px')
  })

  it('plafonne un interligne excessif', () => {
    expect(clampVerticalRhythm('line-height', '2.4')).toBe('1.6')
    expect(clampVerticalRhythm('line-height', '1.5')).toBe('1.5')
  })

  it('plafonne aussi la feuille de style du bloc et ses styles inline', () => {
    const prepared = prepareChatHtml(
      '<style>section{margin:56px 0;line-height:2}</style><p style="padding-top:64px">x</p>'
    )
    expect(prepared.html).toContain('margin:18px 0')
    expect(prepared.html).toContain('line-height:1.6')
    expect(prepared.html).toContain('padding-top: 18px')
  })
})
