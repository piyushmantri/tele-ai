import React from 'react'
import './Alert.css'

const icons: Record<string, string> = {
  success: '\u2713',
  error: '\u2717',
  warning: '\u26A0',
  info: '\u276F',
}

export interface AlertProps {
  variant?: 'success' | 'error' | 'warning' | 'info'
  children: React.ReactNode
  className?: string
}

export const Alert: React.FC<AlertProps> = ({
  variant = 'info',
  className = '',
  children,
}) => (
  <div className={`kode-alert kode-alert--${variant} ${className}`} role="alert">
    <span className="kode-alert__icon">{icons[variant]}</span>
    <div className="kode-alert__content">{children}</div>
  </div>
)
