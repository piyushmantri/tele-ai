import React from 'react'
import './Card.css'

export interface CardProps {
  hoverable?: boolean
  glow?: boolean
  children: React.ReactNode
  className?: string
}

export const Card: React.FC<CardProps> = ({
  hoverable = false,
  glow = false,
  className = '',
  children,
}) => {
  const classes = [
    'kode-card',
    hoverable && 'kode-card--hoverable',
    glow && 'kode-card--glow',
    className,
  ].filter(Boolean).join(' ')

  return <div className={classes}>{children}</div>
}

export const CardHeader: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className = '',
}) => <div className={`kode-card__header ${className}`}>{children}</div>

export const CardTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className = '',
}) => <h3 className={`kode-card__title ${className}`}>{children}</h3>

export const CardBody: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className = '',
}) => <div className={`kode-card__body ${className}`}>{children}</div>

export const CardFooter: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className = '',
}) => <div className={`kode-card__footer ${className}`}>{children}</div>
