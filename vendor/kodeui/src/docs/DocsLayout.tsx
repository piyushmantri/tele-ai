import React, { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import './DocsLayout.css'

const components = [
  'Button', 'Input', 'TextArea', 'Select',
  'Badge', 'Card', 'Modal', 'Tabs',
  'Alert', 'Switch', 'Spinner', 'Tooltip',
  'Avatar', 'CodeBlock', 'Divider', 'Kbd',
  'Chat',
]

export const DocsLayout: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [lightTheme, setLightTheme] = useState(() => {
    return localStorage.getItem('kodeui-theme') === 'light'
  })
  const location = useLocation()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  useEffect(() => {
    if (lightTheme) {
      document.documentElement.setAttribute('data-theme', 'light')
      localStorage.setItem('kodeui-theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
      localStorage.setItem('kodeui-theme', 'dark')
    }
  }, [lightTheme])

  return (
    <div className="docs-layout">
      <button
        className="docs-menu-toggle"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Toggle menu"
      >
        <span className={`docs-menu-toggle__icon ${menuOpen ? 'docs-menu-toggle__icon--open' : ''}`} />
      </button>

      <button
        className="docs-theme-toggle-mobile"
        onClick={() => setLightTheme(t => !t)}
        aria-label={lightTheme ? 'Switch to dark theme' : 'Switch to light theme'}
        title={lightTheme ? 'Dark mode' : 'Light mode'}
      >
        {lightTheme ? '◐' : '◑'}
      </button>

      {menuOpen && <div className="docs-sidebar-overlay" onClick={() => setMenuOpen(false)} />}

      <aside className={`docs-sidebar ${menuOpen ? 'docs-sidebar--open' : ''}`}>
        <div className="docs-sidebar__logo">
          <NavLink to="/">
            <div className="docs-sidebar__title">KodeUI</div>
            <div className="docs-sidebar__subtitle">v1.0.0</div>
          </NavLink>
          <button
            className="docs-theme-toggle"
            onClick={() => setLightTheme(t => !t)}
            aria-label={lightTheme ? 'Switch to dark theme' : 'Switch to light theme'}
            title={lightTheme ? 'Dark mode' : 'Light mode'}
          >
            {lightTheme ? '◐' : '◑'}
          </button>
        </div>
        <nav className="docs-sidebar__nav">
          <div className="docs-sidebar__section">Getting Started</div>
          <NavLink
            to="/getting-started"
            className={({ isActive }) =>
              `docs-sidebar__link ${isActive ? 'docs-sidebar__link--active' : ''}`
            }
          >
            Installation
          </NavLink>
          <NavLink
            to="/theme"
            className={({ isActive }) =>
              `docs-sidebar__link ${isActive ? 'docs-sidebar__link--active' : ''}`
            }
          >
            Theme & Tokens
          </NavLink>

          <div className="docs-sidebar__section" style={{ marginTop: 16 }}>Components</div>
          {components.map(name => (
            <NavLink
              key={name}
              to={`/components/${name.toLowerCase()}`}
              className={({ isActive }) =>
                `docs-sidebar__link ${isActive ? 'docs-sidebar__link--active' : ''}`
              }
            >
              {name}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="docs-main">
        <div className="docs-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
