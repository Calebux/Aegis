import Link from "next/link";

const FEATURES = [
  {
    title: "x402 Payments",
    desc: "Agents pay each other in cUSD using the x402 protocol. Every transaction is verifiable on-chain.",
    icon: "\u21C4",
  },
  {
    title: "On-Chain Reputation",
    desc: "AegisCeloRegistry tracks agent trust scores after every pipeline run. Route tasks by reputation tier.",
    icon: "\u2605",
  },
  {
    title: "Spend Policies",
    desc: "AegisCeloPolicy enforces per-agent spend caps and session limits at the contract level.",
    icon: "\u229B",
  },
  {
    title: "Verifiable Receipts",
    desc: "Every agent run produces a cryptographically signed receipt with task hash, output hash, and payment proof.",
    icon: "\u2713",
  },
  {
    title: "Agent Discovery",
    desc: "Machine-readable manifests with capability, payment, and policy metadata. Filter and compose agents via API.",
    icon: "\u2318",
  },
  {
    title: "MCP Tooling",
    desc: "Model Context Protocol integration lets LLMs discover and call Cal-AgentKit agents as native tools.",
    icon: "\u2693",
  },
];

const USE_CASES = [
  {
    title: "DeFi Research Agent",
    desc: "Aggregate on-chain analytics, market signals, and web research into a single verified report.",
  },
  {
    title: "Portfolio Monitor",
    desc: "Track wallet positions across Celo DeFi protocols with automated alerting and attestation.",
  },
  {
    title: "Compliance Agent",
    desc: "Enforce policy constraints on agent spending and flag anomalous transaction patterns.",
  },
  {
    title: "Multi-Agent Pipeline",
    desc: "Compose Scout, Ledger, Signal, Scribe, and Notary agents into governed research workflows.",
  },
  {
    title: "Price Oracle Agent",
    desc: "Average multiple data snapshots with consensus validation for reliable on-chain price feeds.",
  },
  {
    title: "Cross-Protocol Agent",
    desc: "Bridge agent operations between Celo and Stellar with unified receipts and reputation.",
  },
];

const FOOTER_LINKS = {
  Product: [
    { label: "Live Demo", href: "/dashboard" },
    { label: "Agent Registry", href: "/agents" },
    { label: "Receipts", href: "/receipts" },
  ],
  Developers: [
    { label: "GitHub", href: "https://github.com/calebcauthon/agent-kit" },
    { label: "npm", href: "https://www.npmjs.com/package/@calebux/agent-kit" },
    { label: "Documentation", href: "https://github.com/calebcauthon/agent-kit#readme" },
  ],
  Ecosystem: [
    { label: "Celo", href: "https://celo.org" },
    { label: "x402 Protocol", href: "https://www.x402.org" },
    { label: "Prezenti", href: "https://prezenti.xyz" },
  ],
};

export default function LandingPage() {
  return (
    <div className="landing">
      {/* ── Nav ──────────────────────────────────────────────────── */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">CAL-AGENTKIT</span>
          <div className="landing-nav-links">
            <a href="https://github.com/calebcauthon/agent-kit" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href="https://www.npmjs.com/package/@calebux/agent-kit" target="_blank" rel="noopener noreferrer">
              npm
            </a>
            <Link href="/agents">Agents</Link>
            <Link href="/dashboard" className="landing-nav-cta">
              Try Demo
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="landing-hero">
        <div className="landing-container">
          <h1 className="landing-hero-title">
            Agent infrastructure for <span className="landing-celo-yellow">Celo</span>
          </h1>
          <p className="landing-hero-subtitle">
            Open-source SDK for building governed, verifiable, multi-agent systems with x402 payments,
            on-chain reputation, and spend policies.
          </p>
          <div className="landing-hero-ctas">
            <a
              href="https://github.com/calebcauthon/agent-kit"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-btn landing-btn-outline"
            >
              View on GitHub
            </a>
            <Link href="/dashboard" className="landing-btn landing-btn-primary">
              Try Demo
            </Link>
          </div>
          <div className="landing-terminal">
            <div className="landing-terminal-dots">
              <span /><span /><span />
            </div>
            <code>$ npm install @calebux/agent-kit</code>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
      <section className="landing-section">
        <div className="landing-container">
          <h2 className="landing-section-title">What&apos;s inside</h2>
          <p className="landing-section-subtitle">
            Everything you need to build trustworthy AI agents on Celo.
          </p>
          <div className="landing-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="landing-card">
                <span className="landing-card-icon">{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use Cases ────────────────────────────────────────────── */}
      <section className="landing-section landing-section-alt">
        <div className="landing-container">
          <h2 className="landing-section-title">What builders can do</h2>
          <p className="landing-section-subtitle">
            Compose agents into governed pipelines for real-world use cases.
          </p>
          <div className="landing-grid">
            {USE_CASES.map((u) => (
              <div key={u.title} className="landing-card">
                <h3>{u.title}</h3>
                <p>{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MCP Integration ──────────────────────────────────────── */}
      <section className="landing-section">
        <div className="landing-container">
          <h2 className="landing-section-title">MCP Integration</h2>
          <p className="landing-section-subtitle">
            Let LLMs discover and call Cal-AgentKit agents as native tools via Model Context Protocol.
          </p>
          <div className="landing-mcp-layout">
            <div className="landing-mcp-tools">
              {[
                { name: "discover_agents", desc: "List all registered agents with capabilities and payment info" },
                { name: "get_agent_manifest", desc: "Fetch full manifest for a specific agent by ID" },
                { name: "run_agent_task", desc: "Execute a task on any agent and get a verifiable receipt" },
                { name: "call_external_agent", desc: "Route tasks to agents on other Cal-AgentKit instances" },
                { name: "get_run_receipt", desc: "Retrieve a receipt by run ID with full hash chain" },
                { name: "verify_run_receipt", desc: "Cryptographically verify a receipt's integrity" },
                { name: "get_task_status", desc: "Check pipeline progress and agent statuses" },
                { name: "calagent_agents_endpoint", desc: "Raw HTTP access to the agent discovery endpoint" },
              ].map((tool) => (
                <div key={tool.name} className="landing-mcp-tool">
                  <code>{tool.name}</code>
                  <span>{tool.desc}</span>
                </div>
              ))}
            </div>
            <div className="landing-mcp-code">
              <div className="landing-terminal" style={{ maxWidth: "100%", margin: 0 }}>
                <div className="landing-terminal-dots">
                  <span /><span /><span />
                </div>
                <code>{`> Using run_agent_task
  agent: "celo-ledger"
  task: "Get latest Celo block"

✓ Agent returned result
  block: 28491023
  gasPrice: "5 gwei"

> Using verify_run_receipt
  runId: "a3f8...c912"

✓ Receipt verified
  taskHash: "sha256:e4b2..."
  outputHash: "sha256:9c1f..."
  signature: valid`}</code>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Section ──────────────────────────────────────────── */}
      <section className="landing-cta-section">
        <div className="landing-container" style={{ textAlign: "center" }}>
          <div className="landing-terminal" style={{ maxWidth: 480, margin: "0 auto 2rem" }}>
            <div className="landing-terminal-dots">
              <span /><span /><span />
            </div>
            <code>$ npm install @calebux/agent-kit</code>
          </div>
          <Link href="/dashboard" className="landing-btn landing-btn-dark">
            Try the live demo
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-grid">
            <div className="landing-footer-brand">
              <span className="landing-logo">CAL-AGENTKIT</span>
              <p>Open-source agent infrastructure for Celo.</p>
            </div>
            {Object.entries(FOOTER_LINKS).map(([title, links]) => (
              <div key={title} className="landing-footer-col">
                <h4>{title}</h4>
                {links.map((l) =>
                  l.href.startsWith("/") ? (
                    <Link key={l.label} href={l.href}>{l.label}</Link>
                  ) : (
                    <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">
                      {l.label}
                    </a>
                  )
                )}
              </div>
            ))}
          </div>
          <div className="landing-footer-bottom">
            <span>Built for the Prezenti Frontier Grant</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
