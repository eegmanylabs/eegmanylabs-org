// Asks to represent a laboratory that exists, through `requestLabClaim`. The function computes
// the evidence, and a reviewer of the programme or a coordinator of the laboratory decides.
import { requestLabClaimContract } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction } from "@/data";

export function RepresentDialog({ laboratoryId, laboratoryName }: { laboratoryId: string; laboratoryName: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"coordinator" | "representative">("representative");
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(requestLabClaimContract, {
        laboratoryId,
        requestedRole: role,
        ...(message.trim() === "" ? {} : { message: message.trim() }),
      });
      setOpen(false);
      setMessage("");
      toast.show({
        title: "Your request has been sent for review.",
        description: "You will be notified when it has been decided.",
      });
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The request could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFailure(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>I represent this laboratory</Button>
      </DialogTrigger>
      <DialogContent
        title={`Represent ${laboratoryName}`}
        description="A programme administrator, a member of the core team or a coordinator of the laboratory reviews your request. The portal checks your profile and your address for evidence."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="Nothing was sent." description={failure} />}
          <FormField
            label="Your role"
            hint="A coordinator maintains the laboratory in the portal. A representative speaks for it."
          >
            {(control) => (
              <Select
                {...control}
                value={role}
                onChange={(event) => setRole(event.target.value === "coordinator" ? "coordinator" : "representative")}
              >
                <option value="representative">Authorised representative</option>
                <option value="coordinator">Coordinator</option>
              </Select>
            )}
          </FormField>
          <FormField label="Message to the reviewer" hint="Optional. How you are connected to the laboratory.">
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={2_000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              Send the request
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
