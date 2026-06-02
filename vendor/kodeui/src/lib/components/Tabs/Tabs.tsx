import React, { useState } from 'react'
import './Tabs.css'

export interface Tab {
  id: string
  label: string
  content: React.ReactNode
}

export interface TabsProps {
  tabs: Tab[]
  defaultTab?: string
  className?: string
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  defaultTab,
  className = '',
}) => {
  const [active, setActive] = useState(defaultTab || tabs[0]?.id)
  const activeTab = tabs.find(t => t.id === active)

  return (
    <div className={`kode-tabs ${className}`}>
      <div className="kode-tabs__list" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            className={`kode-tabs__tab ${active === tab.id ? 'kode-tabs__tab--active' : ''}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="kode-tabs__panel" role="tabpanel">
        {activeTab?.content}
      </div>
    </div>
  )
}
