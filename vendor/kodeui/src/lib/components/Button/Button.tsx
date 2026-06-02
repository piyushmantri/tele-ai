import React from 'react'
import './Button.css'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'filled' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
  ...props
}) => {
  const classes = [
    'kode-btn',
    `kode-btn--${variant}`,
    size !== 'md' && `kode-btn--${size}`,
    fullWidth && 'kode-btn--full',
    className,
  ].filter(Boolean).join(' ')

  return <button className={classes} {...props}>{children}</button>
}
