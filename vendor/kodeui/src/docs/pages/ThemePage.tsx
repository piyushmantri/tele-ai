import React from 'react'
import { CodeBlock } from '../../lib'

export const ThemePage: React.FC = () => (
  <>
    <h1 className="docs-page-title">Theme & Tokens</h1>
    <p className="docs-page-desc">Design tokens powering KodeUI. All exposed as CSS custom properties.</p>

    <div className="docs-section">
      <h2 className="docs-section__title">Colors</h2>
      <div className="docs-preview docs-preview--row">
        {[
          { name: '--kode-green', color: '#0f0' },
          { name: '--kode-bg-darkest', color: '#000' },
          { name: '--kode-bg', color: '#111' },
          { name: '--kode-bg-light', color: '#1a1a1a' },
          { name: '--kode-bg-panel', color: '#2d2d2d' },
          { name: '--kode-success', color: '#2cbb5d' },
          { name: '--kode-error', color: '#ef4743' },
          { name: '--kode-warning', color: '#f7bb3b' },
          { name: '--kode-info', color: '#3b82f6' },
        ].map(t => (
          <div key={t.name} style={{ textAlign: 'center' }}>
            <div style={{
              width: 48, height: 48, borderRadius: 8,
              background: t.color, border: '1px solid #333',
              marginBottom: 6,
            }} />
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>{t.name}</div>
          </div>
        ))}
      </div>
    </div>

    <div className="docs-section">
      <h2 className="docs-section__title">Typography</h2>
      <div className="docs-preview docs-preview--col">
        <div style={{ fontFamily: "'Menlo', monospace", fontSize: 14, color: '#0f0' }}>
          var(--kode-font-mono): Menlo, Monaco, Courier New
        </div>
        <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14, color: '#e0e0e0' }}>
          var(--kode-font-sans): Inter, system-ui, sans-serif
        </div>
      </div>
    </div>

    <div className="docs-section">
      <h2 className="docs-section__title">Using Tokens</h2>
      <CodeBlock language="css" code={`/* Override tokens in your app */
:root {
  --kode-green: #00ffaa;       /* change accent */
  --kode-bg: #0a0a1a;         /* change backgrounds */
  --kode-font-mono: 'Fira Code', monospace;
}`} />
    </div>
  </>
)
