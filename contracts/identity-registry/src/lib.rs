//! Identity Registry Contract
//!
//! Tracks on-chain identities and reputation scores for Cal-AgentKit sub-agents.
//! The orchestrator (admin) registers agents; reputation is updated after
//! every completed or failed task.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Env, String, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    /// No agent exists for the given agent_id
    AgentNotFound = 1,
    /// Caller is not the contract admin
    NotAdmin = 2,
    /// An agent with this agent_id is already registered
    AlreadyRegistered = 3,
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// The role / capability an agent was registered with.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Capability {
    Scout,
    Ledger,
    Signal,
    Scribe,
    Executor,
}

/// Full on-chain identity record for a single agent.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentIdentity {
    /// Unique agent identifier (matches the key used to register)
    pub agent_id: Symbol,
    /// Human-readable name
    pub name: String,
    /// Role / capability
    pub capability: Capability,
    /// Reputation score, starts at 0; floor is 0
    pub reputation_score: u32,
    /// Total tasks recorded as successful
    pub tasks_completed: u32,
    /// Total tasks recorded as failed
    pub tasks_failed: u32,
    /// Ledger timestamp at registration time
    pub registered_at: u64,
}

/// Storage keys used by the contract.
#[contracttype]
pub enum DataKey {
    /// Per-agent identity record, keyed by agent_id Symbol
    Agent(Symbol),
    /// Ordered list of all registered agent_id Symbols (for list_agents)
    AgentList,
    /// Canonical SHA-256 manifest hash for the agent manifest JSON.
    ManifestHash(Symbol),
    /// Contract administrator address
    Admin,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct IdentityRegistry;

#[contractimpl]
impl IdentityRegistry {
    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    /// Set the contract admin. Must be called once before any other function.
    pub fn initialize(env: Env, admin: soroban_sdk::Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        let empty: Vec<Symbol> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::AgentList, &empty);
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    fn require_admin(env: &Env) -> Result<(), Error> {
        let admin: soroban_sdk::Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotAdmin)?;
        admin.require_auth();
        Ok(())
    }

    fn load_agent(env: &Env, agent_id: &Symbol) -> Result<AgentIdentity, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(agent_id.clone()))
            .ok_or(Error::AgentNotFound)
    }

    fn save_agent(env: &Env, record: &AgentIdentity) {
        env.storage()
            .persistent()
            .set(&DataKey::Agent(record.agent_id.clone()), record);
    }

    // -----------------------------------------------------------------------
    // Registration (admin only)
    // -----------------------------------------------------------------------

    /// Register a new agent. Admin only; fails if `agent_id` is already taken.
    pub fn register_agent(
        env: Env,
        agent_id: Symbol,
        name: String,
        capability: Capability,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;

        if env
            .storage()
            .persistent()
            .has(&DataKey::Agent(agent_id.clone()))
        {
            return Err(Error::AlreadyRegistered);
        }

        let record = AgentIdentity {
            agent_id: agent_id.clone(),
            name,
            capability,
            reputation_score: 0,
            tasks_completed: 0,
            tasks_failed: 0,
            registered_at: env.ledger().timestamp(),
        };

        Self::save_agent(&env, &record);

        let mut list: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&DataKey::AgentList)
            .unwrap_or_else(|| Vec::new(&env));
        list.push_back(agent_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::AgentList, &list);

        env.events()
            .publish((symbol_short!("register"), agent_id), ());

        Ok(())
    }

    /// Store or update the canonical manifest hash for an agent. Admin only.
    pub fn set_manifest_hash(
        env: Env,
        agent_id: Symbol,
        manifest_hash: String,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;
        Self::load_agent(&env, &agent_id)?;

        env.storage()
            .persistent()
            .set(&DataKey::ManifestHash(agent_id.clone()), &manifest_hash);

        env.events()
            .publish((symbol_short!("manifest"), agent_id), manifest_hash);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Outcome recording
    // -----------------------------------------------------------------------

    /// Record a successful task: increments `tasks_completed` and adds 10 to
    /// `reputation_score`.
    pub fn record_success(env: Env, agent_id: Symbol) -> Result<(), Error> {
        let mut record = Self::load_agent(&env, &agent_id)?;

        record.tasks_completed = record.tasks_completed.saturating_add(1);
        record.reputation_score = record.reputation_score.saturating_add(10);

        Self::save_agent(&env, &record);

        env.events().publish(
            (symbol_short!("success"), agent_id),
            (record.tasks_completed, record.reputation_score),
        );

        Ok(())
    }

    /// Record a failed task: increments `tasks_failed` and subtracts 5 from
    /// `reputation_score` (floor at 0).
    pub fn record_failure(env: Env, agent_id: Symbol) -> Result<(), Error> {
        let mut record = Self::load_agent(&env, &agent_id)?;

        record.tasks_failed = record.tasks_failed.saturating_add(1);
        record.reputation_score = record.reputation_score.saturating_sub(5);

        Self::save_agent(&env, &record);

        env.events().publish(
            (symbol_short!("failure"), agent_id),
            (record.tasks_failed, record.reputation_score),
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Read-only queries
    // -----------------------------------------------------------------------

    /// Return the full identity record for an agent.
    pub fn get_agent(env: Env, agent_id: Symbol) -> Result<AgentIdentity, Error> {
        Self::load_agent(&env, &agent_id)
    }

    /// Return just the reputation score for an agent.
    pub fn get_reputation(env: Env, agent_id: Symbol) -> Result<u32, Error> {
        Ok(Self::load_agent(&env, &agent_id)?.reputation_score)
    }

    /// Return the canonical manifest hash for an agent when one has been set.
    pub fn get_manifest_hash(env: Env, agent_id: Symbol) -> Result<String, Error> {
        Self::load_agent(&env, &agent_id)?;
        env.storage()
            .persistent()
            .get(&DataKey::ManifestHash(agent_id))
            .ok_or(Error::AgentNotFound)
    }

    /// Return all registered agent IDs in registration order.
    pub fn list_agents(env: Env) -> Vec<Symbol> {
        env.storage()
            .persistent()
            .get(&DataKey::AgentList)
            .unwrap_or_else(|| Vec::new(&env))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String};

    // Returns (contract_id, admin_address) — caller builds its own client so
    // that the client lifetime is tied to the test's local `env` binding.
    fn setup_contract(env: &Env) -> (Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let admin = Address::generate(env);
        let client = IdentityRegistryClient::new(env, &contract_id);
        client.initialize(&admin);
        (contract_id, admin)
    }

    fn name(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    #[test]
    fn test_register_agent_success() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let id = Symbol::new(&env, "scout1");
        client.register_agent(&id, &name(&env, "Scout Agent 1"), &Capability::Scout);

        let record = client.get_agent(&id);
        assert_eq!(record.agent_id, id);
        assert_eq!(record.name, name(&env, "Scout Agent 1"));
        assert_eq!(record.capability, Capability::Scout);
        assert_eq!(record.reputation_score, 0);
        assert_eq!(record.tasks_completed, 0);
        assert_eq!(record.tasks_failed, 0);
    }

    #[test]
    fn test_register_sets_timestamp() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let ts_before = env.ledger().timestamp();
        let id = Symbol::new(&env, "scribe1");
        client.register_agent(&id, &name(&env, "Scribe One"), &Capability::Scribe);

        let record = client.get_agent(&id);
        assert!(record.registered_at >= ts_before);
    }

    #[test]
    fn test_register_all_capabilities() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        for (id_str, cap) in [
            ("scout1", Capability::Scout),
            ("ledger1", Capability::Ledger),
            ("signal1", Capability::Signal),
            ("scribe1", Capability::Scribe),
            ("exec1", Capability::Executor),
        ] {
            let id = Symbol::new(&env, id_str);
            client.register_agent(&id, &name(&env, id_str), &cap);
            assert_eq!(client.get_agent(&id).capability, cap);
        }
    }

    // -----------------------------------------------------------------------
    // Duplicate registration
    // -----------------------------------------------------------------------

    #[test]
    fn test_duplicate_registration_fails() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let id = Symbol::new(&env, "scout1");
        client.register_agent(&id, &name(&env, "Scout 1"), &Capability::Scout);

        let result = client.try_register_agent(&id, &name(&env, "Scout Dup"), &Capability::Scout);
        assert_eq!(result, Err(Ok(Error::AlreadyRegistered)));
    }

    #[test]
    fn test_set_and_get_manifest_hash() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let id = Symbol::new(&env, "ledger1");
        let hash = name(
            &env,
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        );
        client.register_agent(&id, &name(&env, "Ledger 1"), &Capability::Ledger);
        client.set_manifest_hash(&id, &hash);

        assert_eq!(client.get_manifest_hash(&id), hash);
    }

    // -----------------------------------------------------------------------
    // Admin guard
    // -----------------------------------------------------------------------

    #[test]
    fn test_not_admin_when_uninitialized() {
        // If initialize() was never called, no admin is stored.
        // require_admin() returns Err(Error::NotAdmin) via ok_or before ever
        // reaching require_auth(), so mock_all_auths is fine here.
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);

        let result = client.try_register_agent(
            &Symbol::new(&env, "scout1"),
            &name(&env, "Scout 1"),
            &Capability::Scout,
        );
        assert_eq!(result, Err(Ok(Error::NotAdmin)));
    }

    // -----------------------------------------------------------------------
    // record_success
    // -----------------------------------------------------------------------

    #[test]
    fn test_record_success_increments_score() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let id = Symbol::new(&env, "ledger1");
        client.register_agent(&id, &name(&env, "Ledger One"), &Capability::Ledger);
        client.record_success(&id);

        let record = client.get_agent(&id);
        assert_eq!(record.tasks_completed, 1);
        assert_eq!(record.tasks_failed, 0);
        assert_eq!(record.reputation_score, 10);
    }

    #[test]
    fn test_record_success_multiple_times() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let id = Symbol::new(&env, "signal1");
        client.register_agent(&id, &name(&env, "Signal One"), &Capability::Signal);

        for _ in 0..5 {
            client.record_success(&id);
        }

        assert_eq!(client.get_reputation(&id), 50);
        assert_eq!(client.get_agent(&id).tasks_completed, 5);
    }

    #[test]
    fn test_record_success_unknown_agent_fails() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let result = client.try_record_success(&Symbol::new(&env, "ghost"));
        assert_eq!(result, Err(Ok(Error::AgentNotFound)));
    }

    // -----------------------------------------------------------------------
    // record_failure
    // -----------------------------------------------------------------------

    #[test]
    fn test_record_failure_increments_and_subtracts() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let id = Symbol::new(&env, "scout1");
        client.register_agent(&id, &name(&env, "Scout One"), &Capability::Scout);

        client.record_success(&id); // +10 → 10
        client.record_failure(&id); // -5  → 5

        let record = client.get_agent(&id);
        assert_eq!(record.tasks_completed, 1);
        assert_eq!(record.tasks_failed, 1);
        assert_eq!(record.reputation_score, 5);
    }

    #[test]
    fn test_reputation_floor_at_zero() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let id = Symbol::new(&env, "scout1");
        client.register_agent(&id, &name(&env, "Scout One"), &Capability::Scout);

        // Score starts at 0 — repeated failures must not underflow
        client.record_failure(&id);
        client.record_failure(&id);
        client.record_failure(&id);

        assert_eq!(client.get_reputation(&id), 0);
        assert_eq!(client.get_agent(&id).tasks_failed, 3);
    }

    #[test]
    fn test_record_failure_unknown_agent_fails() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let result = client.try_record_failure(&Symbol::new(&env, "ghost"));
        assert_eq!(result, Err(Ok(Error::AgentNotFound)));
    }

    // -----------------------------------------------------------------------
    // get_agent / get_reputation
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_agent_not_found() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let result = client.try_get_agent(&Symbol::new(&env, "nobody"));
        assert_eq!(result, Err(Ok(Error::AgentNotFound)));
    }

    #[test]
    fn test_get_reputation_not_found() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let result = client.try_get_reputation(&Symbol::new(&env, "nobody"));
        assert_eq!(result, Err(Ok(Error::AgentNotFound)));
    }

    // -----------------------------------------------------------------------
    // list_agents
    // -----------------------------------------------------------------------

    #[test]
    fn test_list_agents_empty_on_fresh_contract() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        // Register nothing — list should be empty
        let list = client.list_agents();
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_list_agents_returns_all_ids() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let ids = [
            Symbol::new(&env, "scout1"),
            Symbol::new(&env, "ledger1"),
            Symbol::new(&env, "signal1"),
        ];

        for id in &ids {
            client.register_agent(id, &name(&env, "agent"), &Capability::Scout);
        }

        let list = client.list_agents();
        assert_eq!(list.len(), 3);
        for id in &ids {
            assert!(list.contains(id));
        }
    }

    #[test]
    fn test_list_agents_order_preserved() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let a = Symbol::new(&env, "aaa");
        let b = Symbol::new(&env, "bbb");
        let c = Symbol::new(&env, "ccc");

        for id in [&a, &b, &c] {
            client.register_agent(id, &name(&env, "x"), &Capability::Scribe);
        }

        let list = client.list_agents();
        assert_eq!(list.get(0).unwrap(), a);
        assert_eq!(list.get(1).unwrap(), b);
        assert_eq!(list.get(2).unwrap(), c);
    }

    // -----------------------------------------------------------------------
    // Full lifecycle
    // -----------------------------------------------------------------------

    #[test]
    fn test_full_lifecycle() {
        let env = Env::default();
        let (cid, _) = setup_contract(&env);
        let client = IdentityRegistryClient::new(&env, &cid);

        let id = Symbol::new(&env, "signal1");
        client.register_agent(&id, &name(&env, "Signal Agent"), &Capability::Signal);

        // 3 successes (+30), 1 failure (-5) → 25
        client.record_success(&id);
        client.record_success(&id);
        client.record_success(&id);
        client.record_failure(&id);

        let record = client.get_agent(&id);
        assert_eq!(record.tasks_completed, 3);
        assert_eq!(record.tasks_failed, 1);
        assert_eq!(record.reputation_score, 25);
        assert_eq!(client.get_reputation(&id), 25);

        let list = client.list_agents();
        assert_eq!(list.len(), 1);
        assert_eq!(list.get(0).unwrap(), id);
    }
}
