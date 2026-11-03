import { useEffect, useRef } from 'react'

const WORDS = ['Clients', 'Vendors', 'Reviewers', 'Guests']

/* Pricing hero: markup verbatim + cycling headline script (#5) */
export default function PricingHero() {
  const cycRef = useRef(null)
  const innRef = useRef(null)

  useEffect(() => {
    const box = cycRef.current, inn = innRef.current
    if (!box || !inn) return
    const ws = [].slice.call(inn.children)
    let k = 0
    let widths = []
    const calm = matchMedia('(prefers-reduced-motion:reduce)').matches
    // Size the pill to whichever word is on show: the lime highlight hugs each
    // word and the width eases between words (see .cyc's width transition).
    // The headline is laid out as three fixed short lines (pay. / pill / join
    // free.), so cycling words can never re-wrap the headline at any viewport.
    function measure() { widths = ws.map(function (e) { return e.offsetWidth }) }
    function size() {
      if (!widths.length) measure()
      const w = widths[k % ws.length]
      box.style.width = (w != null ? w : Math.max.apply(null, widths)) + 'px'
    }
    function go() { inn.style.transform = 'translateY(-' + (k * 1.1) + 'em)'; size() }
    const remeasure = function () { measure(); go() }
    measure()
    size()
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure)
    addEventListener('resize', remeasure)
    let iv = null
    if (!calm) iv = setInterval(function () { k = (k + 1) % ws.length; go() }, 2200)
    return () => { removeEventListener('resize', remeasure); clearInterval(iv) }
  }, [])

  return (
    <section className="pricing-hero rv" aria-labelledby="pricing-title">
      <div className="ph-text">
        <span className="tag">Explore Devworkspace</span>
        <h1 id="pricing-title"><span className="sr">Planners pay. Everyone else joins free.</span><span className="h1v" aria-hidden="true">Planners pay.<br /><span className="cyc" ref={cycRef}><span className="cyc-in" ref={innRef}>{WORDS.map(w => <span className="cw" key={w}>{w}</span>)}</span></span><br />join <span className="hl2">free.</span></span></h1>
        <p className="lede">Explore the complete product experience with demo data. No signup, payment, or credit card required.</p>
        <a className="cta" href="/login">Open demo workspace <svg viewBox="0 0 18 15" fill="none" aria-hidden="true"><path d="M1 7.5h16m0 0L10.6 1.1M17 7.5l-6.4 6.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></a>
      </div>
      <div className="ph-viz" aria-hidden="true">
        <i className="fl f1" style={{ background: '#9aa6ff' }}>A<s>free</s></i>
        <i className="fl f2" style={{ background: '#d9a07a' }}>S<s>free</s></i>
        <i className="fl f3" style={{ background: '#8c7cf6' }}>D<s>free</s></i>
        <div className="ticket">
          <div className="tk-top"><small>Live</small><b>Demo</b></div>
          <div className="tk-perf" />
          <ul className="tk-ls"><li><i>✓</i>No payment required</li><li><i>✓</i>All roles included</li><li><i>✓</i>Sample data ready</li></ul>
          <div className="tk-code" />
        </div>
        <svg className="stamp" viewBox="0 0 120 120"><defs><path id="sp" d="M60 60m-46 0a46 46 0 1 1 92 0a46 46 0 1 1-92 0"/></defs><circle cx="60" cy="60" r="58" fill="#f1fd82" stroke="#111" strokeWidth="2"/><text fontSize="11.5" fontWeight="700" letterSpacing="2.2" fill="#111" fontFamily="Helvetica Neue,Arial,sans-serif"><textPath href="#sp">EXPLORE THE PRODUCT • EXPLORE THE PRODUCT • </textPath></text><path d="M60 40l5.5 13.5L80 55l-11 9.5L72 79l-12-8-12 8 3-14.5L40 55l14.5-1.5z" fill="#111"/></svg>
      </div>
    </section>
  )
}
