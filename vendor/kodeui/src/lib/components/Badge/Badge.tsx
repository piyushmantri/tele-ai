import React from 'react'
import './Badge.css'

export interface BadgeProps {
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info'
  pill?: boolean
  children: React.ReactNode
  className?: string
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  pill = false,
  className = '',
  children,
}) => {
  const classes = [
    'kode-badge',
    `kode-badge--${variant}`,
    pill && 'kode-badge--pill',
    className,
  ].filter(Boolean).join(' ')

  return <span className={classes}>{children}</span>
}
