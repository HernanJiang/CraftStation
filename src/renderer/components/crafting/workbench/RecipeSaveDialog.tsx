import { useState } from "react";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import type { CapabilityResolution } from "@/shared/crafting/workbenchTypes";

/**
 * Save Recipe dialog: shown when the user clicks "合成" on a verified NATIVE
 * combination. Only saves a StoredRecipe — it never launches a Thread/Agent.
 * The system name is auto-composed and the alias is an optional subtitle.
 */
export function RecipeSaveDialog(props: {
  open: boolean;
  systemName: string;
  resolution: CapabilityResolution;
  duplicateCount: number;
  onClose: () => void;
  onSave: (alias?: string) => void;
}) {
  const { open, systemName, resolution, duplicateCount, onClose, onSave } = props;
  const [alias, setAlias] = useState("");
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[420px]" data-testid="recipe-save-dialog">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>保存配方</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 pb-5 pt-2">
            <div>
              <p className="text-[11px] text-neutral-500">系统组合名</p>
              <p
                className="mt-0.5 text-sm font-medium text-foreground"
                data-testid="recipe-system-name"
              >
                {systemName}
              </p>
            </div>
            {resolution.status === "CRAFTABLE" ? (
              <p className="mt-2 text-[11px] text-amber-300/80">
                Compatibility 尚未完成运行时验证，不能保存
              </p>
            ) : null}
            {duplicateCount > 0 ? (
              <p className="mt-2 text-[11px] text-neutral-400">
                已有 {duplicateCount} 个使用相同组件的配方
              </p>
            ) : null}
            <TextField
              value={alias}
              onChange={setAlias}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSave(alias.trim() ? alias.trim() : undefined);
              }}
              className="mt-3"
            >
              <Label>别名（可选）</Label>
              <Input placeholder="例如：日常编码组合" />
            </TextField>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="ghost" className="text-muted" onPress={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              onPress={() => onSave(alias.trim() ? alias.trim() : undefined)}
              isDisabled={resolution.status !== "NATIVE"}
              data-testid="confirm-save-recipe"
            >
              保存配方
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
