import React, { useState } from 'react'
import './Tooltip.css'

export interface TooltipProps {
  content: string
  position?: 'top' | 'bottom'
  children: React.ReactNode
  className?: string
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  position = 'top',
  children,
  className = '',
}) => {
  const [show, setShow] = useState(false)

  return (
    <span
      className={`kode-tooltip-wrapper ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span className={`kode-tooltip ${position === 'bottom' ? 'kode-tooltip--bottom' : ''}`}>
          {content}
        </span>
      )}
    </span>
  )
}
