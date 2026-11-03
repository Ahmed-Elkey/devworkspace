const QA = [
  ['Is this a real subscription?', 'No. This is an interactive product demo, so there is no checkout, payment, or subscription.'],
  ['Do I need an account?', 'No new account is needed. Open the demo login and choose any pre-filled role to explore the product.'],
  ['What can I explore?', 'The demo includes workspace, project delivery, and client portal screens with realistic sample data.'],
  ['Can I change the sample data?', 'Yes. Most product interactions work locally in your browser and reset when the demo session is cleared.'],
  ['Are the prices real?', 'They are interface sample content used to demonstrate the pricing screen; no plan can be purchased here.'],
  ['Which roles are available?', 'Owner, manager, designer, contributor, viewer, and client portal roles are ready to explore.']
]

/* FAQ: static markup only — <details> behaves natively, animations are CSS-driven */
export default function Faq() {
  return (
    <section className="faq rv" aria-labelledby="faq-h">
      <div className="faq-side">
        <span className="tag">FAQ</span>
        <h2 id="faq-h">About this <span className="hl">demo</span></h2>
        <p className="faq-note">Explore every part of the product—no payment details or subscription required.</p>
        <p className="faq-count"><b id="faq-n">6</b> answers</p>
        <div className="faq-art" aria-hidden="true"><span className="fb b1">?</span><span className="fb b2">$</span></div>
      </div>
      <div className="faq-list">
        {QA.map(([q, a], i) => (
          <details key={i} style={{ '--n': i }}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
