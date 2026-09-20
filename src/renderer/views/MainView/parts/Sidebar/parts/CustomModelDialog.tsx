import { useEffect, useState } from "react";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { Check, Download, Loader2, Lock } from "lucide-react";
import { Select } from "@/renderer/components/common";
import {
  effortPresetForProvider,
  parseEffortTiers,
} from "@/renderer/components/thread/customModelCatalog";

export const DEFAULT_MODEL_CONTEXT_WINDOW = "1000000";
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = "128000";
export const MODEL_MODALITY_OPTIONS = [
  { id: "text", label: "文本" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "pdf", label: "PDF" },
] as const;

export interface CustomModelDialogValues {
  modelId: string;
  displayName: string;
  contextSize: string;
  maxOutputTokens: string;
  inputModalities: string[];
  outputModalities: string[];
  /** 手写思考档位（空＝跟随渠道默认）。 */
  efforts: string[];
  /** 默认思考强度（需在档位内，空＝跟随）。 */
  defaultEffort: string;
}

/** 复用给「管理模型」页的行内编辑：同一套模态选项与交互。 */
export function ModalityGroup(props: {
  legend: string;
  values: string[];
  locked?: readonly string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs text-neutral-400">{props.legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {MODEL_MODALITY_OPTIONS.map((option) => {
          const checked = props.values.includes(option.id);
          const locked = props.locked?.includes(option.id) === true;
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                checked
                  ? "border-white/25 bg-white/10 text-foreground"
                  : "border-white/10 text-neutral-400 hover:bg-white/5"
              } ${locked ? "cursor-default opacity-90" : ""}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                disabled={locked}
                onChange={() =>
                  props.onChange(
                    checked
                      ? props.values.filter((id) => id !== option.id)
                      : [...props.values, option.id],
                  )
                }
              />
              <span
                className={`flex size-3.5 items-center justify-center rounded border ${
                  checked ? "border-white/40 bg-white text-black" : "border-white/20"
                }`}
              >
                {checked ? <Check className="size-2.5" /> : null}
              </span>
              {option.label}
              {locked ? (
                <Lock className="size-3 text-neutral-500" aria-label="文本输入恒选" />
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * 添加模型对话框（参考第三方客户端）：模型 ID、上下文窗口、最大输出
 * Token、输入/输出类型，全部带默认值，开箱即用。保存后走与原来一致的
 * verifiedAdd 验证链路（账号渠道需探通才入库）。
 */
export function CustomModelDialog(props: {
  open: boolean;
  initialModelId: string;
  initialDisplayName: string;
  /** 渠道 kind，用于思考档位预设（如 codex/grok/kimi）。 */
  providerKind: string;
  /** 上游模型拉取（账号渠道）：返回精确上游 id 列表；缺省则无拉取入口。 */
  onFetchUpstreamModels?: () => Promise<string[]>;
  verifying: boolean;
  onCancel: () => void;
  onSave: (values: CustomModelDialogValues) => void;
}) {
  const preset = effortPresetForProvider(props.providerKind);
  const [modelId, setModelId] = useState(props.initialModelId);
  const [displayName, setDisplayName] = useState(props.initialDisplayName);
  const [contextSize, setContextSize] = useState(DEFAULT_MODEL_CONTEXT_WINDOW);
  const [maxOutputTokens, setMaxOutputTokens] = useState(DEFAULT_MODEL_MAX_OUTPUT_TOKENS);
  const [inputModalities, setInputModalities] = useState<string[]>(["text"]);
  const [outputModalities, setOutputModalities] = useState<string[]>(["text"]);
  const [effortTiers, setEffortTiers] = useState("");
  const [defaultEffort, setDefaultEffort] = useState("");
  const [upstream, setUpstream] = useState<{ loading: boolean; error?: string; models: string[] }>({
    loading: false,
    models: [],
  });

  useEffect(() => {
    if (!props.open) return;
    setModelId(props.initialModelId);
    setDisplayName(props.initialDisplayName);
    setContextSize(DEFAULT_MODEL_CONTEXT_WINDOW);
    setMaxOutputTokens(DEFAULT_MODEL_MAX_OUTPUT_TOKENS);
    setInputModalities(["text"]);
    setOutputModalities(["text"]);
    setEffortTiers("");
    setDefaultEffort("");
    setUpstream({ loading: false, models: [] });
  }, [props.open, props.initialModelId, props.initialDisplayName]);

  if (!props.open) return null;
  const canSave = modelId.trim().length > 0 && !props.verifying;
  const parsedTiers = parseEffortTiers(effortTiers);
  const fetchUpstream = async () => {
    if (!props.onFetchUpstreamModels || upstream.loading) return;
    setUpstream({ loading: true, models: [] });
    try {
      const models = await props.onFetchUpstreamModels();
      setUpstream({ loading: false, models });
    } catch (error) {
      setUpstream({
        loading: false,
        models: [],
        error: error instanceof Error ? error.message : "拉取失败",
      });
    }
  };
  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && props.onCancel()}>
      <Modal.Container placement="center" size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>添加模型</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-3 p-4">
            <TextField>
              <Label>模型 ID</Label>
              <Input
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                placeholder="模型 ID"
              />
            </TextField>
            <TextField>
              <Label>展示名称（可选）</Label>
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="展示名称（可选）"
              />
            </TextField>
            <TextField>
              <Label>上下文窗口</Label>
              <Input
                value={contextSize}
                onChange={(event) => setContextSize(event.target.value)}
                placeholder={DEFAULT_MODEL_CONTEXT_WINDOW}
              />
            </TextField>
            <TextField>
              <Label>最大输出 Token</Label>
              <Input
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.target.value)}
                placeholder={DEFAULT_MODEL_MAX_OUTPUT_TOKENS}
              />
            </TextField>
            <ModalityGroup
              legend="输入类型"
              values={inputModalities}
              locked={["text"]}
              onChange={setInputModalities}
            />
            <ModalityGroup
              legend="输出类型"
              values={outputModalities}
              onChange={setOutputModalities}
            />
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">思考强度档位（逗号分隔，手写）</span>
                <button
                  type="button"
                  onClick={() => {
                    setEffortTiers(preset.tiers.join(", "));
                    setDefaultEffort(preset.def);
                  }}
                  className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-white/10 hover:text-white"
                >
                  用{props.providerKind || "通用"}预设
                </button>
              </div>
              <TextField>
                <Label className="sr-only">思考强度档位</Label>
                <Input
                  value={effortTiers}
                  onChange={(event) => {
                    setEffortTiers(event.target.value);
                    const next = parseEffortTiers(event.target.value);
                    if (defaultEffort && !next.includes(defaultEffort)) setDefaultEffort("");
                  }}
                  placeholder={preset.tiers.join(", ")}
                />
              </TextField>
              <p className="mt-1 text-[10px] text-neutral-500">
                留空则跟随渠道默认；各厂商档位以其文档为准。
              </p>
              {parsedTiers.length > 0 ? (
                <div className="mt-1.5">
                  <Select
                    aria-label="默认思考强度"
                    className="w-full text-xs"
                    options={[
                      { id: "", label: "跟随渠道默认" },
                      ...parsedTiers.map((tier) => ({ id: tier, label: tier })),
                    ]}
                    value={defaultEffort}
                    onChange={setDefaultEffort}
                  />
                </div>
              ) : null}
            </div>
            {props.onFetchUpstreamModels ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs text-neutral-400">
                    上游模型（精确 id，避免手写错位）
                  </span>
                  <button
                    type="button"
                    onClick={() => void fetchUpstream()}
                    disabled={upstream.loading}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    {upstream.loading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3" />
                    )}
                    从上游拉取
                  </button>
                </div>
                {upstream.error ? (
                  <p className="text-[11px] text-red-400">{upstream.error}</p>
                ) : null}
                {upstream.models.length > 0 ? (
                  <ul className="max-h-32 overflow-y-auto rounded-lg border border-white/10">
                    {upstream.models.map((id) => (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => {
                            setModelId(id);
                            if (!displayName.trim()) setDisplayName(id);
                          }}
                          className="block w-full truncate px-2 py-1 text-left text-[11px] text-neutral-300 hover:bg-white/10 hover:text-white"
                          title={id}
                        >
                          {id}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button
              slot="close"
              variant="ghost"
              size="sm"
              className="text-muted"
              onPress={props.onCancel}
            >
              取消
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              className="text-white"
              isDisabled={!canSave}
              isPending={props.verifying}
              onPress={() =>
                props.onSave({
                  modelId: modelId.trim(),
                  displayName: displayName.trim(),
                  contextSize: contextSize.trim(),
                  maxOutputTokens: maxOutputTokens.trim(),
                  inputModalities,
                  outputModalities,
                  efforts: parsedTiers,
                  defaultEffort: defaultEffort.trim(),
                })
              }
            >
              保存
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
