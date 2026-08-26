/**
 * Provider-agnostic builder for `question_answer` chat items.
 *
 * Each adapter that surfaces a multi-question user-input form to the renderer
 * (Claude SDK `AskUserQuestion`, Codex `item/tool/requestUserInput`, OpenCode
 * `question.*`, etc.) translates its native question shape into the
 * `QuestionAnswerSourceQuestion` shape below, hands it to this builder with
 * the renderer's raw response, and emits the resulting events so the chat
 * timeline shows a structured trace of what the user picked.
 */

import type { QuestionAnswerEntry, RuntimeEvent } from "@/shared/contracts";
import { chosenOptionIds } from "./questionAnswers";

export interface QuestionAnswerSourceOption {
  optionId: string;
  label: string;
  description?: string;
}

export interface QuestionAnswerSourceQuestion {
  /** Stable lookup keys for this question in the renderer's response map. */
  keys: string[];
  header: string;
  question: string;
  options: readonly QuestionAnswerSourceOption[];
}

export function buildQuestionAnswerEvents(input: {
  threadId: string;
  itemId: string;
  questions: readonly QuestionAnswerSourceQuestion[];
  /** Map keyed by any of the question's `keys` → raw response value. */
  answers: Record<string, unknown>;
}): RuntimeEvent[] {
  const entries = collectQuestionAnswerEntries(input.questions, input.answers);
  if (entries.length === 0) return [];
  return [
    {
      type: "item.started",
      threadId: input.threadId,
      itemId: input.itemId,
      itemType: "question_answer",
      payload: { questions: entries },
    },
    { type: "item.completed", threadId: input.threadId, itemId: input.itemId },
  ];
}

function collectQuestionAnswerEntries(
  questions: readonly QuestionAnswerSourceQuestion[],
  answers: Record<string, unknown>,
): QuestionAnswerEntry[] {
  const entries: QuestionAnswerEntry[] = [];
  for (const question of questions) {
    const raw = resolveAnswerValue(answers, question.keys);
    const chosen = chosenOptionIds(raw);
    const selected: QuestionAnswerEntry["selected"] = [];
    const customTokens: string[] = [];
    for (const id of chosen) {
      const match = question.options.find((opt) => opt.optionId === id);
      if (match) {
        selected.push({
          label: match.label,
          ...(match.description ? { description: match.description } : {}),
        });
      } else {
        customTokens.push(id);
      }
    }
    if (selected.length === 0 && customTokens.length === 0) continue;
    entries.push({
      header: question.header,
      question: question.question,
      selected,
      ...(customTokens.length > 0 ? { customAnswer: customTokens.join("\n") } : {}),
    });
  }
  return entries;
}

function resolveAnswerValue(answers: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(answers, key)) return answers[key];
  }
  return undefined;
}
