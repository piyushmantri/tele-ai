import React from 'react'
import './Switch.css'

export interface SwitchProps {
  checked?: boolean
  onChange?: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}

export const Switch: React.FC<SwitchProps> = ({
  checked = false,
  onChange,
  label,
  disabled = false,
  className = '',
}) => (
  <label className={`kode-switch ${checked ? 'kode-switch--checked' : ''} ${className}`}>
    <input
      type="checkbox"
      className="kode-switch__input"
      checked={checked}
      onChange={e => onChange?.(e.target.checked)}
      disabled={disabled}
    />
    <span className="kode-switch__track">
      <span className="kode-switch__thumb" />
    </span>
    {label && <span className="kode-switch__label">{label}</span>}
  </label>
)
