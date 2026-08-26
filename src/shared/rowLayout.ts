/**
 * Row layout utilities for the pane grid system.
 *
 * A `rowLayout` is an array of numbers where each entry is the column count
 * for that row. The flat `panes` array is partitioned into rows according to
 * this layout. Example: rowLayout [2, 3] with panes [A,B,C,D,E] means
 * Row 0: [A,B], Row 1: [C,D,E].
 *
 * When rowLayout is undefined, defaults to a single row containing all panes.
 */

/** Return the effective rowLayout (defaults to single row). */
export function effectiveRowLayout(paneCount: number, rowLayout?: number[]): number[] {
  return rowLayout && rowLayout.length > 0 ? rowLayout : [paneCount];
}

/** Convert a flat pane index to (row, col) given a rowLayout. */
export function paneIndexToRowCol(
  rowLayout: number[],
  paneIndex: number,
): { row: number; col: number; rowStart: number } {
  let offset = 0;
  for (let r = 0; r < rowLayout.length; r++) {
    if (paneIndex < offset + rowLayout[r]!) {
      return { row: r, col: paneIndex - offset, rowStart: offset };
    }
    offset += rowLayout[r]!;
  }
  // Past end — treat as last row
  const lastStart = rowLayout.slice(0, -1).reduce((a, b) => a + b, 0);
  return { row: rowLayout.length - 1, col: paneIndex - lastStart, rowStart: lastStart };
}

/** Increment the column count for the row containing `flatIndex`. */
export function addToRowLayout(rowLayout: number[], flatIndex: number): number[] {
  const { row } = paneIndexToRowCol(rowLayout, flatIndex);
  const result = [...rowLayout];
  result[row]!++;
  return result;
}

/** Insert a new single-pane row at position `rowIndex`. */
export function insertRowInLayout(rowLayout: number[], rowIndex: number): number[] {
  const result = [...rowLayout];
  result.splice(rowIndex, 0, 1);
  return result;
}

/** Decrement the column count for the row containing `flatIndex`.
 *  Removes the row entirely if it becomes empty. */
export function removeFromRowLayout(rowLayout: number[], flatIndex: number): number[] {
  const { row } = paneIndexToRowCol(rowLayout, flatIndex);
  const result = [...rowLayout];
  result[row]!--;
  if (result[row] === 0) result.splice(row, 1);
  return result;
}

/** Remove multiple pane indices from the rowLayout. */
export function removeIndicesFromRowLayout(
  rowLayout: number[],
  removedIndices: Set<number>,
): number[] {
  const result: number[] = [];
  let offset = 0;
  for (let r = 0; r < rowLayout.length; r++) {
    let count = 0;
    for (let c = 0; c < rowLayout[r]!; c++) {
      if (!removedIndices.has(offset + c)) count++;
    }
    if (count > 0) result.push(count);
    offset += rowLayout[r]!;
  }
  return result;
}
