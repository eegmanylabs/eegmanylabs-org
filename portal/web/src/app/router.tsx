// The route table. Routes are hash-based (#/login), so the application needs no server
// rewrites and works at any address GitHub Pages serves it from.
//
// To add a page: add its route here with a `handle.title`, and, if it belongs in the sidebar,
// one entry in navigation.ts.
import type { ComponentType } from "react";
import { createHashRouter, type Params, type RouteObject } from "react-router";
import { RequireAuth } from "@/auth/RequireAuth";
import { RequireLinked } from "@/auth/RequireLinked";
import { LoadingState } from "@/components/feedback/loading-state";
import { LaboratoryName, PageTitle, PersonName } from "@/components/record-names";
import { useLiveDocument } from "@/data";
import { ClaimPage } from "@/pages/claim/ClaimPage";
import { HomePage } from "@/pages/home/HomePage";
import { LoginPage } from "@/pages/login/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { pagePath } from "@/registry/paths";
import { Root } from "./Root";
import { RouteError } from "./RouteError";
import type { RouteHandle } from "./route-meta";
import { AppShell } from "./shell/AppShell";
import { TrailCrumb } from "./shell/Breadcrumbs";

const titled = (title: string): { handle: RouteHandle } => ({ handle: { title } });

// The sign-in page, Home and the claim page are in the first bundle, because every visit starts
// with one of them. The account page and the administration console load when first opened,
// so that a member on a slow connection waits for less.
const lazyPage = (load: () => Promise<ComponentType>): Pick<RouteObject, "lazy"> => ({
  lazy: async () => ({ Component: await load() }),
});

/**
 * Routes of emulator builds only. Vite replaces `import.meta.env.MODE` with the mode's name
 * when it builds, so in staging and production this list is empty and the pages it names are
 * left out of the bundle. portal/tests/architecture/production-build.test.ts builds for production and
 * checks that.
 */
const emulatorRoutes: RouteObject[] =
  import.meta.env.MODE === "emulator"
    ? [
        {
          // Every interface primitive on one page, for the browser tests.
          path: "/dev/components",
          lazy: async () => ({ Component: (await import("@/pages/dev/ComponentsPage")).ComponentsPage }),
          ...titled("Interface components"),
        },
      ]
    : [];

/** The breadcrumb of a member page: the person's name, read live, with the identifier standing in until it is. */
function PersonCrumb({ params }: { readonly params: Readonly<Params> }) {
  return <PersonName id={params.personId ?? ""} />;
}

/** The breadcrumb of a page of the workspace: its title, read live. */
function PageCrumb({ params }: { readonly params: Readonly<Params> }) {
  return <PageTitle id={params.pageId ?? ""} />;
}

/** The crumbs before a database: the workspace and the page the database sits beneath. */
function DatabaseTrail({ params }: { readonly params: Readonly<Params> }) {
  const database = useLiveDocument("databases", [params.databaseId ?? ""]);
  return (
    <>
      <TrailCrumb to="/pages" first>
        Workspace
      </TrailCrumb>
      {database.status === "ready" && database.data !== null ? (
        <TrailCrumb to={pagePath(database.data.parentPageId)}>
          <PageTitle id={database.data.parentPageId} />
        </TrailCrumb>
      ) : null}
    </>
  );
}

/** The breadcrumb of a database: its name, read live. */
function DatabaseCrumb({ params }: { readonly params: Readonly<Params> }) {
  const database = useLiveDocument("databases", [params.databaseId ?? ""]);
  if (database.status === "loading") return <span className="text-fg-muted">Loading the name</span>;
  return <>{database.status === "ready" && database.data !== null ? database.data.name : "Database"}</>;
}

/** The breadcrumb of a dashboard: its name, read live. */
function DashboardCrumb({ params }: { readonly params: Readonly<Params> }) {
  const dashboard = useLiveDocument("dashboards", [params.dashboardId ?? ""]);
  if (dashboard.status === "loading") return <span className="text-fg-muted">Loading the name</span>;
  return <>{dashboard.status === "ready" && dashboard.data !== null ? dashboard.data.name : "Dashboard"}</>;
}

/** The breadcrumb of a laboratory page: its name, read live. */
function LaboratoryCrumb({ params }: { readonly params: Readonly<Params> }) {
  return <LaboratoryName id={params.laboratoryId ?? ""} />;
}

export function portalRoutes(signInLink: string | null): RouteObject[] {
  return [
    {
      element: <Root signInLink={signInLink} />,
      // Shown while the first page of a visit loads, when it is one that loads on demand.
      hydrateFallbackElement: <LoadingState label="Loading the members' portal" size="page" />,
      // Catches a failure in the frame itself. Failures inside a page are caught further down.
      errorElement: <RouteError />,
      children: [
        { path: "/login", element: <LoginPage />, ...titled("Sign in") },
        {
          // Everything in here needs a signed-in account and is shown inside the shell.
          element: (
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          ),
          children: [
            {
              // A page that fails is replaced by an error message. The shell stays usable.
              errorElement: <RouteError />,
              children: [
                { index: true, element: <HomePage />, ...titled("Home") },
                { path: "/claim", element: <ClaimPage />, ...titled("Your member profile") },
                {
                  // The registry, which the navigation lists for an account linked to a member
                  // profile only, asks any other account to link itself first.
                  element: <RequireLinked />,
                  children: [
                    {
                      path: "/search",
                      ...lazyPage(async () => (await import("@/pages/search/SearchPage")).SearchPage),
                      ...titled("Search"),
                    },
                    {
                      path: "/replications",
                      ...titled("Replications"),
                      children: [
                        {
                          index: true,
                          ...lazyPage(
                            async () => (await import("@/pages/replications/ReplicationsPage")).ReplicationsPage,
                          ),
                        },
                        {
                          path: ":studyKey",
                          ...lazyPage(
                            async () => (await import("@/pages/replications/ReplicationPage")).ReplicationPage,
                          ),
                          handle: {
                            title: (params: Readonly<Params>) => params.studyKey ?? "Replication",
                          } satisfies RouteHandle,
                        },
                      ],
                    },
                    {
                      path: "/labs",
                      ...titled("Laboratories"),
                      children: [
                        {
                          index: true,
                          ...lazyPage(
                            async () => (await import("@/pages/laboratories/LaboratoriesPage")).LaboratoriesPage,
                          ),
                        },
                        {
                          path: ":laboratoryId",
                          ...lazyPage(async () => (await import("@/pages/laboratories/LaboratoryPage")).LaboratoryPage),
                          handle: { title: "Laboratory", crumb: LaboratoryCrumb } satisfies RouteHandle,
                        },
                      ],
                    },
                    {
                      path: "/datasets",
                      ...titled("Datasets"),
                      children: [
                        {
                          index: true,
                          ...lazyPage(async () => (await import("@/pages/datasets/DatasetsPage")).DatasetsPage),
                        },
                        {
                          path: "servers",
                          ...lazyPage(
                            async () => (await import("@/pages/datasets/StorageServersPage")).StorageServersPage,
                          ),
                          handle: { title: "Storage servers" } satisfies RouteHandle,
                        },
                        {
                          path: ":datasetKey",
                          ...lazyPage(async () => (await import("@/pages/datasets/DatasetPage")).DatasetPage),
                          handle: {
                            title: (params: Readonly<Params>) => params.datasetKey ?? "Dataset",
                          } satisfies RouteHandle,
                        },
                      ],
                    },
                    {
                      path: "/readiness",
                      ...lazyPage(async () => (await import("@/pages/readiness/ReadinessPage")).ReadinessPage),
                      ...titled("Readiness"),
                    },
                    {
                      path: "/pages",
                      ...titled("Workspace"),
                      children: [
                        {
                          index: true,
                          ...lazyPage(async () => (await import("@/pages/workspace/WorkspacePage")).WorkspacePage),
                        },
                        {
                          path: ":pageId",
                          ...lazyPage(async () => (await import("@/pages/workspace/WorkspacePage")).PageRoute),
                          handle: { title: "Page", crumb: PageCrumb } satisfies RouteHandle,
                        },
                      ],
                    },
                    {
                      path: "/recruitment",
                      ...titled("Recruitment"),
                      children: [
                        {
                          index: true,
                          ...lazyPage(
                            async () => (await import("@/pages/recruitment/RecruitmentPage")).RecruitmentPage,
                          ),
                        },
                        {
                          path: "participations/:participationId",
                          ...lazyPage(
                            async () =>
                              (await import("@/pages/recruitment/ParticipationRecruitmentPage"))
                                .ParticipationRecruitmentPage,
                          ),
                          handle: { title: "Recruitment of a participation" } satisfies RouteHandle,
                        },
                        {
                          path: "forecast/:studyKey",
                          ...lazyPage(async () => (await import("@/pages/recruitment/ForecastPage")).ForecastPage),
                          handle: {
                            title: (params: Readonly<Params>) => `Forecast of ${params.studyKey ?? "a replication"}`,
                          } satisfies RouteHandle,
                        },
                        {
                          path: "categories",
                          ...lazyPage(async () => (await import("@/pages/recruitment/CategoriesPage")).CategoriesPage),
                          ...titled("Count categories"),
                        },
                      ],
                    },
                    {
                      path: "/tasks",
                      ...lazyPage(async () => (await import("@/pages/tasks/TasksPage")).TasksPage),
                      ...titled("Tasks"),
                    },
                    {
                      path: "/databases/:databaseId",
                      ...lazyPage(async () => (await import("@/pages/databases/DatabasePage")).DatabasePage),
                      handle: { title: "Database", crumb: DatabaseCrumb, trail: DatabaseTrail } satisfies RouteHandle,
                    },
                    {
                      path: "/overview",
                      ...lazyPage(async () => (await import("@/pages/overview/OverviewPage")).OverviewPage),
                      ...titled("Programme overview"),
                    },
                    {
                      path: "/analysis",
                      ...lazyPage(async () => (await import("@/pages/analysis/AnalysisPage")).AnalysisPage),
                      ...titled("Analysis"),
                    },
                    {
                      path: "/dashboards",
                      ...titled("Dashboards"),
                      children: [
                        {
                          index: true,
                          ...lazyPage(async () => (await import("@/pages/dashboards/DashboardsPage")).DashboardsPage),
                        },
                        {
                          path: ":dashboardId",
                          ...lazyPage(async () => (await import("@/pages/dashboards/DashboardsPage")).DashboardPage),
                          handle: { title: "Dashboard", crumb: DashboardCrumb } satisfies RouteHandle,
                        },
                      ],
                    },
                    {
                      path: "/members",
                      ...titled("Members"),
                      children: [
                        {
                          index: true,
                          ...lazyPage(async () => (await import("@/pages/members/MembersPage")).MembersPage),
                        },
                        {
                          path: ":personId",
                          ...lazyPage(async () => (await import("@/pages/members/MemberPage")).MemberPage),
                          handle: { title: "Member", crumb: PersonCrumb } satisfies RouteHandle,
                        },
                      ],
                    },
                  ],
                },
                {
                  path: "/account",
                  ...lazyPage(async () => (await import("@/pages/account/AccountPage")).AccountPage),
                  ...titled("Account and security"),
                },
                // Each page of the console checks the capability of its navigation entry itself
                // (AdminPage), so typing the address opens nothing more than the sidebar shows.
                {
                  path: "/admin/claims",
                  ...lazyPage(async () => (await import("@/pages/admin/ClaimsPage")).ClaimsPage),
                  ...titled("Account claims"),
                },
                {
                  path: "/admin/lab-claims",
                  ...lazyPage(async () => (await import("@/pages/admin/LabClaimsPage")).LabClaimsPage),
                  ...titled("Laboratory claims"),
                },
                {
                  path: "/admin/corrections",
                  ...lazyPage(async () => (await import("@/pages/admin/CorrectionsPage")).CorrectionsPage),
                  ...titled("Correction requests"),
                },
                {
                  path: "/admin/memberships",
                  ...lazyPage(async () => (await import("@/pages/admin/MembershipsReviewPage")).MembershipsReviewPage),
                  ...titled("Memberships to review"),
                },
                {
                  path: "/admin/users",
                  ...lazyPage(async () => (await import("@/pages/admin/UsersPage")).UsersPage),
                  ...titled("Users"),
                },
                {
                  path: "/admin/roles",
                  ...lazyPage(async () => (await import("@/pages/admin/RolesPage")).RolesPage),
                  ...titled("Roles and capabilities"),
                },
                {
                  path: "/admin/audit",
                  ...lazyPage(async () => (await import("@/pages/admin/AuditPage")).AuditPage),
                  ...titled("Audit log"),
                },
                {
                  path: "/admin/imports",
                  ...titled("Imports"),
                  children: [
                    {
                      index: true,
                      ...lazyPage(async () => (await import("@/pages/admin/imports/ImportsPage")).ImportsPage),
                    },
                    {
                      path: "batches/:batchId",
                      ...lazyPage(async () => (await import("@/pages/admin/imports/BatchPage")).BatchPage),
                      handle: { title: (params: Readonly<Params>) => params.batchId ?? "Batch" } satisfies RouteHandle,
                    },
                  ],
                },
                {
                  path: "/admin/review-queue",
                  ...lazyPage(async () => (await import("@/pages/admin/imports/ReviewQueuePage")).ReviewQueuePage),
                  ...titled("Review queue"),
                },
                {
                  path: "/admin/integrations",
                  ...titled("Integrations"),
                  children: [
                    {
                      index: true,
                      ...lazyPage(
                        async () => (await import("@/pages/admin/integrations/IntegrationsPage")).IntegrationsPage,
                      ),
                    },
                    {
                      path: "conflicts",
                      ...lazyPage(async () => (await import("@/pages/admin/integrations/ConflictsPage")).ConflictsPage),
                      ...titled("Conflicts"),
                    },
                  ],
                },
                {
                  path: "/admin/publishing",
                  ...titled("Publishing"),
                  children: [
                    {
                      index: true,
                      ...lazyPage(async () => (await import("@/pages/admin/publishing/PublishingPage")).PublishingPage),
                    },
                    {
                      path: ":batchId",
                      ...lazyPage(
                        async () => (await import("@/pages/admin/publishing/PublicationPage")).PublicationPage,
                      ),
                      ...titled("Export"),
                    },
                  ],
                },
                {
                  path: "/admin/automations",
                  ...lazyPage(async () => (await import("@/pages/admin/automations/AutomationsPage")).AutomationsPage),
                  ...titled("Automations"),
                },
                {
                  path: "/admin/governance",
                  ...lazyPage(async () => (await import("@/pages/admin/GovernancePage")).GovernancePage),
                  ...titled("Governance"),
                },
                {
                  path: "/admin/integrity",
                  ...lazyPage(async () => (await import("@/pages/admin/IntegrityPage")).IntegrityPage),
                  ...titled("Integrity"),
                },
              ],
            },
          ],
        },
        ...emulatorRoutes,
        { path: "*", element: <NotFoundPage />, ...titled("Page not found") },
      ],
    },
  ];
}

/** `signInLink` is the sign-in link the page was opened from, if any (see captureSignInLink). */
export function createPortalRouter(signInLink: string | null) {
  return createHashRouter(portalRoutes(signInLink));
}
