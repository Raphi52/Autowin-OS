import type { ReactElement } from 'react'
import { useTextesHorsElectron } from '../textes-ecrans/hors-electron'

/**
 * L'écran montré à la place de l'interface quand elle est ouverte dans un navigateur ordinaire, sans
 * le pont `window.api` d'Electron (conv-1286). Le choix se fait dans `racine-selon-le-pont.tsx`.
 */
export function HorsElectron(): ReactElement {
  const { t } = useTextesHorsElectron()
  return (
    <main
      role="alert"
      data-testid="hors-electron"
      style={{
        boxSizing: 'border-box',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 10,
        maxWidth: 560,
        margin: '0 auto',
        padding: 24,
        color: 'var(--text)',
        fontSize: 14,
        lineHeight: 1.5
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--gold)'
        }}
      >
        {t('horsElectron.kicker')}
      </span>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{t('horsElectron.titre')}</h1>
      <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('horsElectron.explication')}</p>
      <p style={{ margin: 0 }}>
        {t('horsElectron.conseil')}{' '}
        <code style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--gold)' }}>
          npm run dev
        </code>
        .
      </p>
    </main>
  )
}
