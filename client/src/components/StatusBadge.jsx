const LABEL = {
  DRAFT: 'Draft',
  AWAITING_SIGNATURES: 'Awaiting signatures',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  PENDING: 'Pending',
  SUBMITTED: 'Submitted',
  AI_HOLD: 'Held by AI check',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${status.toLowerCase()}`}>{LABEL[status] || status}</span>;
}
