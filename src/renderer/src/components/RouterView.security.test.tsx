import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RouterAccountCards } from './RouterView'

describe('Router account DOM security', () => {
  it('renders only the sanitized account projection', () => {
    const hostile = {
      id: 'one',
      provider: 'claude',
      label: 'Travail',
      email: 'safe@example.test',
      status: 'active',
      quotas: [],
      accessToken: 'SECRET_ACCESS',
      refreshToken: 'SECRET_REFRESH',
      apiKey: 'SECRET_KEY',
      providerSpecificData: { cookie: 'SECRET_COOKIE' }
    }
    const html = renderToStaticMarkup(
      <RouterAccountCards
        connections={[hostile] as Parameters<typeof RouterAccountCards>[0]['connections']}
      />
    )
    expect(html).toContain('Travail · safe@example.test')
    expect(html).not.toMatch(/SECRET_|accessToken|refreshToken|apiKey|providerSpecificData|cookie/)
  })
})
