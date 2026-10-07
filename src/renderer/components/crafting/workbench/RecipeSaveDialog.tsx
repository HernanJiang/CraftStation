import { useState } from "react";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import type { CapabilityResolution } from "@/shared/crafting/workbenchTypes";
import { useLingui } from "@lingui/react/macro";

/**
 * Saving a compatible Recipe does not launch it or claim runtime verification.
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
  const { t } = useLingui();
  const { open, systemName, resolution, duplicateCount, onClose, onSave } = props;
  const [alias, setAlias] = useState("");
  const canSave = resolution.status === "NATIVE" || resolution.status === "CRAFTABLE";
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[420px]" data-testid="recipe-save-dialog">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t`保存配方`}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 pb-5 pt-2">
            <div>
              <p className="text-[11px] text-neutral-500">{t`系统组合名`}</p>
              <p
                className="mt-0.5 text-sm font-medium text-foreground"
                data-testid="recipe-system-name"
              >
                {systemName}
              </p>
            </div>
            {resolution.status === "CRAFTABLE" ? (
              <p className="mt-2 text-[11px] text-amber-300/80">
                {t`此配方通过兼容桥运行；启动时会再次检查运行环境与模型可用性。`}
              </p>
            ) : null}
            {duplicateCount > 0 ? (
              <p className="mt-2 text-[11px] text-neutral-400">
                {t`已有 ${duplicateCount} 个使用相同组件的配方`}
              </p>
            ) : null}
            <TextField
              value={alias}
              onChange={setAlias}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSave)
                  onSave(alias.trim() ? alias.trim() : undefined);
              }}
              className="mt-3"
            >
              <Label>{t`别名（可选）`}</Label>
              <Input placeholder={t`例如：日常编码组合`} />
            </TextField>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="ghost" className="text-muted" onPress={onClose}>
              {t`取消`}
            </Button>
            <Button
              variant="primary"
              onPress={() => onSave(alias.trim() ? alias.trim() : undefined)}
              isDisabled={!canSave}
              data-testid="confirm-save-recipe"
            >
              {t`保存配方`}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
