// Registering a laboratory, which a member proposes and a reviewer approves, and creating one
// directly, which an administrator does. Both ask for the same profile. The form checks the
// values against the shared contract before anything is sent, and says at once when the same
// laboratory exists already, because it takes the same identifier.
import {
  createLaboratoryContract,
  type LaboratoryInput,
  laboratoryInputSchema,
  nameFold,
  registeredInstitutionId,
  registeredLaboratoryId,
  requestLabClaimContract,
} from "@eegml/shared";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CallableError, callFunction } from "@/data";
import { countryName, countryOptions } from "@/registry/labels";
import { laboratoryPath } from "@/registry/paths";
import type { LaboratoryRecord } from "@/registry/queries";

const COUNTRIES = countryOptions();

const NEW_INSTITUTION = "__new";

export interface InstitutionOption {
  readonly id: string;
  readonly name: string;
  readonly countryCode: string | null;
}

export interface RegisterLaboratoryDialogProps {
  readonly mode: "register" | "create";
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly institutions: readonly InstitutionOption[];
  readonly laboratories: readonly LaboratoryRecord[];
  /** Called with what was done, after the dialog has closed. */
  readonly onDone: (outcome: { laboratoryId: string; duplicate: boolean }) => void;
}

interface Draft {
  name: string;
  institutionId: string;
  institutionName: string;
  countryCode: string;
  city: string;
  department: string;
  website: string;
  role: "coordinator" | "representative";
  message: string;
}

const EMPTY: Draft = {
  name: "",
  institutionId: "",
  institutionName: "",
  countryCode: "",
  city: "",
  department: "",
  website: "",
  role: "coordinator",
  message: "",
};

/** The input of the contract from the form, or the messages of the fields that do not fit. */
function inputOf(draft: Draft): { input: LaboratoryInput } | { errors: Partial<Record<keyof Draft, string>> } {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const nameFault = (text: string, missing: string) =>
    text.trim() === "" ? missing : nameFold(text) === "" ? "The name needs at least one letter or digit." : null;
  const name = nameFault(draft.name, "Enter the name of the laboratory.");
  if (name !== null) errors.name = name;
  if (draft.institutionId === "") errors.institutionId = "Choose the institution, or choose to enter a new one.";
  if (draft.institutionId === NEW_INSTITUTION) {
    const institutionName = nameFault(draft.institutionName, "Enter the name of the institution.");
    if (institutionName !== null) errors.institutionName = institutionName;
    if (draft.countryCode === "") errors.countryCode = "Choose the country of the institution.";
    if (draft.city.trim() === "") errors.city = "Enter the city of the institution.";
  }
  const candidate = {
    name: draft.name.trim(),
    institution:
      draft.institutionId === NEW_INSTITUTION
        ? { kind: "new", name: draft.institutionName.trim(), countryCode: draft.countryCode, city: draft.city.trim() }
        : { kind: "existing", institutionId: draft.institutionId },
    ...(draft.department.trim() === "" ? {} : { department: draft.department.trim() }),
    ...(draft.website.trim() === "" ? {} : { website: draft.website.trim() }),
  };
  const parsed = laboratoryInputSchema.safeParse(candidate);
  if (!parsed.success && draft.website.trim() !== "") {
    const websiteFault = parsed.error.issues.some((issue) => issue.path[0] === "website");
    if (websiteFault) errors.website = "Enter a full web address that starts with https://.";
  }
  if (Object.keys(errors).length > 0 || !parsed.success) {
    return { errors: Object.keys(errors).length > 0 ? errors : { name: "Check the details and try again." } };
  }
  return { input: parsed.data };
}

/** The laboratory that has the same identifier as the one being entered, or the same folded name at the institution. */
function existingMatch(draft: Draft, laboratories: readonly LaboratoryRecord[]): LaboratoryRecord | null {
  if (nameFold(draft.name) === "" || draft.institutionId === "") return null;
  const institutionId =
    draft.institutionId === NEW_INSTITUTION
      ? nameFold(draft.institutionName) === "" || draft.countryCode === ""
        ? null
        : registeredInstitutionId(draft.institutionName, draft.countryCode)
      : draft.institutionId;
  if (institutionId === null) return null;
  const id = registeredLaboratoryId(institutionId, draft.name);
  return (
    laboratories.find(
      (laboratory) =>
        laboratory.archivedAt === null &&
        (laboratory.id === id ||
          (laboratory.institutionId === institutionId && nameFold(laboratory.name) === nameFold(draft.name))),
    ) ?? null
  );
}

export function RegisterLaboratoryDialog({
  mode,
  open,
  onOpenChange,
  institutions,
  laboratories,
  onDone,
}: RegisterLaboratoryDialogProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const match = useMemo(() => existingMatch(draft, laboratories), [draft, laboratories]);
  const set = (field: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const close = (next: boolean) => {
    if (!next) {
      setDraft(EMPTY);
      setErrors({});
      setFailure(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = inputOf(draft);
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      if (mode === "create") {
        const created = await callFunction(createLaboratoryContract, result.input);
        close(false);
        onDone({ laboratoryId: created.laboratoryId, duplicate: false });
      } else {
        const sent = await callFunction(requestLabClaimContract, {
          proposal: result.input,
          requestedRole: draft.role,
          ...(draft.message.trim() === "" ? {} : { message: draft.message.trim() }),
        });
        close(false);
        onDone({ laboratoryId: sent.laboratoryId, duplicate: sent.duplicate });
      }
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The laboratory could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const institutionName = (option: InstitutionOption) =>
    option.countryCode === null ? option.name : `${option.name}, ${countryName(option.countryCode)}`;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title={mode === "create" ? "Create a laboratory" : "Register a laboratory"}
        description={
          mode === "create"
            ? "The laboratory is created at once. Its coordinators can then complete its profile."
            : "A programme administrator or a member of the core team reviews your registration. Once it is approved, the laboratory is created and you represent it with the role you ask for."
        }
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4" data-testid="register-laboratory-form">
          {failure ? <ErrorState title="Nothing was sent." description={failure} /> : null}
          <FormField label="Name of the laboratory" error={errors.name ?? null}>
            {(control) => (
              <Input {...control} value={draft.name} onChange={(event) => set("name")(event.target.value)} />
            )}
          </FormField>
          <FormField label="Institution" error={errors.institutionId ?? null}>
            {(control) => (
              <Select
                {...control}
                value={draft.institutionId}
                onChange={(event) => set("institutionId")(event.target.value)}
              >
                <option value="">Choose the institution</option>
                {institutions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {institutionName(option)}
                  </option>
                ))}
                <option value={NEW_INSTITUTION}>An institution that is not listed</option>
              </Select>
            )}
          </FormField>
          {draft.institutionId === NEW_INSTITUTION ? (
            <fieldset className="grid gap-3 rounded-control border border-border p-3">
              <legend className="px-1 text-sm text-fg-secondary">The new institution</legend>
              <FormField label="Name of the institution" error={errors.institutionName ?? null}>
                {(control) => (
                  <Input
                    {...control}
                    value={draft.institutionName}
                    onChange={(event) => set("institutionName")(event.target.value)}
                  />
                )}
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Country" error={errors.countryCode ?? null}>
                  {(control) => (
                    <Select
                      {...control}
                      value={draft.countryCode}
                      onChange={(event) => set("countryCode")(event.target.value)}
                    >
                      <option value="">Choose the country</option>
                      {COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label="City" error={errors.city ?? null}>
                  {(control) => (
                    <Input {...control} value={draft.city} onChange={(event) => set("city")(event.target.value)} />
                  )}
                </FormField>
              </div>
            </fieldset>
          ) : null}
          {match === null ? null : (
            <div
              role="status"
              className="grid gap-1 rounded-control border border-accent bg-surface-accent p-3"
              data-testid="duplicate-warning"
            >
              <p className="font-medium text-fg-strong">This laboratory is in the portal already</p>
              <p className="text-fg-secondary">
                {match.name} is listed at this institution.{" "}
                {mode === "register"
                  ? "If you work there, open its page and ask to represent it. If you send this registration, a reviewer compares the two."
                  : "Open its page instead of creating it again."}
              </p>
              <Link to={laboratoryPath(match.id)} className="text-fg-accent underline" onClick={() => close(false)}>
                Open {match.name}
              </Link>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Department" hint="Optional.">
              {(control) => (
                <Input
                  {...control}
                  value={draft.department}
                  onChange={(event) => set("department")(event.target.value)}
                />
              )}
            </FormField>
            <FormField
              label="Website"
              hint="Optional. A full address, starting with https://."
              error={errors.website ?? null}
            >
              {(control) => (
                <Input
                  {...control}
                  type="url"
                  value={draft.website}
                  onChange={(event) => set("website")(event.target.value)}
                />
              )}
            </FormField>
          </div>
          {mode === "register" ? (
            <>
              <FormField
                label="Your role"
                hint="A coordinator maintains the laboratory in the portal. A representative speaks for it."
              >
                {(control) => (
                  <Select {...control} value={draft.role} onChange={(event) => set("role")(event.target.value)}>
                    <option value="coordinator">Coordinator</option>
                    <option value="representative">Authorised representative</option>
                  </Select>
                )}
              </FormField>
              <FormField label="Message to the reviewer" hint="Optional. How you are connected to the laboratory.">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    maxLength={2_000}
                    value={draft.message}
                    onChange={(event) => set("message")(event.target.value)}
                  />
                )}
              </FormField>
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Sending…" : mode === "create" ? "Create the laboratory" : "Send for review"}
            </Button>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
