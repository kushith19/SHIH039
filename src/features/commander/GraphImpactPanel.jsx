export default function GraphImpactPanel({ localBlurb }) {
  return (
    <section className="soc-zone px-5 py-4">
      <h2 className="soc-zone-title">Graph impact</h2>
      <p className="mt-2 text-sm leading-relaxed">
        <span className="font-medium">Local risk. </span>
        {localBlurb ||
          'Residual and trust on the origin endpoint. Open an incident for a full path view.'}
      </p>
    </section>
  )
}
