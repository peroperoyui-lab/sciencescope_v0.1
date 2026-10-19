/**
 * @param {ReturnType<typeof import('../router.js').createRouter>} router
 * @param {ReturnType<typeof import('../../services/approvals.js').createApprovals>} [approvals]
 */
export function registerApprovalRoutes(router, approvals) {
  if (!approvals) return;
  router.post('/api/turns/:turnId/approvals/:activityId', ({ params, body }) =>
    approvals.decide(params.turnId, params.activityId, body.decision, body.scope),
  );
}
