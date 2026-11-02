// The identities the demo is handed out with. They are public — the sign-in page
// lists them and their shared password — so the offline demo can trust the same
// list instead of keeping a second copy that drifts.
export const DEMO_PASSWORD = 'Password123!'

export const DEMO_ACCOUNTS = [
  { role: 'Owner', email: 'demo@agency.com', blurb: 'Runs the whole studio; the only account that can hand ownership to someone else.' },
  { role: 'Admin', email: 'admin@agency.com', blurb: 'Hires, invites, reads the audit log and manages every project — but not ownership.' },
  { role: 'Project manager', email: 'pm@agency.com', blurb: 'Runs one project: tasks, milestones, files, access and review decisions.' },
  { role: 'Contributor', email: 'designer@agency.com', blurb: 'Moves only the tasks assigned to them and comments in discussions.' },
  { role: 'Viewer', email: 'viewer@agency.com', blurb: 'Reads the whole project; every change is refused.' },
  { role: 'Client approver', email: 'sarah.jenkins@acmeglobal.com', blurb: 'Client portal only: approves deliverables or asks for changes.' },
  { role: 'Client reviewer', email: 'marc.wong@acmeglobal.com', blurb: 'Client portal only: comments on reviews, cannot approve.' },
]
