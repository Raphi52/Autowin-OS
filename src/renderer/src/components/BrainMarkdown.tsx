import ReactMarkdown from 'react-markdown'
import { useTextesObservatory } from '../textes-ecrans/observatory'
import remarkGfm from 'remark-gfm'
import { markdownRendable, splitFrontmatter } from './brain-markdown-model'
import './BrainMarkdown.css'

export function BrainMarkdown({ source }: { source: string }): React.JSX.Element {
  const { t } = useTextesObservatory()
  const { body, entries } = splitFrontmatter(source)
  return (
    <div className="brain-markdown">
      {entries.length > 0 && (
        <dl className="brain-markdown__meta" aria-label={t('markdown.metadonneesNote')}>
          {entries.map((entry) => (
            <div key={`${entry.key}:${entry.value}`}>
              <dt>{entry.key}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {markdownRendable(body) ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                target={href?.startsWith('http') ? '_blank' : undefined}
                rel={href?.startsWith('http') ? 'noreferrer' : undefined}
              >
                {children}
              </a>
            )
          }}
        >
          {body}
        </ReactMarkdown>
      ) : (
        <>
          <p className="brain-markdown__brut" role="status">
            {t('markdown.noteVolumineuseAfficheeTexte')}
          </p>
          <pre className="brain-markdown__brut-corps">{body}</pre>
        </>
      )}
    </div>
  )
}
