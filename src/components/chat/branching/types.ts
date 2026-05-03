export interface ConversationBranch {
  id: string;
  name: string;
  parentBranchId: string | null;
  branchPointMessageIndex: number;
  createdAt: string;
}

export interface BranchState {
  branches: ConversationBranch[];
  activeBranchId: string;
}

export interface BranchSelectorProps {
  branches: ConversationBranch[];
  activeBranchId: string;
  onSwitchBranch: (branchId: string) => void;
  onCreateBranch: (fromMessageIndex: number) => void;
  onRenameBranch: (branchId: string, name: string) => void;
  onDeleteBranch: (branchId: string) => void;
}
