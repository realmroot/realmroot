import { Component, type ReactNode } from 'react'

// This boundary must not depend on the router, translations, configuration, or the design system.
export class ApplicationErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('Application rendering failed.', error)
    window.dispatchEvent(new Event('realmroot:fatal'))
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
