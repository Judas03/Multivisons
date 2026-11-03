const workstreams = [
  ["AI and agreement quality", "packages/agent", "Not implemented"],
  ["PayPal sandbox operations", "packages/payments", "Capability checks pending"],
  ["Web app and domain workflow", "apps/web", "Scaffold ready"],
] as const;

export default function HomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">PAYPAL AI HACKATHON · PROJECT SCAFFOLD</p>
      <h1>Multivisons</h1>
      <p className="intro">
        Turn a client and contractor&apos;s conversation into a jointly accepted project scope,
        track milestone evidence, and require human approval before any sandbox payment action.
      </p>
      <section aria-labelledby="workstreams-heading">
        <h2 id="workstreams-heading">Implementation status</h2>
        <ul className="status-list">
          {workstreams.map(([name, owner, status]) => (
            <li key={owner}>
              <span>
                <strong>{name}</strong>
                <small>{owner}</small>
              </span>
              <span className="status">{status}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="notice">
        AI does not approve terms or payments. This scaffold does not yet perform PayPal API calls.
      </p>
    </main>
  );
}
