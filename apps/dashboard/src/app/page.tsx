import Link from "next/link";
import CopyTerminal from "./CopyTerminal";

const FEATURES = [
  {
    title: "x402 Payments",
    desc: "Agents pay each other in USDm using the x402 protocol. Every transaction is verifiable on-chain.",
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
  {
    title: "Pluggable LLM",
    desc: "Swap the underlying model via OpenRouter. Use Claude, Llama, Mistral, or 200+ models with one API key.",
    icon: "\u2699",
  },
  {
    title: "ERC-8004 Compliant",
    desc: "Bridge adapter registers agents on canonical ERC-8004 Identity and Reputation registries with NFT-based identity.",
    icon: "\u29C9",
  },
  {
    title: "Self Protocol Identity",
    desc: "Sybil-resistant agent verification via Self Protocol. Gate agent runs behind human-verified wallet identity.",
    icon: "\u2694",
  },
  {
    title: "Agent Staking",
    desc: "Stake USDm as collateral for agent behavior. Admin can slash misbehaving agents or reward good actors.",
    icon: "\u26D3",
  },
  {
    title: "Consensus Voting",
    desc: "On-chain voting rounds for multi-agent consensus. Agents submit output hashes and the majority wins.",
    icon: "\u2696",
  },
  {
    title: "Task Escrow",
    desc: "Deposit USDm into escrow for agent tasks. Funds release on verified receipt or refund after deadline.",
    icon: "\u2747",
  },
  {
    title: "Agent Delegation",
    desc: "Parent agents delegate tasks to child agents with linked receipt chains and inherited spend budgets.",
    icon: "\u21B3",
  },
  {
    title: "Trust Scores",
    desc: "Composite 0\u20131000 trust scores from on-chain reputation, staking, task completion, and escrow history.",
    icon: "\u2261",
  },
  {
    title: "Agent Credentials",
    desc: "Scoped, time-limited on-chain credentials gate which services an agent can access. Grant, revoke, verify.",
    icon: "\u229A",
  },
  {
    title: "Capability Routing",
    desc: "Agent DNS: discover agents by capability across local and federated peers, ranked by trust score.",
    icon: "\u2B95",
  },
  {
    title: "Approval Gateway",
    desc: "Human-in-the-loop approval for high-value operations. Configurable thresholds enforce oversight before spend.",
    icon: "\u270B",
  },
  {
    title: "Agent Memory",
    desc: "Persistent knowledge graph memory via gBrain. Agents search past runs, store learned patterns, and build context over time.",
    icon: "\u29BB",
  },
  {
    title: "Hermes Agent",
    desc: "Nous Research's autonomous agent with skill-learning loop. Grows more capable with every task \u2014 plugs directly into pipelines.",
    icon: "\u26A1",
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
    title: "Cross-Chain Interoperability",
    desc: "Route tasks across Celo, Stellar, and Base via selectChain() and PeerRegistry. Unified receipts and reputation travel with agents.",
  },
  {
    title: "ERC-8004 Agent Registry",
    desc: "Register agents as ERC-8004 NFTs on the canonical Celo registry. Sync reputation and metadata via the bridge adapter.",
  },
  {
    title: "Sybil-Resistant Agents",
    desc: "Verify agent wallets via Self Protocol. Enforce human-verified identity before agents can execute tasks.",
  },
  {
    title: "Staked Agent Collateral",
    desc: "Require agents to stake USDm as skin-in-the-game. Slash stakes for misbehavior, reward for reliability.",
  },
  {
    title: "On-Chain Consensus",
    desc: "Record multi-agent consensus votes on-chain. Each agent submits its output hash — majority result is finalized immutably.",
  },
  {
    title: "Task Escrow",
    desc: "Hold USDm in escrow for agent tasks. Release on verified receipt or auto-refund after deadline — trustless task payment.",
  },
  {
    title: "Agent Delegation",
    desc: "Compose agent hierarchies. Parent agents delegate tasks to specialists with linked receipt chains for full traceability.",
  },
  {
    title: "Trust-Scored Routing",
    desc: "Query agents by capability and get back trust-ranked results. Routes to the highest-scored agent automatically.",
  },
  {
    title: "Credentialed Services",
    desc: "Grant agents scoped credentials for DeFi, oracles, or LLM services. Credentials expire and can be revoked on-chain.",
  },
  {
    title: "Human Approval Workflows",
    desc: "High-value agent operations pause for human approval. Configurable thresholds per agent, with pending/approved/denied lifecycle.",
  },
  {
    title: "Federated Agent Discovery",
    desc: "Discover agents across multiple Cal-AgentKit instances. Capability routing + trust scores enable secure cross-org agent collaboration.",
  },
  {
    title: "Memory-Augmented Research",
    desc: "Agents recall past research before starting new tasks. Each run is informed by everything that came before.",
  },
  {
    title: "Hermes Skill Learning",
    desc: "Hermes agents write reusable skills after completing tasks. Plug them into Cal-AgentKit pipelines for compounding capability.",
  },
];

const FOOTER_LINKS = {
  Product: [
    { label: "Aegis-Ultra API", href: "/dashboard" },
    { label: "Agent Registry", href: "/agents" },
    { label: "Aegis vs Fugu", href: "/compare" },
    { label: "Receipts", href: "/receipts" },
  ],
  Developers: [
    { label: "GitHub", href: "https://github.com/Calebux/CAL-AGENTKIT" },
    { label: "npm", href: "https://www.npmjs.com/package/@calebux/agent-kit" },
    { label: "Documentation", href: "https://github.com/Calebux/CAL-AGENTKIT#readme" },
  ],
  Ecosystem: [
    { label: "Celo", href: "https://celo.org" },
    { label: "Stellar", href: "https://stellar.org" },
    { label: "x402 Protocol", href: "https://www.x402.org" },
  ],
};

export default function LandingPage() {
  return (
    <div className="landing">
      {/* ── Nav ──────────────────────────────────────────────────── */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo"><img src="/logo.svg" alt="Cal-AgentKit" className="landing-logo-img" />CAL-AGENTKIT</span>
          <div className="landing-nav-links">
            <a href="https://github.com/Calebux/CAL-AGENTKIT" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href="https://www.npmjs.com/package/@calebux/agent-kit" target="_blank" rel="noopener noreferrer">
              npm
            </a>
            <Link href="/agents">Agents</Link>
            <Link href="/compare">Aegis vs Fugu</Link>
            <Link href="/dashboard" className="landing-nav-cta">
              Try Aegis-Ultra
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="landing-hero">
        <div className="landing-container">
          <p className="landing-hero-eyebrow">OPEN-SOURCE · VERIFIABLE · PAY-PER-PROMPT</p>
          <h1 className="landing-hero-title">
            The orchestration model you can verify
          </h1>
          <p className="landing-hero-subtitle">
            Aegis-Ultra routes your prompt to a team of specialized agents, powered by
            <span className="landing-celo-yellow"> DeepSeek</span> via OpenRouter.
            Every response is cryptographically receipted on <span className="landing-celo-yellow">Celo</span>.
            No subscriptions. No API keys. Just pay <strong>0.05 cUSD per prompt</strong> via x402.
          </p>
          <div className="landing-hero-ctas">
            <Link href="/compare" className="landing-btn landing-btn-outline">
              See How We Compare
            </Link>
            <Link href="/dashboard" className="landing-btn landing-btn-primary">
              Try Aegis-Ultra
            </Link>
          </div>
          <CopyTerminal command="npm install @calebux/agent-kit" />
        </div>
      </section>

      {/* ── How It Works ──────────────────────────────────────── */}
      <section className="landing-section landing-section-alt">
        <div className="landing-container">
          <h2 className="landing-section-title">How Aegis-Ultra Works</h2>
          <p className="landing-section-subtitle">
            One API call. A team of agents. Verifiable results.
          </p>
          <div className="landing-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {[
              { step: "1", title: "You Send a Prompt", desc: "Standard OpenAI-compatible API. POST to /v1/chat/completions with model: aegis-ultra." },
              { step: "2", title: "x402 Payment", desc: "The endpoint returns 402 Payment Required. AegisClient auto-pays 0.05 cUSD on Celo and retries." },
              { step: "3", title: "Reactive Orchestration", desc: "Scout gathers data, Ledger reads on-chain metrics, Signal identifies patterns. Each step adapts to what the last one found." },
              { step: "4", title: "Verified Response", desc: "Scribe synthesizes everything. You get the answer + a cryptographic receipt hash + the on-chain attestation tx." },
            ].map((s) => (
              <div key={s.step} className="landing-card landing-card--dark">
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FCFF52', display: 'block', marginBottom: '0.5rem' }}>{s.step}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Infrastructure Layers ─────────────────────────────── */}
      <section className="landing-section">
        <div className="landing-container">
          <h2 className="landing-section-title">Powered by Eight Infrastructure Layers</h2>
          <p className="landing-section-subtitle">
            The open-source economic stack behind the orchestration model.
          </p>
          <div className="landing-grid">
            {[
              { layer: "Identity", desc: "On-chain agent registration, manifest hashes, ERC-8004 NFTs, Self Protocol verification" },
              { layer: "Reputation", desc: "Live trust scores from task completion, staking, and consensus — updated after every run" },
              { layer: "Payments", desc: "x402 micropayments, agent-to-agent cUSD transfers, multi-chain settlement" },
              { layer: "Governance", desc: "Spend caps, session policies, human approval gates, scoped credentials" },
              { layer: "Discovery", desc: "Capability-based routing, federated peer registry, trust-ranked agent DNS" },
              { layer: "Coordination", desc: "Reactive orchestration, delegation with linked receipts, consensus voting" },
              { layer: "Memory", desc: "Persistent knowledge graph via gBrain. Agents recall past runs and build compounding context" },
              { layer: "Audit", desc: "SHA-256 hashed receipts, Ed25519 signatures, on-chain attestation, escrow with conditional release" },
            ].map((l) => (
              <div key={l.layer} className="landing-card landing-card--dark">
                <h3>{l.layer}</h3>
                <p>{l.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Aegis-Ultra API ─────────────────────────────────────── */}
      <section className="landing-section landing-section-alt">
        <div className="landing-container">
          <h2 className="landing-section-title">Aegis-Ultra API</h2>
          <p className="landing-section-subtitle">
            Don't pay $20/month for a monolithic, black-box subscription. 
            Use our drop-in orchestration model and pay exactly <strong>0.05 USDm per prompt</strong>.
          </p>
          <div className="landing-mcp-layout" style={{ marginTop: '2rem' }}>
            <div className="landing-mcp-tools">
              <div className="landing-mcp-tool" style={{ borderColor: 'var(--celo-yellow)' }}>
                <h3 style={{ color: 'var(--celo-yellow)', marginBottom: '0.5rem' }}>Collective Intelligence</h3>
                <p>One API call routes to a team of specialized agents (Scout, Ledger, Signal, Scribe). We use fast models for gathering and frontier models for synthesis.</p>
              </div>
              <div className="landing-mcp-tool">
                <h3 style={{ marginBottom: '0.5rem' }}>Native x402 Micropayments</h3>
                <p>No API keys or monthly subscriptions needed. The endpoint is entirely permissionless. Your wallet pays the agents directly via the x402 protocol.</p>
              </div>
              <div className="landing-mcp-tool">
                <h3 style={{ marginBottom: '0.5rem' }}>Cryptographic Verifiability</h3>
                <p>Every response includes an <code>L402</code> receipt and an on-chain attestation hash. You can prove exactly how your answer was derived.</p>
              </div>
            </div>
            <div className="landing-mcp-code">
              <div className="landing-terminal" style={{ maxWidth: "100%", margin: 0 }}>
                <div className="landing-terminal-dots">
                  <span /><span /><span />
                </div>
                <code>{`import { AegisClient } from "@calebux/agent-kit";

// AegisClient catches the 402 challenge,
// pays the cUSD invoice on Celo, and retries.
const client = new AegisClient({
  celoPrivateKey: process.env.CELO_PRIVATE_KEY
});

const response = await client.chat.completions.create({
  model: "aegis-ultra",
  messages: [{ role: "user", content: "Analyze the Celo market" }]
});

console.log(response.choices[0].message.content);
// response.receiptHash — on-chain verification
// response.txHash — cUSD payment tx hash
`}</code>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
      <section className="landing-section">
        <div className="landing-container">
          <h2 className="landing-section-title">What&apos;s inside</h2>
          <p className="landing-section-subtitle">
            The building blocks behind each layer.
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

      {/* ── CTA Section ──────────────────────────────────────── */}
      <section className="landing-cta-section">
        <div className="landing-container" style={{ textAlign: "center" }}>
          <h2 style={{ color: '#fff', fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.75rem' }}>
            Stop paying for black boxes.
          </h2>
          <p style={{ color: '#8b949e', marginBottom: '2rem', maxWidth: 500, margin: '0 auto 2rem' }}>
            Verify every output. Control your model pool. Pay per prompt, not per month.
          </p>
          <CopyTerminal command="npm install @calebux/agent-kit" />
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.5rem' }}>
            <Link href="/compare" className="landing-btn landing-btn-outline">
              See the Comparison
            </Link>
            <Link href="/dashboard" className="landing-btn landing-btn-dark">
              Try Aegis-Ultra
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-grid">
            <div className="landing-footer-brand">
              <span className="landing-logo">CAL-AGENTKIT</span>
              <p>Infrastructure for autonomous agent economies.</p>
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
            <span>Open-source infrastructure for autonomous agent economies</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
