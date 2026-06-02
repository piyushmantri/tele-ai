import React from 'react'
import './Spinner.css'

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  glow?: boolean
  className?: string
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  glow = true,
  className = '',
}) => (
  <span className={`kode-spinner kode-spinner--${size} ${className}`}>
    <span className={`kode-spinner__ring ${glow ? 'kode-spinner__ring--glow' : ''}`} />
  </span>
)
