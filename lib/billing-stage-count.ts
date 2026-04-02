/**
 * Billing-stage project count (non-archived, `status = 'billing'`).
 * Delegates to `countBillingStageProjects` in repositories — same filters as
 * GET `/projects?billingOnly=true&includeArchived=false` and the Billing page list.
 */
export { countBillingStageProjects } from "./repositories";
