//! Identity Registry Contract
//!
//! Stores on-chain identities and reputation scores for Aegis sub-agents.
//! The orchestrator registers agents; reputation is updated after each
//! completed task based on outcome quality signals.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol};

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AgentRole {
    Scout,
    Ledger,
    Signal,
    Scribe,
}

#[contracttype]
#[derive(Clone)]
pub struct AgentRecord {
    /// Human-readable name
    pub name: String,
    /// Agent role
    pub role: AgentRole,
    /// Reputation score (0–10_000, representing 0.00–100.00)
    pub reputation: u32,
    /// Total tasks completed
    pub tasks_completed: u64,
    /// Whether the agent is currently active
    pub active: bool,
}

#[contracttype]
pub enum DataKey {
    Agent(Address),
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

    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    // -----------------------------------------------------------------------
    // Agent management (admin only)
    // -----------------------------------------------------------------------

    /// Register a new agent.
    pub fn register_agent(
        env: Env,
        agent: Address,
        name: String,
        role: AgentRole,
    ) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let record = AgentRecord {
            name,
            role,
            reputation: 5_000, // start at 50.00
            tasks_completed: 0,
            active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Agent(agent.clone()), &record);

        env.events().publish(
            (Symbol::new(&env, "agent_registered"), agent),
            (),
        );
    }

    /// Deactivate an agent.
    pub fn deactivate_agent(env: Env, agent: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut record: AgentRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent.clone()))
            .unwrap();

        record.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Agent(agent), &record);
    }

    // -----------------------------------------------------------------------
    // Reputation updates (admin only)
    // -----------------------------------------------------------------------

    /// Update reputation after a task. `delta` is a signed adjustment
    /// (positive = improved, negative = degraded), clamped to [0, 10_000].
    pub fn update_reputation(env: Env, agent: Address, delta: i32, task_success: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut record: AgentRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent.clone()))
            .unwrap();

        let new_rep = (record.reputation as i64 + delta as i64).clamp(0, 10_000) as u32;
        record.reputation = new_rep;

        if task_success {
            record.tasks_completed += 1;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Agent(agent.clone()), &record);

        env.events().publish(
            (Symbol::new(&env, "reputation_updated"), agent),
            (new_rep, task_success),
        );
    }

    // -----------------------------------------------------------------------
    // Read-only helpers
    // -----------------------------------------------------------------------

    pub fn get_agent(env: Env, agent: Address) -> AgentRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(agent))
            .unwrap()
    }

    pub fn get_reputation(env: Env, agent: Address) -> u32 {
        let record: AgentRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent))
            .unwrap();
        record.reputation
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

    #[test]
    fn test_register_and_reputation() {
        let env = Env::default();
        let contract_id = env.register_contract(None, IdentityRegistry);
        let client = IdentityRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let agent = Address::generate(&env);

        env.mock_all_auths();

        client.initialize(&admin);
        client.register_agent(
            &agent,
            &String::from_str(&env, "scout-1"),
            &AgentRole::Scout,
        );

        assert_eq!(client.get_reputation(&agent), 5_000);

        client.update_reputation(&agent, &500_i32, &true);
        assert_eq!(client.get_reputation(&agent), 5_500);
    }
}
