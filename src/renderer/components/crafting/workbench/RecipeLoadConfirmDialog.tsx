import { Button, Modal } from "@heroui/react";

/**
 * Load Recipe confirmation: shown when the current draft is non-empty and the
 * user clicks a recipe in the quick list / My Recipes page. Loading a recipe
 * replaces the current draft content — it never runs the recipe.
 */
export function RecipeLoadConfirmDialog(props: {
  open: boolean;
  systemName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { open, systemName, onCancel, onConfirm } = props;
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onCancel()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[420px]" data-testid="recipe-load-dialog">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>加载配方</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 pb-5 pt-2">
            <p className="text-sm text-neutral-300">加载该配方将替换当前合成内容</p>
            <p className="mt-1 text-[11px] text-neutral-500">{systemName}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="ghost" className="text-muted" onPress={onCancel}>
              取消
            </Button>
            <Button variant="primary" onPress={onConfirm} data-testid="confirm-load-recipe">
              加载
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
