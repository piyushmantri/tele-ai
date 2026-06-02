import React from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { DocsLayout } from './docs/DocsLayout'
import { HomePage } from './docs/pages/HomePage'
import { GettingStartedPage } from './docs/pages/GettingStartedPage'
import { ThemePage } from './docs/pages/ThemePage'
import {
  ButtonPage, InputPage, TextAreaPage, SelectPage,
  BadgePage, CardPage, ModalPage, TabsPage,
  AlertPage, SwitchPage, SpinnerPage, TooltipPage,
  AvatarPage, CodeBlockPage, DividerPage, KbdPage,
  ChatPage,
} from './docs/pages/ComponentPages'

const componentRoutes: Record<string, React.FC> = {
  button: ButtonPage,
  input: InputPage,
  textarea: TextAreaPage,
  select: SelectPage,
  badge: BadgePage,
  card: CardPage,
  modal: ModalPage,
  tabs: TabsPage,
  alert: AlertPage,
  switch: SwitchPage,
  spinner: SpinnerPage,
  tooltip: TooltipPage,
  avatar: AvatarPage,
  codeblock: CodeBlockPage,
  divider: DividerPage,
  kbd: KbdPage,
  chat: ChatPage,
}

export const App: React.FC = () => (
  <HashRouter>
    <Routes>
      <Route element={<DocsLayout />}>
        <Route index element={<HomePage />} />
        <Route path="getting-started" element={<GettingStartedPage />} />
        <Route path="theme" element={<ThemePage />} />
        {Object.entries(componentRoutes).map(([name, Component]) => (
          <Route key={name} path={`components/${name}`} element={<Component />} />
        ))}
      </Route>
    </Routes>
  </HashRouter>
)
