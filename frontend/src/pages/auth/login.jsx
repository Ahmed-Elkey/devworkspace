import React, { useRef, useState, useEffect } from 'react'
import './login.css'
import cssUrl from './login.css?url'
import { usePageStylesheet } from '../../app/PageStylesheet.jsx'
import { useBoxEnhance, AuthStage, busy } from './shared.jsx'
import { auth } from '../../lib/auth.js'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../demo/accounts.js'
import { demoMode, warmDemoAccount } from '../../demo/index.js'
import { navigate } from '../../app/navigate.js'

function LoginApp() {
  const boxRef = useRef(null)
  const errRef = useRef(null)
  const btnRef = useRef(null)
  const [errorMessage, setErrorMessage] = useState('Email or password is incorrect.')
  const [showError, setShowError] = useState(false)
  const [noticeMessage, setNoticeMessage] = useState('')
  const [picked, setPicked] = useState('')

  useBoxEnhance(boxRef)

  const pickedAccount = DEMO_ACCOUNTS.find((a) => a.email === picked) || null

  const fill = (account) => {
    const emailInput = document.getElementById('e')
    const passwordInput = document.getElementById('p')
    if (emailInput) emailInput.value = account.email
    if (passwordInput) passwordInput.value = DEMO_PASSWORD
    setPicked(account.email)
    setShowError(false)
    // The production demo is frontend-only. Warm this role's recorded data
    // while the visitor is reading the form, so sign-in and first dashboard
    // paint have no API or data-loading wait.
    if (demoMode) void warmDemoAccount(account.email)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('notice') === 'org_created') {
      setNoticeMessage('Your organization is ready. Sign in again to continue.')
      try {
        const stored = sessionStorage.getItem('__dw_prefill_email')
        if (stored) {
          const emailInput = document.getElementById('e')
          if (emailInput) emailInput.value = stored
          sessionStorage.removeItem('__dw_prefill_email')
        }
      } catch (_) {}
    } else if (params.get('notice') === 'session_ended' || params.get('reason') === 'session_updated' || params.get('reason') === 'expired') {
      setNoticeMessage('Your session ended. Please sign in again.')
    }

    if (params.get('autofill') === '1' || params.get('demo') === '1') {
      const emailInput = document.getElementById('e')
      const passwordInput = document.getElementById('p')
      if (emailInput) emailInput.value = 'demo@agency.com'
      if (passwordInput) passwordInput.value = DEMO_PASSWORD
      setPicked('demo@agency.com')
      if (demoMode) void warmDemoAccount('demo@agency.com')
    }

    // If already authenticated, redirect to workspace or onboarding
    let active = true
    auth.init().then((session) => {
      if (!active || !session.authenticated) return
      const returnTo = params.get('returnTo')
      if (session.principals && session.principals.length > 0) {
        navigate(returnTo || '/workspace/dashboard')
      } else if (session.clientPrincipals && session.clientPrincipals.length > 0) {
        navigate(returnTo || '/portal/portal-projects')
      } else {
        navigate('/onboarding')
      }
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setShowError(false)

    const form = e.currentTarget
    const email = form.querySelector('#e').value.trim()
    const rawPassword = form.querySelector('#p').value
    const password = rawPassword.trim()
    const btn = btnRef.current
    const origText = btn.textContent
    btn.disabled = true
    btn.textContent = 'Signing in…'

    try {
      let authRes = null
      try {
        authRes = await auth.login(email, password)
      } catch (loginErr) {
        if (rawPassword !== password) {
          authRes = await auth.login(email, rawPassword)
        } else {
          throw loginErr
        }
      }
      const { principals, clientPrincipals } = authRes
      const params = new URLSearchParams(window.location.search)
      const returnTo = params.get('returnTo')

      if ((!principals || principals.length === 0) && (!clientPrincipals || clientPrincipals.length === 0)) {
        navigate('/onboarding')
      } else if (!principals || principals.length === 0) {
        navigate(returnTo || '/portal/portal-projects')
      } else {
        navigate(returnTo || '/workspace/dashboard')
      }
    } catch (err) {
      btn.disabled = false
      btn.textContent = origText
      setErrorMessage(err.details?.message || err.message || 'Email or password is incorrect.')
      setShowError(true)
    }
  }

  return (
    <main className="split">
      <AuthStage ariaHiddenFalse msg={<><h2>Pick up where the <mark className="hm">timeline</mark> left off.</h2><p>Your projects, reviews and clients are exactly as you left them.</p></>} />
      <section className="formside"><div className="box" ref={boxRef}>
        <h1>Sign in</h1><p>Use the email you registered with.</p>
        {noticeMessage && (
          <div className="msg" role="status" style={{ marginBottom: 16 }}>
            {noticeMessage}
          </div>
        )}
        <div className="msg err" role="alert" hidden={!showError} id="err" ref={errRef}>
          {errorMessage}
        </div>
        <div className="demo">
          <div className="demo-h">
            <b>Try a role</b>
            {pickedAccount ? (
              <span aria-live="polite"><code>{pickedAccount.email}</code> — {pickedAccount.blurb}</span>
            ) : (
              <span>Fills the form, you press Sign in. Password for all: <code>{DEMO_PASSWORD}</code></span>
            )}
          </div>
          <div className="demo-g">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                className="demo-role"
                aria-pressed={picked === a.email}
                onClick={() => fill(a)}
              >
                {a.role}
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="fld"><label htmlFor="e">Email</label><input id="e" type="email" autoComplete="email" required /></div>
          <div className="fld"><label htmlFor="p">Password</label><input id="p" type="password" autoComplete="current-password" required /></div>
          <div className="row"><span /><a href="/forgot-password">Forgot your password?</a></div>
          <button className="btn lime" type="submit" ref={btnRef}>Sign in</button>
        </form>
        <p className="alt">New here? <a href="/register">Create an account</a></p>
      </div></section>
    </main>
  )
}

// The stylesheet rides on the route mount, not on the module import, so it
// leaves when the page does.
export default function LoginAppPage() {
  usePageStylesheet(cssUrl)
  return <LoginApp />
}
