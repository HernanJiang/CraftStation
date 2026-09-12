// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/renderer/i18n/i18n";
import { CsvPreview, parseCsvRows } from "./CsvPreview";

function renderPreview(content: string) {
  return render(
    <I18nProvider i18n={i18n}>
      <CsvPreview content={content} />
    </I18nProvider>,
  );
}

describe("parseCsvRows", () => {
  it("handles quoted fields, escaped quotes and embedded newlines", () => {
    expect(parseCsvRows(`a,"b,c","d""e"\n1,2,"x\ny"`, ",")).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "2", "x\ny"],
    ]);
  });
});

describe("CsvPreview", () => {
  it("renders a header plus body rows and sniffs semicolons", () => {
    renderPreview("name;age\nAda;36\nGrace;85\n");

    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
  });

  it("truncates long tables with a note", () => {
    const content = `h\n${Array.from({ length: 300 }, (_, i) => `r${i}`).join("\n")}\n`;
    renderPreview(content);

    expect(screen.getByText("r0")).toBeInTheDocument();
    expect(screen.queryByText("r299")).not.toBeInTheDocument();
    expect(screen.getByText("Preview truncated — open the file for the full table.")).toBeInTheDocument();
  });

  it("shows an empty state for blank files", () => {
    renderPreview("\n");

    expect(screen.getByText("Empty CSV file.")).toBeInTheDocument();
  });
});
