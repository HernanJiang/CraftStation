// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/renderer/i18n/i18n";
import { NotebookPreview } from "./NotebookPreview";

function renderPreview(content: string) {
  return render(
    <I18nProvider i18n={i18n}>
      <NotebookPreview content={content} />
    </I18nProvider>,
  );
}

const notebook = JSON.stringify({
  nbformat: 4,
  cells: [
    { cell_type: "markdown", source: ["# Title\n", "Some *text*."] },
    {
      cell_type: "code",
      execution_count: 3,
      source: ['print("hi")'],
      outputs: [
        { output_type: "stream", name: "stdout", text: ["hi\n"] },
        { output_type: "error", ename: "ValueError", evalue: "bad" },
      ],
    },
  ],
});

describe("NotebookPreview", () => {
  it("renders markdown and code cells with outputs", () => {
    renderPreview(notebook);

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("In [3]:")).toBeInTheDocument();
    expect(screen.getByText('print("hi")')).toBeInTheDocument();
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("ValueError: bad")).toBeInTheDocument();
  });

  it("shows a fallback for invalid notebooks", () => {
    renderPreview("{ nope");

    expect(screen.getByText("Could not parse this notebook — open it as text instead.")).toBeInTheDocument();
  });

  it("shows an empty state without cells", () => {
    renderPreview(JSON.stringify({ nbformat: 4, cells: [] }));

    expect(screen.getByText("Empty notebook.")).toBeInTheDocument();
  });
});
