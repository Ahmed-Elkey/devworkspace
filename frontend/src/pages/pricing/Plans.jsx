import { useEffect, useRef } from 'react'
import { PLANS, planBy, yearlyBilled, yearlyPerMonth, fmtMoney } from '../../lib/pricing.js'

/* Calculator + plans: markup verbatim + scripts #4 (calc) — the plan stagger and
   price count-up from script #2 live in PricingApp's global effect (same script)
   Numbers come from src/lib/pricing.js: monthly = flat rate; yearly = that rate
   paid for ten months (2 months free), shown amortised over 12 months. */
export default function Plans() {
  const outRef = useRef(null)
  const resRef = useRef(null)
  const cmRef = useRef(null)
  const cpRef = useRef(null)
  const bmRef = useRef(null)
  const byRef = useRef(null)

  useEffect(() => {
    const cards = [].slice.call(document.querySelectorAll('[data-plan-card]'))
    const out = outRef.current, res = resRef.current, m = cmRef.current, pl = cpRef.current
    const bm = bmRef.current, by = byRef.current
    if (!cards.length || !out) return
    // Billing thumb: slide the lime capsule under the active period button
    const bill = bm.parentElement
    function thumb() {
      const btn = by.classList.contains('on') ? by : bm
      bill.style.setProperty('--tx', btn.offsetLeft + 'px')
      bill.style.setProperty('--tw', btn.offsetWidth + 'px')
    }
    const onThumbResize = function () { thumb() }
    thumb()
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(thumb)
    addEventListener('resize', onThumbResize)
    let n = 3
    let yearly = false
    function pick() { for (var i = 0; i < cards.length; i++) { if (n <= +cards[i].dataset.max) return cards[i] } return cards[cards.length - 1] }

    function applyPeriod(next) {
      cards.forEach(function (c) {
        var plan = planBy(c.dataset.planCard)
        var text = next ? fmtMoney(yearlyBilled(plan)) : fmtMoney(plan.monthly)
        var t = c.querySelector('.price')
        if (t && t.firstChild && t.firstChild.nodeType === 3) t.firstChild.nodeValue = text
        var s = t && t.querySelector('small')
        if (s) s.textContent = next ? 'per planner / year — 2 months free' : 'per planner / month'
        var a = c.querySelector('a.btn')
        if (a) a.href = '/register?plan=' + c.dataset.planCard + '&billing=' + (next ? 'yearly' : 'monthly')
      })
      if (bm && by) {
        bm.classList.toggle('on', !next); by.classList.toggle('on', next)
        bm.setAttribute('aria-pressed', String(!next)); by.setAttribute('aria-pressed', String(next))
        thumb()
      }
    }

    function render(bump) {
      var c = pick(), name = c.querySelector('h2').textContent, plan = planBy(c.dataset.planCard)
      out.textContent = n
      if (bump) { out.classList.remove('bump'); void out.offsetWidth; out.classList.add('bump') }
      if (!yearly) res.innerHTML = 'Best fit: <b>' + name + '</b> &middot; about <b>' + fmtMoney(n * plan.monthly) + ' / month</b> &middot; guests are free'
      else {
        var aMonth = Math.round(n * yearlyPerMonth(plan) * 100) / 100
        var aYear = n * yearlyBilled(plan)
        res.innerHTML = 'Best fit: <b>' + name + '</b> &middot; about <b>' + fmtMoney(aMonth) + ' / month</b>'
          + ' &middot; billed yearly, so <b>' + fmtMoney(aYear) + ' a year (2 months free)</b>'
          + ' &middot; guests are free'
      }
      cards.forEach(function (x) { x.classList.toggle('fit', x === c) })
    }

    function setPeriod(next) {
      if (yearly === next) return
      yearly = next
      applyPeriod(next)
      render(false)
    }
    const onM = function () { if (n > 1) { n--; render(true) } }
    const onP = function () { if (n < 99) { n++; render(true) } }
    const onBM = function () { setPeriod(false) }
    const onBY = function () { setPeriod(true) }
    m.addEventListener('click', onM)
    pl.addEventListener('click', onP)
    if (bm) bm.addEventListener('click', onBM)
    if (by) by.addEventListener('click', onBY)
    // render() also runs on first load so the "Best fit" line isn't empty right after mount
    render(false)
    return () => {
      m.removeEventListener('click', onM); pl.removeEventListener('click', onP)
      if (bm) bm.removeEventListener('click', onBM)
      if (by) by.removeEventListener('click', onBY)
      removeEventListener('resize', onThumbResize)
    }
  }, [])

  return (
    <>
      <div className="bill rv" role="group" aria-label="Billing period">
        <button type="button" id="bm" className="on" aria-pressed="true" ref={bmRef}>Monthly</button>
        <button type="button" id="by" aria-pressed="false" ref={byRef}>Yearly <em>2 months free</em></button>
      </div>

      <div className="calc rv" aria-labelledby="calc-q">
        <span className="calc-q" id="calc-q">How many planners do you need?</span>
        <div className="calc-ctl">
          <button type="button" id="cm" aria-label="Fewer planners" ref={cmRef}>−</button>
          <output id="cn" aria-live="polite" ref={outRef}>3</output>
          <button type="button" id="cp" aria-label="More planners" ref={cpRef}>+</button>
        </div>
        <p className="calc-res" id="cr" aria-live="polite" ref={resRef} />
      </div>

      <section className="plans" id="plans" aria-label="Plans">
        {PLANS.map((p, i) => (
          <article className={'plan rv' + (p.pick ? ' pick' : '')} data-plan-card={p.key} data-max={p.max} data-monthly={p.monthly} key={p.key}>
            {p.pick && <span className="badge"><i className="bd-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l2.6 6.4L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.4-.6z"/></svg></i>Most teams pick this</span>}
            <div className="pl-art" aria-hidden="true">{p.art.map((a, j) => a[0] === 'more' ? <i className="more" key={j}>{a[1]}</i> : <i style={{ background: a[0] }} key={j}>{a[1]}</i>)}</div>
            <h2>{p.h2}</h2>
            <p className="for">{p.forTxt}</p>
            <p className="price">{fmtMoney(p.monthly)}<small>per planner / month</small></p>
            <ul>
              {p.lis.map((l, j) => {
                const inh = l && typeof l === 'object' && l.inh
                const t = inh ? l.t : l
                return inh ? <li className="inh" key={j}>{t}</li> : <li key={j}>{t}</li>
              })}
            </ul>
            <a className="btn" href={'/register?plan=' + p.key + '&billing=monthly'} data-plan={p.key}>Start 14-day trial</a>
          </article>
        ))}
      </section>
    </>
  )
}
