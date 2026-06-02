import React from 'react'
import './Input.css'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  className = '',
  id,
  ...props
}) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  const inputClasses = [
    'kode-input',
    error && 'kode-input--error',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className="kode-input-wrapper">
      {label && <label className="kode-input-label" htmlFor={inputId}>{label}</label>}
      <input id={inputId} className={inputClasses} {...props} />
      {error && <span className="kode-input-error-text">{error}</span>}
    </div>
  )
}
