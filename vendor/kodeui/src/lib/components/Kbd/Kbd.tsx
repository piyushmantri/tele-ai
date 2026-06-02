import React from 'react'
import './Kbd.css'

export interface KbdProps {
  children: React.ReactNode
  className?: string
}

export const Kbd: React.FC<KbdProps> = ({ children, className = '' }) => (
  <kbd className={`kode-kbd ${className}`}>{children}</kbd>
)
