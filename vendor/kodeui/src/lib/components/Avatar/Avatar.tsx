import React from 'react'
import './Avatar.css'

export interface AvatarProps {
  name?: string
  src?: string
  size?: 'sm' | 'md' | 'lg'
  glow?: boolean
  className?: string
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  size = 'md',
  glow = false,
  className = '',
}) => {
  const initials = name
    ? name.split(' ').map(n => n[0]).join('').slice(0, 2)
    : '?'

  const classes = [
    'kode-avatar',
    `kode-avatar--${size}`,
    glow && 'kode-avatar--glow',
    className,
  ].filter(Boolean).join(' ')

  return (
    <span className={classes} title={name}>
      {src ? <img src={src} alt={name || 'Avatar'} /> : initials}
    </span>
  )
}
