type ShouldCloseCodeEditorOptions = {
  isDirty: boolean;
  confirm: () => boolean;
};

export function shouldCloseCodeEditor({ isDirty, confirm }: ShouldCloseCodeEditorOptions): boolean {
  return !isDirty || confirm();
}
