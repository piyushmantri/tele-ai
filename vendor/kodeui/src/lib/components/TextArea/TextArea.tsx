import React from 'react'
import './TextArea.css'

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const TextArea: React.FC<TextAreaProps> = ({
  label,
  error,
  className = '',
  id,
  ...props
}) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  const classes = [
    'kode-textarea',
    error && 'kode-textarea--error',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className="kode-input-wrapper">
      {label && <label className="kode-input-label" htmlFor={inputId}>{label}</label>}
      <textarea id={inputId} className={classes} {...props} />
      {error && <span className="kode-input-error-text">{error}</span>}
    </div>
  )
}
