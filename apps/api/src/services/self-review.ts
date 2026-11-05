export class DomainRuleError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode=403) { super(message); this.name='DomainRuleError'; }
}
export function assertNoSelfReview(input: { reviewerUserId: string; operationAuthorUserId?: string | null; versionAuthorUserId?: string | null }) {
  if (!input.operationAuthorUserId || !input.versionAuthorUserId) {
    throw new DomainRuleError('REVIEW_AUTHOR_UNKNOWN','Autoria rastreável da operação e da versão é necessária antes da decisão.');
  }
  if (input.reviewerUserId===input.operationAuthorUserId || input.reviewerUserId===input.versionAuthorUserId) {
    throw new DomainRuleError('SELF_REVIEW_NOT_ALLOWED','O autor da operação ou versão não pode decidir o próprio alerta.');
  }
}
