// A page that throws used to take the whole app with it: React unmounted the
// tree and the visitor was left staring at a blank white screen with nothing
// to click. This boundary catches the failure, keeps the app alive, and shows
// a page the visitor can act on (try again, or go back to the dashboard).
//
// It resets itself when the route changes, so a broken page does not poison
// the next one.

import React from 'react'

const PANEL = {
  minHeight: '60vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px 24px',
  background: 'var(--bg, #f8f8f8)',
  color: 'var(--fg, #111111)',
}

const CARD = {
  maxWidth: '520px',
  width: '100%',
  padding: '26px',
  borderRadius: '16px',
  border: '1px solid var(--line, #e4e4e4)',
  background: 'var(--panel, #ffffff)',
  boxShadow: '0 14px 40px rgba(0,0,0,.07)',
}

const BUTTON = {
  display: 'inline-block',
  padding: '9px 16px',
  borderRadius: '999px',
  border: '1px solid var(--line, #d9d9d9)',
  background: 'var(--panel, #ffffff)',
  color: 'inherit',
  font: 'inherit',
  textDecoration: 'none',
  cursor: 'pointer',
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[dw] page crashed:', error, info && info.componentStack)
  }

  componentDidUpdate(prevProps) {
    // A new route gets a fresh chance: the error belonged to the old page.
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: null })
    }
  }

  reset() {
    this.setState({ error: null, info: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div style={PANEL}>
        <div style={CARD} role="alert">
          <h1 style={{ margin: '0 0 10px', fontSize: '22px', lineHeight: 1.25 }}>
            This page ran into a problem
          </h1>
          <p style={{ margin: '0 0 18px', color: 'var(--muted, #595959)', lineHeight: 1.55 }}>
            The rest of the app is still running. You can try this page again, or head back to your
            dashboard.
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn" type="button" style={BUTTON} onClick={this.reset}>
              Try again
            </button>
            <a className="btn" href="/workspace/dashboard" style={BUTTON}>
              Go to dashboard
            </a>
            <button className="btn" type="button" style={BUTTON} onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
