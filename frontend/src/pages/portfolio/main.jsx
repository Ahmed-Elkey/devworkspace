import './portfolio.css'
import cssUrl from './portfolio.css?url'
import { usePageStylesheet } from '../../app/PageStylesheet.jsx'

const ARROW = <svg viewBox="0 0 18 15" fill="none" aria-hidden="true"><path d="M1 7.5h16m0 0L10.6 1.1M17 7.5l-6.4 6.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>

function Nav() {
  const current = window.location.pathname
  return <header className="portfolio-nav">
    <a className="portfolio-brand" href="/" aria-label="Devworkspace home"><span aria-hidden="true">≡</span> Devworkspace</a>
    <nav aria-label="Portfolio navigation">
      <a href="/" className={current === '/' ? 'current' : ''}>Product</a>
      <a href="/how-it-works" className={current === '/how-it-works' ? 'current' : ''}>How it works</a>
      <a href="/about" className={current === '/about' ? 'current' : ''}>Who I am</a>
      <a href="/demo-guide" className={current === '/demo-guide' ? 'current' : ''}>Demo guide</a>
    </nav>
    <a className="portfolio-demo-link" href="/login">Open demo</a>
  </header>
}

function Footer() {
  return <footer className="portfolio-footer">
    <div><b>Devworkspace</b><p>Interactive product-design portfolio demo.</p></div>
    <nav aria-label="Footer navigation"><a href="/how-it-works">How it works</a><a href="/about">Who I am</a><a href="/demo-guide">Demo guide</a><a href="/login">Open demo</a></nav>
  </footer>
}

function About() {
  return <PageFrame eyebrow="Who I am" title={<>I turn complex work into <mark>clear product experiences.</mark></>} intro="This is a portfolio case study for Devworkspace: a project-delivery product designed to bring planning, files, reviews, and client communication into one calm workspace.">
    <section className="portfolio-grid two" aria-label="About this project">
      <article><span className="number">01</span><h2>Product thinking</h2><p>The experience starts from real project moments: assigning work, sharing progress, collecting feedback, and making decisions without losing context.</p></article>
      <article><span className="number">02</span><h2>Design with purpose</h2><p>Every screen is built to make the next action obvious—from an owner’s dashboard to a client’s approval view.</p></article>
      <article><span className="number">03</span><h2>Build the details</h2><p>This portfolio version includes responsive interactions, route transitions, role-based views, and realistic sample content.</p></article>
    </section>
    <section className="portfolio-dark"><span className="eyebrow">The goal</span><h2>A complete product story, not just a collection of screens.</h2><p>Explore the work as different people would: a workspace owner, a project manager, a contributor, or a client reviewing deliverables.</p><a href="/demo-guide" className="portfolio-cta light">See the demo guide {ARROW}</a></section>
  </PageFrame>
}

function HowItWorks() {
  const steps = [
    ['Pick a role', 'Start at the demo login and choose a ready-made account. Each role opens a different view of the same product.'],
    ['Explore the workspace', 'Review projects, tasks, files, reports, notifications, documents, and team activity using sample data.'],
    ['Follow a project', 'Open a project to see milestones, task details, discussions, deliverables, review feedback, and access settings.'],
    ['See the client side', 'Use one of the client roles to enter the portal, where clients can follow updates and review shared deliverables.']
  ]
  return <PageFrame eyebrow="How it works" title={<>One product. <mark>Different perspectives.</mark></>} intro="The demo is ready from the first click. No signup, payment, server, or setup is needed—just choose a role and explore.">
    <ol className="portfolio-steps">{steps.map(([title, text], i) => <li key={title}><span>{String(i + 1).padStart(2, '0')}</span><div><h2>{title}</h2><p>{text}</p></div></li>)}</ol>
    <section className="portfolio-callout"><div><span className="eyebrow">Made for exploring</span><h2>Your changes stay in this browser session.</h2><p>The demo uses local sample data, so you can click around confidently. Refreshing or clearing the session restores the starting state.</p></div><a href="/login" className="portfolio-cta">Open the demo {ARROW}</a></section>
  </PageFrame>
}

function Guide() {
  const roles = [
    ['Owner', 'Full workspace, team, settings, reports, and audit trail.'],
    ['Project manager', 'Project planning, milestones, task flow, files, and reviews.'],
    ['Contributor', 'Assigned tasks and collaboration discussions.'],
    ['Viewer', 'Read-only project access.'],
    ['Client approver', 'Client portal with formal approval decisions.'],
    ['Client reviewer', 'Client portal feedback and review comments.']
  ]
  return <PageFrame eyebrow="Demo guide" title={<>Start with a role, then <mark>follow the story.</mark></>} intro="Use the role picker on the sign-in page. All accounts use the same password shown there, and the login form is filled automatically when you choose one.">
    <section className="portfolio-grid roles" aria-label="Available demo roles">{roles.map(([role, text]) => <article key={role}><span className="role-dot" /><h2>{role}</h2><p>{text}</p></article>)}</section>
    <section className="portfolio-dark guide-end"><span className="eyebrow">Suggested route</span><h2>Owner dashboard → project → deliverables → client portal.</h2><p>This path gives the clearest look at planning, collaboration, file delivery, review, and approval in one flow.</p><a href="/login" className="portfolio-cta light">Choose a demo role {ARROW}</a></section>
  </PageFrame>
}

function PageFrame({ eyebrow, title, intro, children }) {
  return <><Nav /><main className="portfolio-main"><section className="portfolio-hero"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{intro}</p></section>{children}</main><Footer /></>
}

export default function PortfolioPage() {
  usePageStylesheet(cssUrl)
  if (window.location.pathname === '/how-it-works') return <HowItWorks />
  if (window.location.pathname === '/demo-guide') return <Guide />
  return <About />
}
