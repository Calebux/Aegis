import Link from "next/link";

export const metadata = {
  title: "Aegis vs Fugu — Why Verifiable Orchestration Wins",
  description:
    "A technical comparison between Cal-AgentKit's Aegis-Ultra and Sakana AI's Fugu orchestration model. Open vs closed, reactive vs static, transparent vs opaque.",
};

const COMPARISON_ROWS = [
  {
    dimension: "Architecture",
    aegis: "Reactive orchestrator — plans at t+1 using results from t. Each agent step informs the next.",
    fugu: "Static planner — predicts entire workflow at t=0 before any agent runs. Capped at 5 steps.",
    verdict: "aegis",
  },
  {
    dimension: "Model Pool",
    aegis: "Open pool via OpenRouter. Swap DeepSeek, Llama, Mistral, Claude, or 200+ models. No retraining needed.",
    fugu: "Closed pool of undisclosed models. Adding a new LLM requires retraining the classifier.",
    verdict: "aegis",
  },
  {
    dimension: "Cost Transparency",
    aegis: "Every response includes x-calagent-cost-stroops header. Per-agent spend is on-chain and auditable.",
    fugu: "Never reports output tokens or cost in any benchmark or API response.",
    verdict: "aegis",
  },
  {
    dimension: "Verifiability",
    aegis: "SHA-256 receipt hashes, Ed25519 signatures, on-chain attestation via AegisCeloRegistry.",
    fugu: "Black box. No receipts, no audit trail, no way to verify which models were used.",
    verdict: "aegis",
  },
  {
    dimension: "Payment Model",
    aegis: "Pay-per-prompt via native x402 micropayments. No subscription. No API keys required.",
    fugu: "Closed API access. Pricing undisclosed at launch.",
    verdict: "aegis",
  },
  {
    dimension: "Source Code",
    aegis: "Fully open-source. npm install @calebux/agent-kit. Inspect every line.",
    fugu: "Closed source. The orchestrator, router, and classifier are proprietary.",
    verdict: "aegis",
  },
  {
    dimension: "Sovereignty",
    aegis: "Self-hosted. You control which models run, which chains settle, which agents participate.",
    fugu: "Sakana controls the model pool, routing, and access. Export controls can shut it down overnight.",
    verdict: "aegis",
  },
  {
    dimension: "Benchmark Rigor",
    aegis: "Reports cost per task, agent-level breakdowns, and on-chain tx hashes for every run.",
    fugu: 'Compares against unnamed "Model A, B, C" in AutoResearch. Wrong Fable 5 score on TerminalBench.',
    verdict: "aegis",
  },
];

export default function ComparePage() {
  return (
    <div className="landing">
      {/* Nav */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <Link href="/" className="landing-logo">
            <img
              src="/logo.svg"
              alt="Cal-AgentKit"
              className="landing-logo-img"
            />
            CAL-AGENTKIT
          </Link>
          <div className="landing-nav-links">
            <Link href="/">Home</Link>
            <Link href="/agents">Agents</Link>
            <Link href="/dashboard" className="landing-nav-cta">
              Try Demo
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero" style={{ padding: "4rem 2rem 3rem" }}>
        <div className="landing-container">
          <h1 className="landing-hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Aegis-Ultra vs Fugu
          </h1>
          <p className="landing-hero-subtitle" style={{ maxWidth: 720 }}>
            Sakana AI calls Fugu &ldquo;AI sovereignty.&rdquo; But it&rsquo;s a closed-source
            orchestrator on top of closed-source models. If before you didn&rsquo;t control the
            models, now you don&rsquo;t even control which ones are used or how much it costs.
          </p>
        </div>
      </section>

      {/* Core Argument */}
      <section className="landing-section" style={{ padding: "3rem 2rem" }}>
        <div className="landing-container" style={{ maxWidth: 900 }}>
          <h2 className="landing-section-title">The Technical Reality</h2>

          <div className="compare-cards">
            <div className="compare-card compare-card--problem">
              <h3>Fugu Base: A Router</h3>
              <p>
                Fugu base is a classifier that selects which model is most likely to answer
                correctly at each turn. It scores <strong>−10 points on SWE-Bench</strong> compared
                to Opus alone. Marginal gains on other benchmarks, but no cost data is ever
                reported — suggesting it&rsquo;s likely more expensive, not less.
              </p>
            </div>

            <div className="compare-card compare-card--problem">
              <h3>Fugu Ultra: A Static Planner</h3>
              <p>
                Fugu Ultra outputs a fixed plan with up to 5 &ldquo;workflows&rdquo; before any
                agent starts working. It predicts everything at t=0. But real-world tasks require
                <strong> adaptive planning</strong> — deciding what to spawn at t+1 based on what
                you learned at t. A 5-step ceiling is arbitrary and brittle.
              </p>
            </div>

            <div className="compare-card compare-card--solution">
              <h3>Aegis-Ultra: Reactive Orchestration</h3>
              <p>
                Cal-AgentKit&rsquo;s orchestrator runs Scout first, evaluates results, then decides
                what Ledger, Signal, and Scribe do next. Every step adapts to what was actually
                found. No arbitrary step limits. No static plans. Every decision is informed by
                real data, not predictions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="landing-section landing-section-alt" style={{ padding: "3rem 2rem" }}>
        <div className="landing-container" style={{ maxWidth: 1000 }}>
          <h2 className="landing-section-title">Side-by-Side Comparison</h2>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th></th>
                  <th className="compare-th--aegis">Aegis-Ultra</th>
                  <th className="compare-th--fugu">Fugu</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.dimension}>
                    <td className="compare-dimension">{row.dimension}</td>
                    <td className="compare-cell compare-cell--aegis">{row.aegis}</td>
                    <td className="compare-cell compare-cell--fugu">{row.fugu}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* The Missing Benchmark */}
      <section className="landing-section" style={{ padding: "3rem 2rem" }}>
        <div className="landing-container" style={{ maxWidth: 900 }}>
          <h2 className="landing-section-title">The Benchmark They Won&rsquo;t Run</h2>
          <p className="landing-section-subtitle" style={{ marginBottom: "2rem" }}>
            Fugu introduces test-time scaling with &ldquo;best of N&rdquo; over models but
            <strong> never reports the number of output tokens or cost</strong> to achieve any
            benchmark score. The fair comparison isn&rsquo;t Fugu vs bare Opus — it&rsquo;s
            Fugu vs Opus with workflows enabled, or Kimi with Swarm mode. That comparison
            is conspicuously absent.
          </p>
          <div className="compare-cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="compare-card">
              <h3>What Aegis Reports</h3>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.75rem", lineHeight: 2 }}>
                <li>Cost per prompt in cUSD (on-chain)</li>
                <li>Per-agent execution breakdown</li>
                <li>Which model powered each agent</li>
                <li>Cryptographic receipt with tx hash</li>
                <li>Trust scores and reputation deltas</li>
              </ul>
            </div>
            <div className="compare-card">
              <h3>What Fugu Reports</h3>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.75rem", lineHeight: 2 }}>
                <li>Final answer text</li>
                <li style={{ color: "#888" }}>Cost: not disclosed</li>
                <li style={{ color: "#888" }}>Output tokens: not disclosed</li>
                <li style={{ color: "#888" }}>Models used: not disclosed</li>
                <li style={{ color: "#888" }}>Verification: none</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="landing-cta-section" style={{ padding: "3rem 2rem" }}>
        <div className="landing-container" style={{ textAlign: "center" }}>
          <h2 style={{ color: "#fff", fontSize: "1.5rem", marginBottom: "1rem", fontWeight: 700 }}>
            Real sovereignty is open source.
          </h2>
          <p style={{ color: "#8b949e", marginBottom: "2rem", maxWidth: 500, margin: "0 auto 2rem" }}>
            Don&rsquo;t trust a closed-source orchestrator to pick your models.
            Run your own agents, verify every output, and pay per prompt — not per month.
          </p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <a
              href="https://github.com/Calebux/CAL-AGENTKIT"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-btn landing-btn-outline"
            >
              View Source
            </a>
            <Link href="/dashboard" className="landing-btn landing-btn-dark">
              Try Aegis-Ultra
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-bottom">
            <span>Open-source infrastructure for autonomous agent economies</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
