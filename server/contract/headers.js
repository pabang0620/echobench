// Column names of the APIMatic Context Plugin's paypal-plan.md tables, as written in the
// plugin's typescript-integrate-paypal skill (section 1b). The parser finds tables by these
// header names, not by position. Compared with a plan the plugin really generated (targets/ab/sdk-plugin-on,
// 2026-11-12): the section titles match, the column names were shortened, so parser.js also finds a table
// by the section heading above it and reads its columns in this order.
export const HEADER_SETS = {
  'duplicate-claims': {
    title: 'DUPLICATE CLAIMS',
    columns: ['Write', 'Where the claim is stored', 'What rejects the second one', 'Where that rejection is caught', 'Where in the code'],
  },
  'unknown-outcomes': {
    title: 'UNKNOWN OUTCOMES',
    columns: ['Write', 'The operation you re-read with', 'The reference you search by', 'Where in the code', 'The test that fails the connection'],
  },
  'cross-operation-invariants': {
    title: 'CROSS-OPERATION INVARIANTS',
    columns: ['Invariant', 'Where the legal set comes from', 'Enforced where', 'The test that proves it'],
  },
}

// EchoBench's own column. It is appended to a copy of the plan; the original table is never changed.
export const PROOF_COLUMN = 'Proven by EchoBench'
