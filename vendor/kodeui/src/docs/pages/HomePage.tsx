import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Badge, Card, CardBody, CodeBlock, Alert } from '../../lib'

export const HomePage: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div className="docs-hero">
      <Badge variant="default" pill>Open Source</Badge>
      <h1 className="docs-hero__title">KodeUI</h1>
      <p className="docs-hero__tagline">
        A React component library forged in the terminal. Dark by design. Neon by nature.
      </p>
      <div className="docs-hero__actions">
        <Button variant="filled" size="lg" onClick={() => navigate('/getting-started')}>
          Get Started
        </Button>
        <Button variant="primary" size="lg" onClick={() => navigate('/components/button')}>
          Components
        </Button>
      </div>
      <div className="docs-hero__stats">
        <div>
          <div className="docs-hero__stat-value">17</div>
          <div className="docs-hero__stat-label">Components</div>
        </div>
        <div>
          <div className="docs-hero__stat-value">0</div>
          <div className="docs-hero__stat-label">Dependencies</div>
        </div>
        <div>
          <div className="docs-hero__stat-value">TS</div>
          <div className="docs-hero__stat-label">TypeScript</div>
        </div>
      </div>

      <div style={{ marginTop: 64, width: '100%', maxWidth: 600 }}>
        <CodeBlock
          language="bash"
          code="npm install kodeui"
          showCopy
        />
      </div>

      <div style={{ marginTop: 48, display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Card hoverable>
          <CardBody>
            <div style={{ color: '#0f0', fontFamily: 'monospace', marginBottom: 8 }}>// Dark Mode</div>
            Built for dark interfaces with high contrast neon accents.
          </CardBody>
        </Card>
        <Card hoverable>
          <CardBody>
            <div style={{ color: '#0f0', fontFamily: 'monospace', marginBottom: 8 }}>// Glow Effects</div>
            Neon glow shadows and text effects for that hacker feel.
          </CardBody>
        </Card>
        <Card hoverable>
          <CardBody>
            <div style={{ color: '#0f0', fontFamily: 'monospace', marginBottom: 8 }}>// Zero Deps</div>
            No external dependencies. Just React and CSS.
          </CardBody>
        </Card>
      </div>

      <div style={{ marginTop: 48, width: '100%', maxWidth: 600 }}>
        <Alert variant="info">
          This entire component library and documentation website was built completely by AI.
        </Alert>
      </div>
    </div>
  )
}
