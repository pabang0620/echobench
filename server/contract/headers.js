// Column names of the APIMatic Context Plugin's paypal-plan.md tables, as written in the
// plugin's typescript-integrate-paypal skill (section 1b). The parser finds tables by these
// header names, not by position. Status: TO CONFIRM against a plan the plugin really generated
// (plan R2 step; VERIFY.md R2). If the generated file differs, edit this file only.
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
