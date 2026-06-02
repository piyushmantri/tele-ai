import React, { useEffect } from 'react'
import './Modal.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  children,
  footer,
  className = '',
}) => {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="kode-modal-overlay" onClick={onClose}>
      <div className={`kode-modal ${className}`} onClick={e => e.stopPropagation()}>
        {title && (
          <div className="kode-modal__header">
            <h2 className="kode-modal__title">{title}</h2>
            <button className="kode-modal__close" onClick={onClose} aria-label="Close">
              &times;
            </button>
          </div>
        )}
        <div className="kode-modal__body">{children}</div>
        {footer && <div className="kode-modal__footer">{footer}</div>}
      </div>
    </div>
  )
}
