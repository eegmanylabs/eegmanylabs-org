import { getPersonDemographicsContract, personDocSchema } from "@eegml/shared";
import { type ReactNode, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { formatDate } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { Detail, Details } from "@/components/registry/details";
import { EditableField, type EditableValue } from "@/components/registry/editable-field";
import { FavouriteButton } from "@/components/registry/favourite-button";
import { OriginBadge } from "@/components/registry/origin-badge";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type RecordOf,
  retryFailedLiveData,
  updateOwnPersonLinks,
  useCallResult,
  useLiveDocument,
  useLiveQuery,
} from "@/data";
import { CORRECTABLE_PERSON_FIELDS, CorrectionRequestDialog } from "@/pages/home/CorrectionRequestDialog";
import { replicationPath } from "@/pages/replications/replication-display";
import { Section } from "@/pages/replications/tabs/OverviewTab";
import { EntityTasksTab } from "@/pages/tasks/EntityTasksTab";
import { UpdatesTab } from "@/pages/tasks/UpdatesTab";
import { NotesTab } from "@/pages/workspace/NotesTab";
import {
  countryName,
  LABORATORY_ENTRY_STATUS_LABELS,
  LABORATORY_ROLE_LABELS,
  MEMBERSHIP_ROLE_LABELS,
} from "@/registry/labels";
import { laboratoryPath } from "@/registry/paths";
import {
  affiliationsOfPerson,
  confirmedMembershipsOfPerson,
  laboratoryEntriesOfPerson,
  useLaboratories,
  useReplications,
} from "@/registry/queries";
import { useRecordVisit } from "@/registry/use-record-visit";
import { useViewer, type Viewer } from "@/registry/viewer";
import { editsLinksOf, offersDemographicsOf, readsContactOf } from "./member-access";
import { OrcidDialog } from "./OrcidDialog";

type Person = RecordOf<"persons">;

const LINK_FIELDS = [
  ["scholarUrl", "Google Scholar profile"],
  ["universityUrl", "University profile"],
  ["labUrl", "Laboratory website"],
] as const;

function externalLink(value: EditableValue) {
  return (
    <a href={String(value)} target="_blank" rel="noopener noreferrer" className="break-all text-fg-accent underline">
      {String(value)}
    </a>
  );
}

/** The contact details, read only where the rules allow the account to read them. A refusal shows nothing. */
function ContactSection({ personId }: { personId: string }) {
  const contact = useLiveDocument("personContact", [personId]);
  if (contact.status === "error" && contact.error.code === "permission-denied") return null;
  return (
    <Section title="Contact" testId="contact-section">
      <LiveView
        live={contact}
        loadingLabel="Loading the contact details"
        errorTitle="The contact details could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(record) =>
          record === null || record.emails.length === 0 ? (
            <Unknown>No email address is recorded.</Unknown>
          ) : (
            <Details>
              {record.emails.map((entry) => (
                <Detail
                  key={entry.email}
                  term={
                    entry.kind === "primary" ? "Email" : entry.kind === "secondary" ? "Other email" : "Former email"
                  }
                >
                  <a href={`mailto:${entry.email}`} className="break-all text-fg-accent underline">
                    {entry.email}
                  </a>
                </Detail>
              ))}
            </Details>
          )
        }
      </LiveView>
      <p className="text-xs text-fg-muted">
        Shown to the person, to administrators and to the leads and coordinators of their units.
      </p>
    </Section>
  );
}

const DEMOGRAPHIC_FIELDS = [
  ["genderSource", "Gender, as recorded"],
  ["genderCategory", "Gender category"],
  ["genderSelfDescribed", "Gender, in their own words"],
  ["ethnicitySource", "Ethnicity, as recorded"],
  ["ethnicityCategory", "Ethnicity category"],
  ["ethnicitySelfDescribed", "Ethnicity, in their own words"],
] as const;

/** The special-category details, served by a function that checks the right and audits each view. Asked for on request only. */
function DemographicsSection({ personId, own }: { personId: string; own: boolean }) {
  const [asked, setAsked] = useState(false);
  const { live } = useCallResult(
    getPersonDemographicsContract,
    asked ? { personId } : null,
    `demographics:${personId}:${asked}`,
  );
  return (
    <Section title="Demographic details" testId="demographics-section">
      <p className="text-fg-secondary">
        {own
          ? "Only you and people with a named grant can see these details. Every view is recorded in the audit trail."
          : "Reading another person's details needs a named grant of this right and a second factor. Your view is recorded in the audit trail."}
      </p>
      {!asked ? (
        <div>
          <Button size="sm" onClick={() => setAsked(true)}>
            Show demographic details
          </Button>
        </div>
      ) : live.status === "error" ? (
        <ErrorState
          title="The demographic details were not shown."
          description={
            live.error.code === "permission-denied"
              ? "Your account holds no named grant to read them. A programme administrator can grant it."
              : live.error.message
          }
        />
      ) : live.status !== "ready" ? (
        <LoadingState label="Loading the demographic details" />
      ) : live.data.demographics === null ? (
        <Unknown>No demographic details are recorded.</Unknown>
      ) : (
        <Details>
          {DEMOGRAPHIC_FIELDS.filter(([field]) => live.data.demographics?.[field] !== undefined).map(
            ([field, label]) => (
              <Detail key={field} term={label}>
                {live.data.demographics?.[field]}
              </Detail>
            ),
          )}
        </Details>
      )}
    </Section>
  );
}

function PersonRecord({ person, viewer }: { person: Person; viewer: Viewer }) {
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const tab =
    requestedTab === "notes" || requestedTab === "tasks" || requestedTab === "updates" ? requestedTab : "profile";
  const showTab = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === "notes") next.set("tab", "notes");
        else next.delete("tab");
        return next;
      },
      { replace: true },
    );
  const affiliations = useLiveQuery(affiliationsOfPerson(person.id));
  const memberships = useLiveQuery(confirmedMembershipsOfPerson(person.id));
  const entries = useLiveQuery(laboratoryEntriesOfPerson(person.id));
  const laboratories = useLaboratories();
  const replications = useReplications();
  const titles = useMemo(
    () =>
      new Map(
        (replications.status === "ready" ? replications.data : []).map((replication) => [
          replication.studyKey,
          replication.shortTitle,
        ]),
      ),
    [replications],
  );
  const laboratoryNames = useMemo(
    () =>
      new Map(
        (laboratories.status === "ready" ? laboratories.data : []).map((laboratory) => [
          laboratory.id,
          laboratory.name,
        ]),
      ),
    [laboratories],
  );
  const own = person.userId === viewer.uid;
  const editsLinks = editsLinksOf(viewer, person);
  const seesLinkState = viewer.can("claims.review", "programme") || viewer.can("people.manage", "programme");

  const linkField = ([field, label]: (typeof LINK_FIELDS)[number]): ReactNode => (
    <EditableField
      key={field}
      label={label}
      value={person[field]}
      kind="url"
      schema={personDocSchema.shape[field]}
      invalidMessage="Enter a web address that starts with https://."
      canEdit={editsLinks}
      display={externalLink}
      onSave={(value) =>
        updateOwnPersonLinks(viewer.uid, person.id, { [field]: value === null ? null : String(value) })
      }
    />
  );

  return (
    <>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <h1 className="text-2xl text-fg">{person.displayName}</h1>
          {person.affiliationSummary === undefined ? null : (
            <p className="text-md text-fg-secondary">{person.affiliationSummary}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <OriginBadge origin={person.dataOrigin} showLive />
            {person.isCoreTeam ? <Badge tone="neutral">Core team</Badge> : null}
            {own ? <Badge tone="accent">Your profile</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewer.access.member ? (
            <CorrectionRequestDialog
              uid={viewer.uid}
              entityType="person"
              entityId={person.id}
              fields={CORRECTABLE_PERSON_FIELDS}
              description={
                own
                  ? "Tell the administrators which detail of your profile is wrong and what it should say. They correct the record."
                  : `Tell the administrators which detail of the profile of ${person.displayName} is wrong and what it should say.`
              }
            />
          ) : null}
          {viewer.access.member ? (
            <FavouriteButton uid={viewer.uid} entityType="person" entityId={person.id} name={person.displayName} />
          ) : null}
        </div>
      </header>
      <Tabs value={tab} onValueChange={showTab}>
        <TabsList aria-label="Sections of the member">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <div className="grid gap-4">
            <Section title="Directory">
              <Details>
                <Detail term="Given name">{person.givenName ?? <Unknown />}</Detail>
                {person.middleName === undefined ? null : <Detail term="Middle name">{person.middleName}</Detail>}
                <Detail term="Family name">{person.familyName ?? <Unknown />}</Detail>
                <Detail term="Country">
                  {person.countryCode === undefined ? <Unknown /> : countryName(person.countryCode)}
                </Detail>
                <Detail term="ORCID iD">
                  <span className="flex flex-wrap items-center gap-2">
                    {person.orcid === undefined ? (
                      <Unknown />
                    ) : (
                      <a
                        href={`https://orcid.org/${person.orcid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-fg-accent underline"
                      >
                        {person.orcid}
                      </a>
                    )}
                    {editsLinks ? <OrcidDialog personId={person.id} current={person.orcid ?? null} own={own} /> : null}
                  </span>
                </Detail>
                {person.isCoreTeam ? (
                  <Detail term="Core-team roles">{person.coreRoles.join(", ") || <Unknown />}</Detail>
                ) : null}
                {LINK_FIELDS.map(linkField)}
              </Details>
            </Section>
            <Section title="Affiliations">
              <LiveView
                live={affiliations}
                loadingLabel="Loading the affiliations"
                errorTitle="The affiliations could not be loaded."
                onRetry={retryFailedLiveData}
              >
                {(list) => {
                  const current = list.filter((affiliation) => affiliation.archivedAt === null);
                  return current.length === 0 ? (
                    <Unknown>No affiliation is recorded.</Unknown>
                  ) : (
                    <ul className="grid gap-2">
                      {current.map((affiliation) => (
                        <li key={affiliation.id} className="flex flex-wrap items-center gap-2">
                          <span>{affiliation.affiliationSource ?? <Unknown>Affiliation not named</Unknown>}</span>
                          {affiliation.roleTitle === undefined ? null : (
                            <span className="text-fg-secondary">{affiliation.roleTitle}</span>
                          )}
                          {affiliation.isPrimary ? <Badge tone="outline">Primary</Badge> : null}
                          {affiliation.endDate === undefined ? null : (
                            <span className="text-fg-muted">Until {affiliation.endDate}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  );
                }}
              </LiveView>
            </Section>
            <Section title="Replications">
              <LiveView
                live={memberships}
                loadingLabel="Loading the replications"
                errorTitle="The replications could not be loaded."
                onRetry={retryFailedLiveData}
              >
                {(list) => {
                  const current = list.filter((membership) => membership.archivedAt === null);
                  return current.length === 0 ? (
                    <Unknown>No confirmed membership of a replication.</Unknown>
                  ) : (
                    <Table caption="Replications of this person">
                      <TableHead>
                        <TableRow>
                          <TableHeaderCell>Replication</TableHeaderCell>
                          <TableHeaderCell>Role</TableHeaderCell>
                          <TableHeaderCell>Current or former</TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {current.map((membership) => (
                          <TableRow key={membership.id}>
                            <TableCell>
                              <Link
                                to={replicationPath(membership.replicationId)}
                                className="text-fg-strong hover:text-fg-accent"
                              >
                                {membership.replicationId}
                              </Link>
                              {titles.get(membership.replicationId) === undefined ? null : (
                                <span className="text-fg-secondary"> {titles.get(membership.replicationId)}</span>
                              )}
                            </TableCell>
                            <TableCell>{MEMBERSHIP_ROLE_LABELS[membership.role]}</TableCell>
                            <TableCell>{membership.isCurrent ? "Current" : "Former"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  );
                }}
              </LiveView>
            </Section>
            <Section title="Laboratories">
              <LiveView
                live={entries}
                loadingLabel="Loading the laboratories"
                errorTitle="The laboratories could not be loaded."
                onRetry={retryFailedLiveData}
              >
                {(list) => {
                  const current = list.filter((entry) => entry.archivedAt === null);
                  return current.length === 0 ? (
                    <Unknown>
                      No laboratory lists this person yet. Laboratories are added when they register in the portal.
                    </Unknown>
                  ) : (
                    <ul className="grid gap-2">
                      {current.map((entry) => (
                        <li key={entry.id} className="flex flex-wrap items-center gap-2">
                          <Link
                            to={laboratoryPath(entry.laboratoryId)}
                            className="font-medium text-fg-accent underline"
                          >
                            {laboratoryNames.get(entry.laboratoryId) ?? entry.laboratoryId}
                          </Link>
                          <span className="text-fg-secondary">{LABORATORY_ROLE_LABELS[entry.role]}</span>
                          <Badge tone={entry.status === "confirmed" ? "neutral" : "outline"}>
                            {LABORATORY_ENTRY_STATUS_LABELS[entry.status]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  );
                }}
              </LiveView>
            </Section>
            {readsContactOf(viewer, person) ? <ContactSection personId={person.id} /> : null}
            {offersDemographicsOf(viewer, person) ? <DemographicsSection personId={person.id} own={own} /> : null}
            {seesLinkState ? (
              <Section title="Account link" testId="link-state">
                <p>
                  {person.userId === null
                    ? "No account has claimed this profile yet."
                    : `Claimed by an account${person.claimedAt === null ? "" : ` on ${formatDate(person.claimedAt.toDate())}`}.`}
                </p>
                <p className="flex flex-wrap gap-3">
                  {viewer.can("claims.review", "programme") ? (
                    <Link to="/admin/claims" className="text-fg-accent underline">
                      Account claims
                    </Link>
                  ) : null}
                  {viewer.can("users.suspend", "programme") ? (
                    <Link to="/admin/users" className="text-fg-accent underline">
                      Users
                    </Link>
                  ) : null}
                </p>
              </Section>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="tasks">
          <EntityTasksTab viewer={viewer} entityType="person" entityId={person.id} userId={person.userId} />
        </TabsContent>
        <TabsContent value="updates">
          <UpdatesTab
            viewer={viewer}
            entityType="person"
            entityId={person.id}
            canPost={viewer.access.member && (own || viewer.can("people.manage", "programme"))}
          />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab entityType="person" entityId={person.id} />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function MemberPage() {
  const { personId = "" } = useParams();
  const viewer = useViewer();
  const person = useLiveDocument("persons", personId === "" ? null : [personId]);
  const exists = person.status === "ready" && person.data !== null;
  useRecordVisit(exists && viewer?.access.member === true ? viewer.uid : null, "person", exists ? personId : null);
  return (
    <LiveView
      live={person}
      loadingLabel="Loading the member"
      errorTitle="The member could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(record) =>
        record === null ? (
          <EmptyState
            title="This member does not exist"
            description="No member has this identifier. The link may be out of date."
            action={
              <Button asChild>
                <Link to="/members">Go to the members directory</Link>
              </Button>
            }
          />
        ) : viewer === null ? (
          <LoadingState label="Checking your access" />
        ) : (
          <PersonRecord person={record} viewer={viewer} />
        )
      }
    </LiveView>
  );
}
