# KodeUI

A hacker-inspired React component library inspired by [KodePad](https://github.com/piyushmantri/kodepad). Dark mode. Neon glow. Built for hackers.

[![Deploy to GitHub Pages](https://github.com/piyushmantri/kodeui/actions/workflows/deploy.yml/badge.svg)](https://github.com/piyushmantri/kodeui/actions/workflows/deploy.yml)

**[Live Documentation](https://piyushmantri.github.io/kodeui/)**

## Features

- 17 fully typed React components
- Hacker-inspired aesthetic with neon green glow effects
- Zero external dependencies (just React + CSS)
- CSS custom properties for easy theming
- TypeScript support out of the box
- Dark mode by default

## Installation

```bash
npm install kodeui
```

## Quick Start

```tsx
// Import styles in your entry point
import 'kodeui/style.css'

// Use components
import { Button, Card, CardBody, Badge } from 'kodeui'

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
}
```

## Components

| Component     | Description                                      |
| ------------- | ------------------------------------------------ |
| `Button`      | Primary, filled, ghost, danger variants with glow |
| `Input`       | Text input with label and error states            |
| `TextArea`    | Multi-line text input                             |
| `Select`      | Styled dropdown select                            |
| `Badge`       | Status indicators with pill option                |
| `Card`        | Container with Header, Title, Body, Footer        |
| `Modal`       | Dialog overlay with backdrop blur                 |
| `Tabs`        | Tabbed content navigation                         |
| `Alert`       | Contextual feedback messages                      |
| `Switch`      | Toggle with green glow                            |
| `Spinner`     | Loading ring animation                            |
| `Tooltip`     | Hover popover (top/bottom)                        |
| `Avatar`      | Initials or image display                         |
| `CodeBlock`   | Code display with copy-to-clipboard               |
| `Divider`     | Separator with optional neon glow                 |
| `Kbd`         | Keyboard shortcut display                         |
| `Chat`        | Chat interface with bubbles, typing indicator     |

## Theming

All design tokens are exposed as CSS custom properties. Override them to customize:

```css
:root {
  --kode-green: #00ffaa;
  --kode-bg: #0a0a1a;
  --kode-font-mono: 'Fira Code', monospace;
}
```

## Development

```bash
git clone https://github.com/piyushmantri/kodeui.git
cd kodeui
npm install
npm run dev        # Start docs site locally
npm run build      # Build library + docs
npm run build:lib  # Build library only
npm run build:docs # Build docs site only
```

## License

MIT
