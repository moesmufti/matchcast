interface FooterProps {
  /** True when the dashboard is driven by the client-side simulator. */
  simulated: boolean
}

export function Footer({ simulated }: FooterProps) {
  return (
    <footer className="footer">
      <p>
        Model estimates for entertainment — not betting advice.{' '}
        {simulated ? 'Simulated feed — add a sports-data key for live use.' : 'Live data feed.'}
      </p>
    </footer>
  )
}
