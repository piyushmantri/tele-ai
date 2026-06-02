import React, { useState } from 'react'
import './CodeBlock.css'

export interface CodeBlockProps {
  code: string
  language?: string
  showCopy?: boolean
  className?: string
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  showCopy = true,
  className = '',
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`kode-codeblock ${className}`}>
      {(language || showCopy) && (
        <div className="kode-codeblock__header">
          <span className="kode-codeblock__lang">{language || ''}</span>
          {showCopy && (
            <button className="kode-codeblock__copy" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>
      )}
      <pre className="kode-codeblock__pre">
        <code className="kode-codeblock__code">{code}</code>
      </pre>
    </div>
  )
}
