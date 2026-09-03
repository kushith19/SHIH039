export default function GraphImpactPanel({ localBlurb }) {
  return (
    <section className="tn-surface px-5 py-5">
      <h2 className="tn-section-title">Graph impact</h2>
      <p className="mt-3 text-sm leading-relaxed">
        <span className="font-medium">Local risk. </span>
        {localBlurb || 'Residual and trust on the origin endpoint.'}
      </p>
    </section>
  )
}
