/** Custom HMR event sent when an artifact is added, updated or removed (payload `{ id }`). */
export const ARTIFACTS_CHANGED_EVENT = "pi-artifacts:changed";

/** Custom HMR event sent when a user template is saved or removed (payload `{ name }`). */
export const TEMPLATE_CHANGED_EVENT = "pi-artifacts:template-changed";

/** Custom HMR event sent when the agent writes memory (payload `{ scope }`). */
export const MEMORY_CHANGED_EVENT = "pi-artifacts:memory";
