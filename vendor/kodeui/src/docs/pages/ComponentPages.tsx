import React, { useState } from 'react'
import {
  Button, Input, TextArea, Select, Badge, Card, CardHeader, CardTitle, CardBody, CardFooter,
  Modal, Tabs, Alert, Switch, Spinner, Tooltip, Avatar, CodeBlock, Divider, Kbd, Chat,
} from '../../lib'
import type { ChatMessage } from '../../lib'

interface DocPageProps {
  title: string
  description: string
  children: React.ReactNode
}

const DocPage: React.FC<DocPageProps> = ({ title, description, children }) => (
  <>
    <h1 className="docs-page-title">{title}</h1>
    <p className="docs-page-desc">{description}</p>
    {children}
  </>
)

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="docs-section">
    <h2 className="docs-section__title">{title}</h2>
    {children}
  </div>
)

const Preview: React.FC<{ row?: boolean; children: React.ReactNode }> = ({ row, children }) => (
  <div className={`docs-preview ${row ? 'docs-preview--row' : 'docs-preview--col'}`}>
    {children}
  </div>
)

// ─── Button ───
export const ButtonPage: React.FC = () => (
  <DocPage title="Button" description="Clickable actions with neon glow effects.">
    <Section title="Variants">
      <Preview row>
        <Button variant="primary">Primary</Button>
        <Button variant="filled">Filled</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
      </Preview>
      <CodeBlock language="tsx" code={`<Button variant="primary">Primary</Button>
<Button variant="filled">Filled</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="danger">Danger</Button>`} />
    </Section>
    <Section title="Sizes">
      <Preview row>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Preview>
    </Section>
    <Section title="States">
      <Preview row>
        <Button disabled>Disabled</Button>
        <Button fullWidth>Full Width</Button>
      </Preview>
    </Section>
    <Section title="Props">
      <table className="docs-props-table">
        <thead><tr><th>Prop</th><th>Type</th><th>Default</th></tr></thead>
        <tbody>
          <tr><td>variant</td><td>'primary' | 'filled' | 'ghost' | 'danger'</td><td>'primary'</td></tr>
          <tr><td>size</td><td>'sm' | 'md' | 'lg'</td><td>'md'</td></tr>
          <tr><td>fullWidth</td><td>boolean</td><td>false</td></tr>
          <tr><td>disabled</td><td>boolean</td><td>false</td></tr>
        </tbody>
      </table>
    </Section>
  </DocPage>
)

// ─── Input ───
export const InputPage: React.FC = () => (
  <DocPage title="Input" description="Text input with labels and error states.">
    <Section title="Basic">
      <Preview>
        <Input label="Username" placeholder="Enter username..." />
        <Input label="Password" type="password" placeholder="Enter password..." />
      </Preview>
      <CodeBlock language="tsx" code={`<Input label="Username" placeholder="Enter username..." />
<Input label="Password" type="password" placeholder="..." />`} />
    </Section>
    <Section title="Error State">
      <Preview>
        <Input label="Email" error="Invalid email address" value="bad@" />
      </Preview>
    </Section>
    <Section title="Props">
      <table className="docs-props-table">
        <thead><tr><th>Prop</th><th>Type</th><th>Default</th></tr></thead>
        <tbody>
          <tr><td>label</td><td>string</td><td>-</td></tr>
          <tr><td>error</td><td>string</td><td>-</td></tr>
        </tbody>
      </table>
    </Section>
  </DocPage>
)

// ─── TextArea ───
export const TextAreaPage: React.FC = () => (
  <DocPage title="TextArea" description="Multi-line text input.">
    <Section title="Basic">
      <Preview>
        <TextArea label="Description" placeholder="Write your code description..." rows={4} />
      </Preview>
      <CodeBlock language="tsx" code={`<TextArea label="Description" placeholder="..." rows={4} />`} />
    </Section>
    <Section title="Error State">
      <Preview>
        <TextArea label="Bio" error="Too long" />
      </Preview>
    </Section>
  </DocPage>
)

// ─── Select ───
export const SelectPage: React.FC = () => (
  <DocPage title="Select" description="Dropdown select input.">
    <Section title="Basic">
      <Preview>
        <Select
          label="Language"
          options={[
            { value: 'js', label: 'JavaScript' },
            { value: 'ts', label: 'TypeScript' },
            { value: 'py', label: 'Python' },
            { value: 'rs', label: 'Rust' },
          ]}
        />
      </Preview>
      <CodeBlock language="tsx" code={`<Select label="Language" options={[
  { value: 'js', label: 'JavaScript' },
  { value: 'ts', label: 'TypeScript' },
]} />`} />
    </Section>
  </DocPage>
)

// ─── Badge ───
export const BadgePage: React.FC = () => (
  <DocPage title="Badge" description="Status indicators and labels.">
    <Section title="Variants">
      <Preview row>
        <Badge>Default</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="error">Error</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="info">Info</Badge>
      </Preview>
      <CodeBlock language="tsx" code={`<Badge variant="success">Success</Badge>
<Badge variant="error">Error</Badge>`} />
    </Section>
    <Section title="Pill">
      <Preview row>
        <Badge pill>Default</Badge>
        <Badge variant="success" pill>Online</Badge>
        <Badge variant="error" pill>Offline</Badge>
      </Preview>
    </Section>
  </DocPage>
)

// ─── Card ───
export const CardPage: React.FC = () => (
  <DocPage title="Card" description="Container with sections for structured content.">
    <Section title="Basic">
      <Preview>
        <Card>
          <CardHeader><CardTitle>System Status</CardTitle></CardHeader>
          <CardBody>All systems operational. No incidents detected.</CardBody>
          <CardFooter>
            <Button size="sm" variant="ghost">Details</Button>
            <Button size="sm">Refresh</Button>
          </CardFooter>
        </Card>
      </Preview>
      <CodeBlock language="tsx" code={`<Card>
  <CardHeader><CardTitle>System Status</CardTitle></CardHeader>
  <CardBody>All systems operational.</CardBody>
  <CardFooter>
    <Button size="sm">Refresh</Button>
  </CardFooter>
</Card>`} />
    </Section>
    <Section title="Hoverable & Glow">
      <Preview row>
        <Card hoverable><CardBody>Hover me</CardBody></Card>
        <Card glow><CardBody>I glow</CardBody></Card>
      </Preview>
    </Section>
  </DocPage>
)

// ─── Modal ───
export const ModalPage: React.FC = () => {
  const [open, setOpen] = useState(false)
  return (
    <DocPage title="Modal" description="Dialog overlay with backdrop blur.">
      <Section title="Basic">
        <Preview>
          <Button onClick={() => setOpen(true)}>Open Modal</Button>
          <Modal
            open={open}
            onClose={() => setOpen(false)}
            title="Confirm Action"
            footer={
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="filled" onClick={() => setOpen(false)}>Confirm</Button>
              </>
            }
          >
            Are you sure you want to proceed? This action cannot be undone.
          </Modal>
        </Preview>
        <CodeBlock language="tsx" code={`const [open, setOpen] = useState(false)

<Button onClick={() => setOpen(true)}>Open Modal</Button>
<Modal
  open={open}
  onClose={() => setOpen(false)}
  title="Confirm Action"
  footer={<Button variant="filled">Confirm</Button>}
>
  Are you sure?
</Modal>`} />
      </Section>
    </DocPage>
  )
}

// ─── Tabs ───
export const TabsPage: React.FC = () => (
  <DocPage title="Tabs" description="Tabbed content navigation.">
    <Section title="Basic">
      <Preview>
        <Tabs tabs={[
          { id: 'code', label: 'Code', content: <div style={{ color: '#0f0', fontFamily: 'monospace' }}>console.log("Hello, World!")</div> },
          { id: 'output', label: 'Output', content: <div style={{ color: '#e0e0e0' }}>Hello, World!</div> },
          { id: 'tests', label: 'Tests', content: <div style={{ color: '#2cbb5d' }}>All tests passed.</div> },
        ]} />
      </Preview>
      <CodeBlock language="tsx" code={`<Tabs tabs={[
  { id: 'code', label: 'Code', content: <Code /> },
  { id: 'output', label: 'Output', content: <Output /> },
]} />`} />
    </Section>
  </DocPage>
)

// ─── Alert ───
export const AlertPage: React.FC = () => (
  <DocPage title="Alert" description="Contextual feedback messages.">
    <Section title="Variants">
      <Preview>
        <Alert variant="info">System initialized. All modules loaded.</Alert>
        <Alert variant="success">Build completed successfully in 2.3s.</Alert>
        <Alert variant="warning">Memory usage exceeding 80% threshold.</Alert>
        <Alert variant="error">Connection to server lost. Retrying...</Alert>
      </Preview>
      <CodeBlock language="tsx" code={`<Alert variant="success">Build completed.</Alert>
<Alert variant="error">Connection lost.</Alert>`} />
    </Section>
  </DocPage>
)

// ─── Switch ───
export const SwitchPage: React.FC = () => {
  const [checked, setChecked] = useState(true)
  return (
    <DocPage title="Switch" description="Toggle between on and off states.">
      <Section title="Basic">
        <Preview>
          <Switch checked={checked} onChange={setChecked} label="Dark Mode" />
          <Switch label="Notifications" />
          <Switch checked disabled label="Locked" />
        </Preview>
        <CodeBlock language="tsx" code={`const [checked, setChecked] = useState(true)
<Switch checked={checked} onChange={setChecked} label="Dark Mode" />`} />
      </Section>
    </DocPage>
  )
}

// ─── Spinner ───
export const SpinnerPage: React.FC = () => (
  <DocPage title="Spinner" description="Loading indicators.">
    <Section title="Sizes">
      <Preview row>
        <Spinner size="sm" />
        <Spinner size="md" />
        <Spinner size="lg" />
      </Preview>
      <CodeBlock language="tsx" code={`<Spinner size="sm" />
<Spinner size="md" />
<Spinner size="lg" />`} />
    </Section>
    <Section title="With Content">
      <Preview row>
        <Button disabled>
          <Spinner size="sm" /> Loading...
        </Button>
      </Preview>
    </Section>
  </DocPage>
)

// ─── Tooltip ───
export const TooltipPage: React.FC = () => (
  <DocPage title="Tooltip" description="Contextual text popup on hover.">
    <Section title="Basic">
      <Preview row>
        <Tooltip content="Execute code (Ctrl+Enter)">
          <Button>Run</Button>
        </Tooltip>
        <Tooltip content="Below!" position="bottom">
          <Button variant="ghost">Hover me</Button>
        </Tooltip>
      </Preview>
      <CodeBlock language="tsx" code={`<Tooltip content="Execute code (Ctrl+Enter)">
  <Button>Run</Button>
</Tooltip>`} />
    </Section>
  </DocPage>
)

// ─── Avatar ───
export const AvatarPage: React.FC = () => (
  <DocPage title="Avatar" description="User identity display.">
    <Section title="Sizes & Variants">
      <Preview row>
        <Avatar name="Neo Anderson" size="sm" />
        <Avatar name="Trinity" size="md" />
        <Avatar name="Morpheus" size="lg" glow />
      </Preview>
      <CodeBlock language="tsx" code={`<Avatar name="Neo Anderson" size="sm" />
<Avatar name="Trinity" size="md" />
<Avatar name="Morpheus" size="lg" glow />`} />
    </Section>
  </DocPage>
)

// ─── CodeBlock ───
export const CodeBlockPage: React.FC = () => (
  <DocPage title="CodeBlock" description="Code display with copy functionality.">
    <Section title="Basic">
      <Preview>
        <CodeBlock
          language="typescript"
          code={`function solve(nums: number[], target: number): number[] {
  const map = new Map<number, number>();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (map.has(complement)) {
      return [map.get(complement)!, i];
    }
    map.set(nums[i], i);
  }
  return [];
}`}
        />
      </Preview>
    </Section>
  </DocPage>
)

// ─── Divider ───
export const DividerPage: React.FC = () => (
  <DocPage title="Divider" description="Visual separator between content sections.">
    <Section title="Variants">
      <Preview>
        <div style={{ color: '#aaa' }}>Content above</div>
        <Divider />
        <div style={{ color: '#aaa' }}>Standard divider</div>
        <Divider glow />
        <div style={{ color: '#aaa' }}>Glowing divider</div>
      </Preview>
      <CodeBlock language="tsx" code={`<Divider />
<Divider glow />`} />
    </Section>
  </DocPage>
)

// ─── Kbd ───
export const KbdPage: React.FC = () => (
  <DocPage title="Kbd" description="Keyboard shortcut display.">
    <Section title="Basic">
      <Preview row>
        <span style={{ color: '#aaa' }}>Press <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to run</span>
      </Preview>
      <Preview row>
        <Kbd>Esc</Kbd>
        <Kbd>Tab</Kbd>
        <Kbd>Shift</Kbd>
        <Kbd>&#8984; Cmd</Kbd>
      </Preview>
      <CodeBlock language="tsx" code={`<Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd>`} />
    </Section>
  </DocPage>
)

// ─── Chat ───
const demoMessages: ChatMessage[] = [
  { id: '1', content: 'Hey, did you solve the two-sum problem?', sender: 'incoming', senderName: 'Neo', timestamp: '21:30' },
  { id: '2', content: 'Yeah, used a hash map approach. O(n) time.', sender: 'outgoing', senderName: 'You', timestamp: '21:31' },
  { id: '3', content: 'Nice. Can you share the code?', sender: 'incoming', senderName: 'Neo', timestamp: '21:31' },
  { id: '4', content: 'Sure, pushing it to the repo now.', sender: 'outgoing', senderName: 'You', timestamp: '21:32' },
]

export const ChatPage: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(demoMessages)
  const [typing, setTyping] = useState(false)

  const handleSend = (content: string) => {
    setMessages(prev => [...prev, {
      id: String(Date.now()),
      content,
      sender: 'outgoing',
      senderName: 'You',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }])
    setTyping(true)
    setTimeout(() => {
      setTyping(false)
      setMessages(prev => [...prev, {
        id: String(Date.now() + 1),
        content: 'Roger that. Pulling now.',
        sender: 'incoming',
        senderName: 'Neo',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }])
    }, 1500)
  }

  return (
    <DocPage title="Chat" description="Real-time chat interface with message bubbles, typing indicator, and auto-scroll.">
      <Section title="Interactive Demo">
        <Preview>
          <Chat
            messages={messages}
            onSend={handleSend}
            title="Neo"
            subtitle="online"
            avatarInitials="NA"
            typing={typing}
            typingText="Neo is typing"
            placeholder="Type a message..."
          />
        </Preview>
        <CodeBlock language="tsx" code={`const [messages, setMessages] = useState<ChatMessage[]>([])

<Chat
  messages={messages}
  onSend={(text) => setMessages(prev => [...prev, {
    id: String(Date.now()),
    content: text,
    sender: 'outgoing',
    senderName: 'You',
    timestamp: '21:32',
  }])}
  title="Neo"
  subtitle="online"
  typing={isTyping}
  typingText="Neo is typing"
/>`} />
      </Section>
      <Section title="Glow Variant">
        <Preview>
          <Chat
            messages={demoMessages.slice(0, 2)}
            title="Trinity"
            subtitle="offline"
            avatarInitials="T"
            glow
            placeholder="Encrypted channel..."
          />
        </Preview>
      </Section>
      <Section title="Props">
        <table className="docs-props-table">
          <thead><tr><th>Prop</th><th>Type</th><th>Default</th></tr></thead>
          <tbody>
            <tr><td>messages</td><td>ChatMessage[]</td><td>required</td></tr>
            <tr><td>onSend</td><td>(message: string) =&gt; void</td><td>-</td></tr>
            <tr><td>title</td><td>string</td><td>'Chat'</td></tr>
            <tr><td>subtitle</td><td>string</td><td>-</td></tr>
            <tr><td>avatarSrc</td><td>string</td><td>-</td></tr>
            <tr><td>avatarInitials</td><td>string</td><td>-</td></tr>
            <tr><td>placeholder</td><td>string</td><td>'Type a message...'</td></tr>
            <tr><td>typing</td><td>boolean</td><td>false</td></tr>
            <tr><td>typingText</td><td>string</td><td>'typing'</td></tr>
            <tr><td>glow</td><td>boolean</td><td>false</td></tr>
            <tr><td>headerActions</td><td>ReactNode</td><td>-</td></tr>
          </tbody>
        </table>
      </Section>
      <Section title="ChatMessage Type">
        <CodeBlock language="tsx" code={`interface ChatMessage {
  id: string
  content: string
  sender: 'incoming' | 'outgoing'
  senderName?: string
  timestamp?: string
}`} />
      </Section>
    </DocPage>
  )
}
