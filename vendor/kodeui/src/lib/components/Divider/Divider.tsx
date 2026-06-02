import React from 'react'
import './Divider.css'

export interface DividerProps {
  glow?: boolean
  vertical?: boolean
  className?: string
}

export const Divider: React.FC<DividerProps> = ({
  glow = false,
  vertical = false,
  className = '',
}) => {
  const classes = [
    'kode-divider',
    glow && 'kode-divider--glow',
    vertical && 'kode-divider--vertical',
    className,
  ].filter(Boolean).join(' ')

  return <hr className={classes} />
}
