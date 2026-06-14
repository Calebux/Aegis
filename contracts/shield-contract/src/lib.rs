//! Shield Contract
//!
//! Cal-AgentKit's core spend-policy enforcer. Maintains a registry of sub-agents,
//! each with an XLM spend cap per session. The orchestrator (admin) registers
//! agents, authorises individual spends, and resets or deactivates agents as
//! needed. All state-mutating operations are admin-gated; reads are open.
//!
//! Error model follows Soroban / SEP-41 conventions: auth failures are raised
//! via `require_auth()` (WASM host trap); logical errors are returned as typed
//! `ShieldError` values so callers can inspect them programmatically.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, Env, String, Symbol,
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ShieldError {
    /// The contract has already been initialised.
    AlreadyInitialized = 1,
    /// Caller is not the contract admin (supplementary; primary guard is
    /// `require_auth()` which traps before this can be returned).
    NotAdmin = 2,
    /// No agent with the given `agent_id` exists in the registry.
    AgentNotFound = 3,
    /// The requested spend would exceed the agent's current cap.
    CapExceeded = 4,
    /// The agent has been deactivated and cannot authorise new spend.
    AgentInactive = 5,
}

// ---------------------------------------------------------------------------
// Storage key types
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    /// Contract admin / orchestrator address.
    Admin,
    /// Full agent record, keyed by `agent_id`.
    Agent(String),
    /// Agent output signature record, keyed by "{agent_id}:{run_id}".
    Signature(String),
}

// ---------------------------------------------------------------------------
// Signature record (Upgrade 7 — Verifiable Agent Signatures)
// ---------------------------------------------------------------------------

/// On-chain record of a signed agent output.
/// Stores the hex signature + SHA-256 payload hash so any verifier can
/// confirm that a specific agent produced a specific output for a given run.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SignatureRecord {
    /// Hex-encoded Stellar keypair signature over the canonical message.
    pub signature: String,
    /// SHA-256 hex hash of the serialised payload (canonical key order).
    pub payload_hash: String,
    /// Ledger timestamp at time of storage.
    pub timestamp: u64,
}

// ---------------------------------------------------------------------------
// Agent record
// ---------------------------------------------------------------------------

/// On-chain record for a registered sub-agent.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentRecord {
    /// Unique logical identifier (e.g. `"scout-1"`).
    pub agent_id: String,
    /// The agent's Stellar wallet address.
    pub wallet_address: Address,
    /// Maximum XLM (in stroops) the agent may spend per session.
    pub spend_cap: i128,
    /// Running total of stroops spent in the current session.
    pub total_spent: i128,
    /// Whether the agent is currently active.
    pub is_active: bool,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ShieldContract;

#[contractimpl]
impl ShieldContract {
    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    /// Initialise the contract, designating `admin` as the sole authority.
    /// Can only be called once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ShieldError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ShieldError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Retrieve the stored admin address and assert the caller holds its auth.
    /// Panics with a host auth trap if the caller is not the admin.
    fn require_admin(env: &Env) -> Address {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        admin.require_auth();
        admin
    }

    /// Load an `AgentRecord` by `agent_id`, returning `AgentNotFound` if
    /// absent.
    fn load_agent(env: &Env, agent_id: &String) -> Result<AgentRecord, ShieldError> {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(agent_id.clone()))
            .ok_or(ShieldError::AgentNotFound)
    }

    /// Persist an `AgentRecord`.
    fn save_agent(env: &Env, record: &AgentRecord) {
        env.storage()
            .persistent()
            .set(&DataKey::Agent(record.agent_id.clone()), record);
    }

    // -----------------------------------------------------------------------
    // Admin: agent registry management
    // -----------------------------------------------------------------------

    /// Register a new sub-agent. Admin only.
    ///
    /// * `agent_id`       — unique logical identifier string
    /// * `wallet_address` — the agent's Stellar wallet address
    /// * `spend_cap`      — maximum stroops the agent may spend per session
    pub fn register_agent(
        env: Env,
        agent_id: String,
        wallet_address: Address,
        spend_cap: i128,
    ) -> Result<(), ShieldError> {
        Self::require_admin(&env);

        let record = AgentRecord {
            agent_id: agent_id.clone(),
            wallet_address,
            spend_cap,
            total_spent: 0,
            is_active: true,
        };
        Self::save_agent(&env, &record);

        env.events().publish(
            (Symbol::new(&env, "agent_registered"), agent_id),
            (record.spend_cap,),
        );

        Ok(())
    }

    /// Reset `total_spent` to zero for a new session. Admin only.
    pub fn reset_agent(env: Env, agent_id: String) -> Result<(), ShieldError> {
        Self::require_admin(&env);

        let mut record = Self::load_agent(&env, &agent_id)?;
        record.total_spent = 0;
        Self::save_agent(&env, &record);

        env.events().publish(
            (Symbol::new(&env, "agent_reset"), agent_id),
            (),
        );

        Ok(())
    }

    /// Deactivate an agent, preventing future spend authorisations. Admin only.
    pub fn deactivate_agent(env: Env, agent_id: String) -> Result<(), ShieldError> {
        Self::require_admin(&env);

        let mut record = Self::load_agent(&env, &agent_id)?;
        record.is_active = false;
        Self::save_agent(&env, &record);

        env.events().publish(
            (Symbol::new(&env, "agent_deactivated"), agent_id),
            (),
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Spend authorisation
    // -----------------------------------------------------------------------

    /// Attempt to authorise a spend of `amount` stroops for the given agent.
    /// Admin only (orchestrator gates all payments).
    ///
    /// Returns `true` on success; returns a typed error if:
    /// - the agent does not exist (`AgentNotFound`)
    /// - the agent is inactive (`AgentInactive`)
    /// - the spend would exceed the cap (`CapExceeded`)
    pub fn authorize_spend(
        env: Env,
        agent_id: String,
        amount: i128,
    ) -> Result<bool, ShieldError> {
        Self::require_admin(&env);

        let mut record = Self::load_agent(&env, &agent_id)?;

        if !record.is_active {
            return Err(ShieldError::AgentInactive);
        }

        if record.total_spent + amount > record.spend_cap {
            return Err(ShieldError::CapExceeded);
        }

        record.total_spent += amount;
        Self::save_agent(&env, &record);

        env.events().publish(
            (Symbol::new(&env, "spend_authorized"), agent_id),
            (amount, record.total_spent, record.spend_cap),
        );

        Ok(true)
    }

    // -----------------------------------------------------------------------
    // Read-only helpers
    // -----------------------------------------------------------------------

    /// Return the full `AgentRecord` for the given agent. Open to all callers.
    pub fn get_agent(env: Env, agent_id: String) -> Result<AgentRecord, ShieldError> {
        Self::load_agent(&env, &agent_id)
    }

    // -----------------------------------------------------------------------
    // Verifiable signatures (Upgrade 7)
    // -----------------------------------------------------------------------

    /// Store a cryptographic signature for a specific agent output.
    ///
    /// Called by the agent (or the orchestrator on its behalf) immediately
    /// after the agent publishes to the event bus. Admin-gated.
    ///
    /// * `agent_id`    — e.g. "scout", "signal"
    /// * `run_id`      — UUID of the pipeline run
    /// * `signature`   — hex-encoded Stellar keypair signature
    /// * `payload_hash`— SHA-256 hex hash of the canonical payload JSON
    /// Store a signature. `sig_key` must be "{agent_id}:{run_id}" — callers
    /// are responsible for building this key. Using a single String avoids
    /// tuple-variant XDR encoding issues. Admin-gated.
    pub fn store_signature(
        env: Env,
        sig_key: String,
        signature: String,
        payload_hash: String,
    ) {
        Self::require_admin(&env);
        let key = DataKey::Signature(sig_key.clone());
        let record = SignatureRecord {
            signature,
            payload_hash,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&key, &record);

        env.events().publish(
            (Symbol::new(&env, "sig_stored"),),
            (sig_key,),
        );
    }

    /// Retrieve a stored signature. `sig_key` must be "{agent_id}:{run_id}".
    /// Open to all callers — enables off-chain verification.
    pub fn verify_signature(
        env: Env,
        sig_key: String,
    ) -> Option<SignatureRecord> {
        let key = DataKey::Signature(sig_key);
        env.storage().persistent().get(&key)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Env, String};

    // NOTE on Soroban client method conventions:
    //   client.foo(...)        — panics on contract error; returns T directly
    //   client.try_foo(...)    — returns Result<Result<T, ContractError>, HostError>
    //     Ok(Ok(T))            — success
    //     Ok(Err(ShieldError)) — contract returned a typed error
    //     Err(_)               — host-level error (e.g. auth trap)

    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    #[test]
    fn test_initialize_once() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        // First call must succeed (no panic / no error).
        client.initialize(&admin);
    }

    #[test]
    fn test_initialize_twice_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        assert_eq!(
            client.try_initialize(&admin),
            Err(Ok(ShieldError::AlreadyInitialized))
        );
    }

    // -----------------------------------------------------------------------
    // register_agent / get_agent
    // -----------------------------------------------------------------------

    #[test]
    fn test_register_and_get_agent() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        let agent_id = String::from_str(&env, "ledger-1");

        client.initialize(&admin);
        client.register_agent(&agent_id, &wallet, &5_000_000);

        let record = client.get_agent(&agent_id);
        assert_eq!(record.agent_id, agent_id);
        assert_eq!(record.wallet_address, wallet);
        assert_eq!(record.spend_cap, 5_000_000);
        assert_eq!(record.total_spent, 0);
        assert!(record.is_active);
    }

    #[test]
    fn test_get_agent_not_found() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let missing_id = String::from_str(&env, "ghost-99");
        assert_eq!(
            client.try_get_agent(&missing_id),
            Err(Ok(ShieldError::AgentNotFound))
        );
    }

    // -----------------------------------------------------------------------
    // authorize_spend
    // -----------------------------------------------------------------------

    #[test]
    fn test_authorize_spend_within_cap() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        let agent_id = String::from_str(&env, "scout-1");

        client.initialize(&admin);
        client.register_agent(&agent_id, &wallet, &1_000_000);

        let approved = client.authorize_spend(&agent_id, &400_000);
        assert!(approved);

        let record = client.get_agent(&agent_id);
        assert_eq!(record.total_spent, 400_000);
    }

    #[test]
    fn test_authorize_spend_cumulative_tracking() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        let agent_id = String::from_str(&env, "scout-1");

        client.initialize(&admin);
        client.register_agent(&agent_id, &wallet, &1_000_000);

        client.authorize_spend(&agent_id, &300_000);
        client.authorize_spend(&agent_id, &300_000);

        let record = client.get_agent(&agent_id);
        assert_eq!(record.total_spent, 600_000);
    }

    #[test]
    fn test_authorize_spend_exceeds_cap() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        let agent_id = String::from_str(&env, "scout-1");

        client.initialize(&admin);
        client.register_agent(&agent_id, &wallet, &100_000);

        assert_eq!(
            client.try_authorize_spend(&agent_id, &200_000),
            Err(Ok(ShieldError::CapExceeded))
        );

        // total_spent must not change on a failed authorisation.
        let record = client.get_agent(&agent_id);
        assert_eq!(record.total_spent, 0);
    }

    #[test]
    fn test_authorize_spend_exactly_at_cap() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        let agent_id = String::from_str(&env, "scout-1");

        client.initialize(&admin);
        client.register_agent(&agent_id, &wallet, &500_000);

        // Spending exactly the cap should succeed.
        assert!(client.authorize_spend(&agent_id, &500_000));

        // Any further spend, even 1 stroop, must fail.
        assert_eq!(
            client.try_authorize_spend(&agent_id, &1),
            Err(Ok(ShieldError::CapExceeded))
        );
    }

    // -----------------------------------------------------------------------
    // reset_agent
    // -----------------------------------------------------------------------

    #[test]
    fn test_reset_agent_clears_total_spent() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        let agent_id = String::from_str(&env, "signal-1");

        client.initialize(&admin);
        client.register_agent(&agent_id, &wallet, &1_000_000);

        client.authorize_spend(&agent_id, &700_000);
        assert_eq!(client.get_agent(&agent_id).total_spent, 700_000);

        client.reset_agent(&agent_id);
        assert_eq!(client.get_agent(&agent_id).total_spent, 0);
    }

    #[test]
    fn test_reset_agent_not_found() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let missing = String::from_str(&env, "nope");
        assert_eq!(
            client.try_reset_agent(&missing),
            Err(Ok(ShieldError::AgentNotFound))
        );
    }

    // -----------------------------------------------------------------------
    // deactivate_agent
    // -----------------------------------------------------------------------

    #[test]
    fn test_deactivate_agent() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        let agent_id = String::from_str(&env, "scribe-1");

        client.initialize(&admin);
        client.register_agent(&agent_id, &wallet, &1_000_000);

        client.deactivate_agent(&agent_id);
        assert!(!client.get_agent(&agent_id).is_active);
    }

    #[test]
    fn test_spend_on_inactive_agent_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        let agent_id = String::from_str(&env, "scribe-1");

        client.initialize(&admin);
        client.register_agent(&agent_id, &wallet, &1_000_000);
        client.deactivate_agent(&agent_id);

        assert_eq!(
            client.try_authorize_spend(&agent_id, &100_000),
            Err(Ok(ShieldError::AgentInactive))
        );
    }

    #[test]
    fn test_deactivate_agent_not_found() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let missing = String::from_str(&env, "nobody");
        assert_eq!(
            client.try_deactivate_agent(&missing),
            Err(Ok(ShieldError::AgentNotFound))
        );
    }
}
