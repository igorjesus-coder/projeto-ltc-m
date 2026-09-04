export const P008_EXECUTABLE_FUNCTION_ALLOWLIST = Object.freeze([
  'ltc_m.approve_plan_version_as_approver(uuid,bigint)',
  'ltc_m.approve_plan_version(uuid)',
  'ltc_m.archive_plan_version(uuid)',
  'ltc_m.archive_plan_version(uuid,bigint)',
  'ltc_m.authorization_context()',
  'ltc_m.current_actor_id(boolean)',
  'ltc_m.lock_plan_version(uuid,bigint)',
  'ltc_m.read_audit_log(integer,timestamp with time zone,bigint,timestamp with time zone,timestamp with time zone,text,ltc_m.audit_operation,uuid,text)',
  'ltc_m.reopen_plan_version(uuid,text,bigint)',
  'ltc_m.resolve_authorization(text)',
  'ltc_m.return_plan_version_to_draft_as_approver(uuid,bigint)',
  'ltc_m.return_plan_version_to_draft(uuid)',
  'ltc_m.set_actor_context(uuid,text,text,text,text,boolean)',
  'ltc_m.submit_plan_version(uuid,bigint)',
]);

export function compareP008ExecutableFunctionAllowlist(actualFunctions) {
  const expected = new Set(P008_EXECUTABLE_FUNCTION_ALLOWLIST);
  const actual = new Set(actualFunctions);
  return {
    missing: P008_EXECUTABLE_FUNCTION_ALLOWLIST.filter((signature) => !actual.has(signature)),
    unexpected: [...actual].filter((signature) => !expected.has(signature)),
    duplicate: actual.size !== actualFunctions.length,
  };
}

export function findP008PublicExecutableFunctions(functionRows) {
  return functionRows.filter((row) => row.public_execute === true).map((row) => row.signature);
}
