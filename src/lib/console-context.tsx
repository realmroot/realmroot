import { createContext, type ReactNode, useContext } from 'react'

export type ConsoleScope = {
  organizationId?: string
  realmOperator: boolean
}

const ConsoleScopeContext = createContext<ConsoleScope>({ realmOperator: true })

export function ConsoleScopeProvider({ children, value }: { children: ReactNode; value: ConsoleScope }) {
  return <ConsoleScopeContext.Provider value={value}>{children}</ConsoleScopeContext.Provider>
}

export function useConsoleScope() {
  return useContext(ConsoleScopeContext)
}
