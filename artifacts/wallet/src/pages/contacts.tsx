import React, { useState, useEffect } from "react";
import { Shell } from "@/components/layout/shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookUser, Plus, Trash2, Pencil, Copy, Check, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import {
  type Contact,
  loadContacts,
  addContact,
  updateContact,
  deleteContact,
} from "@/lib/contacts";

// ── copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className="text-muted-foreground hover:text-foreground transition-colors"
      title="Copy address"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── contact form ──────────────────────────────────────────────────────────────
interface FormState { name: string; address: string; notes: string }
const EMPTY: FormState = { name: "", address: "", notes: "" };

function ContactForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: FormState;
  onSave: (v: FormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial ?? EMPTY);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  const validate = () => {
    const e: Partial<FormState> = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!form.address.startsWith("0x") || form.address.length < 42)
      e.address = "Must be a valid 0x address";
    return e;
  };

  const submit = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    onSave(form);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
          Name
        </Label>
        <Input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Mining Rig, Alice"
          className={errors.name ? "border-destructive" : ""}
        />
        {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
      </div>
      <div>
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
          Address
        </Label>
        <Input
          value={form.address}
          onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          placeholder="0x..."
          className={cn("font-mono text-xs", errors.address ? "border-destructive" : "")}
        />
        {errors.address && <p className="text-xs text-destructive mt-1">{errors.address}</p>}
      </div>
      <div>
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
          Notes <span className="normal-case font-normal">(optional)</span>
        </Label>
        <Input
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Any notes about this contact"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <Button onClick={submit} className="flex-1">Save Contact</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [, navigate] = useLocation();

  const reload = () => setContacts(loadContacts());
  useEffect(reload, []);

  const handleAdd = (form: FormState) => {
    addContact({ name: form.name.trim(), address: form.address.trim(), notes: form.notes.trim() || undefined });
    reload();
    setShowAdd(false);
  };

  const handleEdit = (form: FormState) => {
    if (!editing) return;
    updateContact(editing.id, { name: form.name.trim(), address: form.address.trim(), notes: form.notes.trim() || undefined });
    reload();
    setEditing(null);
  };

  const handleDelete = () => {
    if (!deleting) return;
    deleteContact(deleting.id);
    reload();
    setDeleting(null);
  };

  return (
    <Shell requireWallet={false}>
      <div className="max-w-2xl mx-auto w-full">
        {/* header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3">
              <BookUser className="w-8 h-8 text-primary" /> Address Book
            </h1>
            <p className="text-muted-foreground font-sans text-sm uppercase tracking-widest font-bold">
              Save and label frequently used addresses.
            </p>
          </div>
          <Button onClick={() => setShowAdd(true)} className="shrink-0">
            <Plus className="w-4 h-4 mr-2" /> Add Contact
          </Button>
        </div>

        {/* list */}
        {contacts.length === 0 ? (
          <Card className="border-border bg-card/50 p-12 text-center">
            <BookUser className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-sm">
              No contacts yet
            </p>
            <p className="text-muted-foreground text-xs mt-1">
              Add addresses you send EMBR to regularly.
            </p>
            <Button onClick={() => setShowAdd(true)} className="mt-4" variant="outline">
              <Plus className="w-4 h-4 mr-2" /> Add your first contact
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {contacts.map((c) => (
              <Card key={c.id} className="border-border bg-card/80 p-4 flex items-center gap-4">
                {/* avatar */}
                <div className="w-10 h-10 rounded-sm bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 font-display font-bold text-primary text-lg uppercase">
                  {c.name[0]}
                </div>
                {/* info */}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-foreground text-sm">{c.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-xs text-muted-foreground truncate">
                      {c.address.slice(0, 10)}…{c.address.slice(-8)}
                    </span>
                    <CopyButton text={c.address} />
                  </div>
                  {c.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.notes}</p>
                  )}
                </div>
                {/* actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => navigate(`/send?to=${encodeURIComponent(c.address)}`)}
                    className="p-2 text-muted-foreground hover:text-primary transition-colors"
                    title="Send EMBR"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setEditing(c)}
                    className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleting(c)}
                    className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* add dialog */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display uppercase tracking-tight">Add Contact</DialogTitle>
            </DialogHeader>
            <ContactForm onSave={handleAdd} onCancel={() => setShowAdd(false)} />
          </DialogContent>
        </Dialog>

        {/* edit dialog */}
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display uppercase tracking-tight">Edit Contact</DialogTitle>
            </DialogHeader>
            {editing && (
              <ContactForm
                initial={{ name: editing.name, address: editing.address, notes: editing.notes ?? "" }}
                onSave={handleEdit}
                onCancel={() => setEditing(null)}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* delete confirm */}
        <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display uppercase tracking-tight">Remove Contact</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mb-4">
              Remove <span className="text-foreground font-bold">{deleting?.name}</span> from your address book? This only removes the label — no funds are affected.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={handleDelete} className="flex-1">Remove</Button>
              <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Shell>
  );
}
