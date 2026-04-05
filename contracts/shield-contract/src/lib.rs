//! Shield Contract
//!
//! Enforces per-agent spend caps on Stellar testnet.
//! Each sub-agent is registered with a maximum spend allowance;
//! the contract authorises or rejects payment requests and tracks
//! cumulative spend, enabling the orchestrator to revoke or adjust
//! caps at any time.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

// ---------------------------------------------------------------------------
// Storage key types
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    /// Spend cap for a given agent address (in stroops)
    SpendCap(Address),
    /// Cumulative spend for a given agent address (in stroops)
    SpendUsed(Address),
    /// Contract admin / orchestrator address
    Admin,
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

    /// Initialise the contract with the orchestrator as admin.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    // -----------------------------------------------------------------------
    // Cap management (admin only)
    // -----------------------------------------------------------------------

    /// Register or update a spend cap for an agent (in stroops).
    pub fn set_cap(env: Env, agent: Address, cap_stroops: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::SpendCap(agent), &cap_stroops);
    }

    /// Remove an agent's cap (effectively disabling them).
    pub fn remove_agent(env: Env, agent: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::SpendCap(agent.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::SpendUsed(agent));
    }

    // -----------------------------------------------------------------------
    // Spend authorisation
    // -----------------------------------------------------------------------

    /// Attempt to authorise a spend of `amount` stroops for `agent`.
    /// Returns `true` if within cap, `false` otherwise.
    /// On success, records the spend.
    pub fn authorize_spend(env: Env, agent: Address, amount: i128) -> bool {
        agent.require_auth();

        let cap: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::SpendCap(agent.clone()))
            .unwrap_or(0);

        let used: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::SpendUsed(agent.clone()))
            .unwrap_or(0);

        if used + amount > cap {
            return false;
        }

        env.storage()
            .persistent()
            .set(&DataKey::SpendUsed(agent.clone()), &(used + amount));

        env.events().publish(
            (Symbol::new(&env, "spend_authorized"), agent),
            (amount, used + amount, cap),
        );

        true
    }

    // -----------------------------------------------------------------------
    // Read-only helpers
    // -----------------------------------------------------------------------

    /// Return the current spend cap for an agent.
    pub fn get_cap(env: Env, agent: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::SpendCap(agent))
            .unwrap_or(0)
    }

    /// Return cumulative spend for an agent.
    pub fn get_used(env: Env, agent: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::SpendUsed(agent))
            .unwrap_or(0)
    }

    /// Return remaining allowance for an agent.
    pub fn get_remaining(env: Env, agent: Address) -> i128 {
        let cap = Self::get_cap(env.clone(), agent.clone());
        let used = Self::get_used(env, agent);
        (cap - used).max(0)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_spend_within_cap() {
        let env = Env::default();
        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let agent = Address::generate(&env);

        env.mock_all_auths();

        client.initialize(&admin);
        client.set_cap(&agent, &1_000_000);

        assert!(client.authorize_spend(&agent, &500_000));
        assert_eq!(client.get_used(&agent), 500_000);
        assert_eq!(client.get_remaining(&agent), 500_000);
    }

    #[test]
    fn test_spend_exceeds_cap() {
        let env = Env::default();
        let contract_id = env.register_contract(None, ShieldContract);
        let client = ShieldContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let agent = Address::generate(&env);

        env.mock_all_auths();

        client.initialize(&admin);
        client.set_cap(&agent, &100_000);

        assert!(!client.authorize_spend(&agent, &200_000));
        assert_eq!(client.get_used(&agent), 0);
    }
}
