// NewWorktreeModal.tsx — hosts the deduce/create form; on create, assigns the worktree to a slot and closes.
import { Modal } from "./Modal";
import { NewWorktreeForm } from "../tiles/worktree/NewWorktreeForm";
import { useSettings } from "../settings/store";

export function NewWorktreeModal({ onClose }: { onClose: () => void }) {
  const { assignNewWorktreeSlot } = useSettings();
  return (
    <Modal title="New worktree" onClose={onClose}>
      <NewWorktreeForm onCreated={(id) => { assignNewWorktreeSlot(id); onClose(); }} />
    </Modal>
  );
}
