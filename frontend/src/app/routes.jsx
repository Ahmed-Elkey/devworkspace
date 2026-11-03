// The single source of truth for SPA routing. Every entry corresponds to a
// physical page document under frontend/ (e.g. workspace/dashboard.html for
// /workspace/dashboard); those documents still exist and are what Vercel's
// cleanUrls serves on a cold load, but each of them now boots the one SPA
// shell (src/app/main.jsx), which resolves the route from the URL and swaps
// pages in place instead of reloading the document.
//
// `title` is what the served document used to put in <title>; the Router
// applies it on every client-side navigation.
//
// `load` dynamically imports the page module. The module contract is uniform:
// its default export is a React component that owns the whole route.
//   - workspace/portal/project/misc pages export `<Page>`-style components
//     that render <Doc body scripts/> for their original markup + script.
//   - landing (src/App.jsx), auth pages and pricing export their app
//     components directly.
//
// When adding a page: create frontend/<path>.html AND add an entry with the
// same path here.

import { lazy } from 'react'

export const ROUTES = [
  { path: '/', title: 'Devworkspace – Plan projects on one timeline', component: lazy(() => import('../App.jsx')) },
  { path: '/pricing', title: 'Devworkspace Pricing – Pay for planners, guests are free', component: lazy(() => import('../pages/pricing/main.jsx')) },
  { path: '/about', title: 'About the creator – Devworkspace portfolio', component: lazy(() => import('../pages/portfolio/main.jsx')) },
  { path: '/how-it-works', title: 'How the demo works – Devworkspace portfolio', component: lazy(() => import('../pages/portfolio/main.jsx')) },
  { path: '/demo-guide', title: 'Demo guide – Devworkspace portfolio', component: lazy(() => import('../pages/portfolio/main.jsx')) },
  { path: '/login', title: 'Sign in – Devworkspace', component: lazy(() => import('../pages/auth/login.jsx')) },
  { path: '/register', title: 'Create account – Devworkspace', component: lazy(() => import('../pages/auth/register.jsx')) },
  { path: '/forgot-password', title: 'Forgot password – Devworkspace', component: lazy(() => import('../pages/auth/forgot.jsx')) },
  { path: '/reset-password', title: 'New password – Devworkspace', component: lazy(() => import('../pages/auth/reset.jsx')) },
  { path: '/onboarding', title: 'Create organization – Devworkspace', component: lazy(() => import('../pages/auth/onboarding.jsx')) },
  { path: '/invitation', title: 'Accept invitation – Devworkspace', component: lazy(() => import('../pages/auth/invitation.jsx')) },
  { path: '/loading', title: 'Loading | Devworkspace', component: lazy(() => import('../pages/misc/ploading/page.jsx')) },
  { path: '/404', title: '404 – Page not found | Devworkspace', component: lazy(() => import('../pages/misc/p404/page.jsx')) },

  { path: '/workspace/dashboard', title: 'Dashboard – Devworkspace', component: lazy(() => import('../pages/workspace/dashboard/page.jsx')) },
  { path: '/workspace/projects', title: 'Projects – Devworkspace', component: lazy(() => import('../pages/workspace/projects/page.jsx')) },
  { path: '/workspace/my-tasks', title: 'My tasks – Devworkspace', component: lazy(() => import('../pages/workspace/my-tasks/page.jsx')) },
  { path: '/workspace/clients', title: 'Clients – Devworkspace', component: lazy(() => import('../pages/workspace/clients/page.jsx')) },
  { path: '/workspace/client', title: 'Client – Devworkspace', component: lazy(() => import('../pages/workspace/client/page.jsx')) },
  { path: '/workspace/reviews', title: 'Review center – Devworkspace', component: lazy(() => import('../pages/workspace/reviews/page.jsx')) },
  { path: '/workspace/reports', title: 'Reports – Devworkspace', component: lazy(() => import('../pages/workspace/reports/page.jsx')) },
  { path: '/workspace/notifications', title: 'Notifications – Devworkspace', component: lazy(() => import('../pages/workspace/notifications/page.jsx')) },
  { path: '/workspace/documents', title: 'Documents – Devworkspace', component: lazy(() => import('../pages/workspace/documents/page.jsx')) },
  { path: '/workspace/document', title: 'Document – Devworkspace', component: lazy(() => import('../pages/workspace/document/page.jsx')) },
  { path: '/workspace/team', title: 'Team – Devworkspace', component: lazy(() => import('../pages/workspace/team/page.jsx')) },
  { path: '/workspace/audit', title: 'Audit log – Devworkspace', component: lazy(() => import('../pages/workspace/audit/page.jsx')) },
  { path: '/workspace/settings', title: 'Settings – Devworkspace', component: lazy(() => import('../pages/workspace/settings/page.jsx')) },
  { path: '/workspace/account', title: 'Account – Devworkspace', component: lazy(() => import('../pages/workspace/account/page.jsx')) },

  { path: '/portal/portal-projects', title: 'Your projects – Devworkspace', component: lazy(() => import('../pages/portal/portal-projects/page.jsx')) },
  { path: '/portal/portal-project', title: 'Project – Devworkspace', component: lazy(() => import('../pages/portal/portal-project/page.jsx')) },
  { path: '/portal/portal-deliverables', title: 'Deliverables – Devworkspace', component: lazy(() => import('../pages/portal/portal-deliverables/page.jsx')) },
  { path: '/portal/portal-review', title: 'Review – Devworkspace', component: lazy(() => import('../pages/portal/portal-review/page.jsx')) },
  { path: '/portal/portal-updates', title: 'Latest updates – Devworkspace', component: lazy(() => import('../pages/portal/portal-updates/page.jsx')) },
  { path: '/portal/portal-notifications', title: 'Notifications – Devworkspace', component: lazy(() => import('../pages/portal/portal-notifications/page.jsx')) },
  { path: '/portal/portal-account', title: 'Account – Devworkspace', component: lazy(() => import('../pages/portal/portal-account/page.jsx')) },

  { path: '/project/project', title: 'Project – Devworkspace', component: lazy(() => import('../pages/project/project/page.jsx')) },
  { path: '/project/project-tasks', title: 'Tasks – Devworkspace', component: lazy(() => import('../pages/project/project-tasks/page.jsx')) },
  { path: '/project/project-task', title: 'Task – Devworkspace', component: lazy(() => import('../pages/project/project-task/page.jsx')) },
  { path: '/project/project-milestones', title: 'Milestones – Devworkspace', component: lazy(() => import('../pages/project/project-milestones/page.jsx')) },
  { path: '/project/project-files', title: 'Files – Devworkspace', component: lazy(() => import('../pages/project/project-files/page.jsx')) },
  { path: '/project/project-deliverables', title: 'Deliverables – Devworkspace', component: lazy(() => import('../pages/project/project-deliverables/page.jsx')) },
  { path: '/project/project-review', title: 'Review – Devworkspace', component: lazy(() => import('../pages/project/project-review/page.jsx')) },
  { path: '/project/project-access', title: 'Team & access – Devworkspace', component: lazy(() => import('../pages/project/project-access/page.jsx')) },
  { path: '/project/project-discussions', title: 'Discussions – Devworkspace', component: lazy(() => import('../pages/project/project-discussions/page.jsx')) },
  { path: '/project/project-activity', title: 'Activity – Devworkspace', component: lazy(() => import('../pages/project/project-activity/page.jsx')) }
]

export const ROUTE_TITLES = new Map(ROUTES.map((r) => [r.path, r.title]))
