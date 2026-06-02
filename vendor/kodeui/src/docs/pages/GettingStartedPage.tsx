import React from 'react'
import { CodeBlock, Alert } from '../../lib'

export const GettingStartedPage: React.FC = () => (
  <>
    <h1 className="docs-page-title">Getting Started</h1>
    <p className="docs-page-desc">Install KodeUI and start building sleek dark interfaces in minutes.</p>

    <div className="docs-section">
      <h2 className="docs-section__title">Installation</h2>
      <CodeBlock language="bash" code="npm install kodeui" />
    </div>

    <div className="docs-section">
      <h2 className="docs-section__title">Import Styles</h2>
      <p style={{ color: '#aaa', marginBottom: 16 }}>
        Import the CSS in your app entry point. This loads the theme tokens and component styles.
      </p>
      <CodeBlock language="tsx" code={`// main.tsx or App.tsx
import 'kodeui/style.css'`} />
    </div>

    <div className="docs-section">
      <h2 className="docs-section__title">Usage</h2>
      <CodeBlock language="tsx" code={`import { Button, Card, CardBody, Badge } from 'kodeui'

function App() {
  return (
    <Card hoverable>
      <CardBody>
        <Badge variant="success">Online</Badge>
        <p>Welcome to the matrix.</p>
        <Button variant="filled">Enter</Button>
      </CardBody>
    </Card>
  )
}`} />
    </div>

    <div className="docs-section">
      <Alert variant="info">
        KodeUI is designed for dark backgrounds. Set your body background to #0a0a0a or similar for the best experience.
      </Alert>
    </div>
  </>
)
