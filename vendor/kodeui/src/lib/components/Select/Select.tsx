import React from 'react'
import './Select.css'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: { value: string; label: string }[]
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  className = '',
  id,
  ...props
}) => {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="kode-select-wrapper">
      {label && <label className="kode-input-label" htmlFor={selectId}>{label}</label>}
      <select id={selectId} className={`kode-select ${className}`} {...props}>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}
