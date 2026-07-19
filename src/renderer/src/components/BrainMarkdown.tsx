import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { splitFrontmatter } from './brain-markdown-model'
import './BrainMarkdown.css'

export function BrainMarkdown({ source }: { source: string }): React.JSX.Element {
  const { body, entries } = splitFrontmatter(source)
  return (
    <div className="brain-markdown">
      {entries.length > 0 && (
        <dl className="brain-markdown__meta" aria-label="Métadonnées de la note">
          {entries.map((entry) => (
            <div key={`${entry.key}:${entry.value}`}>
              <dt>{entry.key}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
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
    </div>
  )
}
