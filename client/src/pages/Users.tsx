import { useState, type FormEvent } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, KeyRound, Trash2, ShieldCheck, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

type Role = "admin" | "user";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") {
    return (
      <Badge className="bg-blue-100 text-blue-800 border-blue-200">
        <ShieldCheck className="w-3 h-3 mr-1" />
        Admin
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <UserIcon className="w-3 h-3 mr-1" />
      User
    </Badge>
  );
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const utils = trpc.useUtils();
  const usersQuery = trpc.users.list.useQuery();

  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<
    | { id: number; email: string | null }
    | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { id: number; email: string | null; role: string }
    | null
  >(null);

  const createMutation = trpc.users.create.useMutation({
    onSuccess: async (created) => {
      toast.success(`Created ${created.email}`);
      setCreateOpen(false);
      await utils.users.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetMutation = trpc.users.resetPassword.useMutation({
    onSuccess: async () => {
      toast.success("Password updated");
      setResetTarget(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.users.delete.useMutation({
    onSuccess: async () => {
      toast.success("User deleted");
      setDeleteTarget(null);
      await utils.users.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setRoleMutation = trpc.users.setRole.useMutation({
    onSuccess: async () => {
      toast.success("Role updated");
      await utils.users.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage admin and user accounts. Users can sign in and trigger
            inventory-only exports; admins have full access.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add user
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Accounts</CardTitle>
          <CardDescription>
            {usersQuery.data
              ? `${usersQuery.data.length} account${usersQuery.data.length === 1 ? "" : "s"}`
              : "Loading..."}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {usersQuery.isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(usersQuery.data ?? []).map((u) => {
                  const isSelf = currentUser?.id === u.id;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.email ?? <span className="text-muted-foreground italic">no email</span>}
                        {isSelf && (
                          <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                        )}
                      </TableCell>
                      <TableCell>{u.name ?? "—"}</TableCell>
                      <TableCell>
                        <Select
                          value={u.role}
                          onValueChange={(value) => {
                            const role = value as Role;
                            if (role === u.role) return;
                            setRoleMutation.mutate({ id: u.id, role });
                          }}
                          disabled={
                            isSelf || setRoleMutation.isPending || !u.email
                          }
                        >
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue>
                              <RoleBadge role={u.role} />
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="user">User</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(u.lastSignedIn)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setResetTarget({ id: u.id, email: u.email })
                            }
                            disabled={!u.email}
                            title="Reset password"
                          >
                            <KeyRound className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              setDeleteTarget({
                                id: u.id,
                                email: u.email,
                                role: u.role,
                              })
                            }
                            disabled={isSelf}
                            title={isSelf ? "Cannot delete yourself" : "Delete user"}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        submitting={createMutation.isPending}
        onSubmit={(values) => createMutation.mutate(values)}
      />

      <ResetPasswordDialog
        target={resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        submitting={resetMutation.isPending}
        onSubmit={(password) =>
          resetTarget && resetMutation.mutate({ id: resetTarget.id, password })
        }
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the account
              {deleteTarget?.email ? ` "${deleteTarget.email}"` : ""}. Their
              past export jobs and files stay in the database. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
              }}
            >
              {deleteMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type CreateUserValues = {
  email: string;
  name: string;
  role: Role;
  password: string;
};

function CreateUserDialog({
  open,
  onOpenChange,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  onSubmit: (values: CreateUserValues) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [password, setPassword] = useState("");

  // Reset whenever the dialog is freshly opened
  function handleOpenChange(next: boolean) {
    if (next) {
      setEmail("");
      setName("");
      setRole("user");
      setPassword("");
    }
    onOpenChange(next);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    onSubmit({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role,
      password,
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Create a new account. Share the password with them through a
            secure channel — they can change it later from this page.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Name</Label>
            <Input
              id="new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role">Role</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as Role)}
              disabled={submitting}
            >
              <SelectTrigger id="new-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User — inventory exports only</SelectItem>
                <SelectItem value="admin">Admin — full access</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Initial password</Label>
            <Input
              id="new-password"
              type="text"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={4}
              required
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Minimum 4 characters.</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  target,
  onOpenChange,
  submitting,
  onSubmit,
}: {
  target: { id: number; email: string | null } | null;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");

  function handleOpenChange(next: boolean) {
    if (next) setPassword("");
    onOpenChange(next);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    onSubmit(password);
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {target?.email ?? "this user"}. They will
            need to use it on their next sign-in; existing sessions remain
            valid until they expire.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="text"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={4}
              required
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Minimum 4 characters.</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
