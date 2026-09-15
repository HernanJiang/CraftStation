import type { RuntimeEvent } from "@/shared/contracts";
import type { CraftRequestResolution } from "@/shared/crafting";

type CraftedRequest = Extract<RuntimeEvent, { type: "request.opened" }>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function permissionResolution(response: unknown): CraftRequestResolution {
  const value = record(response);
  const decision = [value.optionId, value.decision, value.action].find(
    (candidate): candidate is string => typeof candidate === "string",
  );
  if (decision) {
    const normalized = decision.toLowerCase();
    const optionId = typeof value.optionId === "string" ? value.optionId : decision;
    if (normalized.includes("always") || normalized.includes("session")) {
      return { kind: "permission", response: "always", optionId };
    }
    if (
      normalized.includes("reject") ||
      normalized.includes("deny") ||
      normalized.includes("decline") ||
      normalized.includes("cancel")
    ) {
      return { kind: "permission", response: "reject", optionId };
    }
    if (
      normalized.includes("once") ||
      normalized.includes("allow") ||
      normalized.includes("accept") ||
      normalized.includes("approve")
    ) {
      return { kind: "permission", response: "once", optionId };
    }
  }
  throw new Error("Crafted permission response does not contain a recognized decision.");
}

interface SafeQuestion {
  readonly id: string;
  readonly custom: boolean;
  readonly multiSelect: boolean;
  readonly options: ReadonlyMap<string, string>;
}

function safeQuestions(request: CraftedRequest): SafeQuestion[] {
  const form = record(record(request.payload.details).userInputForm);
  const questions = Array.isArray(form.questions) ? form.questions : [];
  return questions.flatMap((value, index) => {
    const question = record(value);
    const id = typeof question.id === "string" ? question.id : `q${index}`;
    const options = new Map<string, string>();
    if (Array.isArray(question.options)) {
      for (const candidate of question.options) {
        const option = record(candidate);
        if (typeof option.optionId === "string" && typeof option.label === "string") {
          options.set(option.optionId, option.label);
        }
      }
    }
    return [
      {
        id,
        custom: question.custom === true,
        multiSelect: question.multiSelect === true || question.multiple === true,
        options,
      },
    ];
  });
}

function answerValues(value: unknown): string[] {
  const candidate =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : record(value).answers;
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error("Crafted question answer must contain at least one non-empty string.");
  }
  if (candidate.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error("Crafted question answer must contain only non-empty strings.");
  }
  return candidate.map((entry) => (entry as string).trim());
}

function normalizedQuestionRows(response: unknown, questions: readonly SafeQuestion[]): unknown[] {
  if (Array.isArray(response)) {
    if (response.length !== questions.length) {
      throw new Error("Crafted question response count does not match the request.");
    }
    return response;
  }

  const responseRecord = record(response);
  const rawAnswerMap = responseRecord.answers;
  if (!rawAnswerMap || typeof rawAnswerMap !== "object" || Array.isArray(rawAnswerMap)) {
    throw new Error("Crafted question response must contain an answers map.");
  }
  const answerMap = rawAnswerMap as Record<string, unknown>;
  const expectedIds = new Set(questions.map((question) => question.id));
  const receivedIds = Object.keys(answerMap);
  if (receivedIds.length !== expectedIds.size || receivedIds.some((id) => !expectedIds.has(id))) {
    throw new Error("Crafted question answer identities do not match the request.");
  }
  return questions.map((question) => answerMap[question.id]);
}

function questionResolution(request: CraftedRequest, response: unknown): CraftRequestResolution {
  const responseRecord = record(response);
  if (
    responseRecord.action === "cancel" ||
    responseRecord.action === "reject" ||
    responseRecord.decision === "cancel" ||
    responseRecord.decision === "reject"
  ) {
    return { kind: "question", action: "reject" };
  }
  const questions = safeQuestions(request);
  if (questions.length === 0) {
    throw new Error("Crafted question request has no safe question metadata.");
  }
  const rows = normalizedQuestionRows(response, questions);
  const answers = questions.map((question, index) => {
    const selected = answerValues(rows[index]);
    if (!question.multiSelect && selected.length > 1) {
      throw new Error(`Crafted question '${question.id}' is single-select.`);
    }
    return selected.map((value) => {
      const label = question.options.get(value);
      if (label) return label;
      if (question.custom) return value;
      throw new Error(`Crafted question '${question.id}' contains an unknown option.`);
    });
  });
  return { kind: "question", action: "answer", answers };
}

/** Convert the existing provider-agnostic Renderer response into the typed native Session seam. */
export function resolveCraftedRequest(
  request: CraftedRequest,
  response: unknown,
): CraftRequestResolution {
  return request.requestType === "tool_user_input"
    ? questionResolution(request, response)
    : permissionResolution(response);
}

export type { CraftedRequest };
