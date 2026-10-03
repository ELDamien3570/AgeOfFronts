// Normal games use the complete, bounded AI policy stack. Saved matches retain
// their recorded options; low-level simulation callers can select policies.
export const DEFAULT_AI_POLICIES = Object.freeze({
  aiEconomy: true,
  deferredPlanning: true,
  aiDefenses: true,
  aiNaval: true,
  aiWarPolicy: true,
});
