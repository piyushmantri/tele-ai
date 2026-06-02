import React, { useState, useRef, useEffect } from 'react'
import './Chat.css'

export interface ChatMessage {
  id: string
  content: string
  sender: 'incoming' | 'outgoing'
  senderName?: string
  timestamp?: string
}

export interface ChatProps {
  messages: ChatMessage[]
  onSend?: (message: string) => void
  title?: string
  subtitle?: string
  avatarSrc?: string
  avatarInitials?: string
  placeholder?: string
  typing?: boolean
  typingText?: string
  glow?: boolean
  emptyText?: string
  headerActions?: React.ReactNode
  className?: string
}

export const Chat: React.FC<ChatProps> = ({
  messages,
  onSend,
  title = 'Chat',
  subtitle,
  avatarSrc,
  avatarInitials,
  placeholder = 'Type a message...',
  typing = false,
  typingText = 'typing',
  glow = false,
  emptyText = '// no messages yet',
  headerActions,
  className = '',
}) => {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typing])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || !onSend) return
    onSend(trimmed)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const initials = avatarInitials || title.split(' ').map(w => w[0]).join('').slice(0, 2)

  const classes = [
    'kode-chat',
    glow && 'kode-chat--glow',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <div className="kode-chat__header">
        <div className="kode-chat__header-left">
          <div className="kode-chat__header-avatar">
            {avatarSrc ? <img src={avatarSrc} alt={title} /> : initials}
          </div>
          <div>
            <div className="kode-chat__header-name">{title}</div>
            {subtitle && (
              <div className={`kode-chat__header-status ${subtitle.toLowerCase() === 'online' ? 'kode-chat__header-status--online' : ''}`}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
        {headerActions && (
          <div className="kode-chat__header-actions">{headerActions}</div>
        )}
      </div>

      <div className="kode-chat__messages">
        {messages.length === 0 && !typing && (
          <div className="kode-chat__empty">{emptyText}</div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`kode-chat__message kode-chat__message--${msg.sender}`}>
            {msg.senderName && (
              <div className="kode-chat__message-sender">{msg.senderName}</div>
            )}
            <div className="kode-chat__bubble">{msg.content}</div>
            {msg.timestamp && (
              <div className="kode-chat__message-time">{msg.timestamp}</div>
            )}
          </div>
        ))}
        {typing && (
          <div className="kode-chat__typing">
            <div className="kode-chat__typing-dots">
              <span className="kode-chat__typing-dot" />
              <span className="kode-chat__typing-dot" />
              <span className="kode-chat__typing-dot" />
            </div>
            <span className="kode-chat__typing-text">{typingText}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="kode-chat__input-area">
        <textarea
          ref={textareaRef}
          className="kode-chat__input"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
        />
        <button
          className="kode-chat__send"
          onClick={handleSend}
          disabled={!input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}
