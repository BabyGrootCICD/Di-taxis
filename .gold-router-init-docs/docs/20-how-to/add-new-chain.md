# How-to: Add a new chain

## Steps
1. Define chain parameters (RPC, confirmations, fee model)
2. Define token identifiers (contract address / asset ID)
3. Implement balance queries
4. Implement transfer indexing
5. Add reorg handling policy
6. Update reference doc under `30-reference/connectors/onchain/`

## Done criteria
- Deterministic reconciliation behavior
- Documented failure modes
