/**
 * Line-range diffing for sync writes into an open editor.
 *
 * Kept free of any `obsidian` import so it can be unit-tested directly; the
 * editor-facing wrapper lives in FileOperation.applyContentToEditor.
 */

export type EditorPosition = { line: number; ch: number };

export type EditorRangeEdit = {
    /** Text to insert. */
    text: string;
    from: EditorPosition;
    /** Omitted for a pure insertion, which inserts at `from`. */
    to?: EditorPosition;
};

/**
 * Smallest single-range edit that turns `oldContent` into `newContent`, or null
 * when they are already equal.
 *
 * Sync writes rebuild the whole file but usually change one line, so trimming the
 * common prefix and suffix keeps the edit narrow — which is what preserves the
 * user's cursor, selection and undo history when the write goes to a live editor.
 */
export function computeLineRangeEdit(oldContent: string, newContent: string): EditorRangeEdit | null {
    if (oldContent === newContent) return null;

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
        start++;
    }
    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
        oldEnd--;
        newEnd--;
    }

    if (oldEnd < start) {
        // Pure insertion of newLines[start..newEnd] before line `start`.
        const inserted = newLines.slice(start, newEnd + 1).join('\n');
        if (start > oldLines.length - 1) {
            // Appending past the last line: attach to the end of it instead, since
            // line `start` does not exist yet.
            const lastLine = oldLines.length - 1;
            return { text: `\n${inserted}`, from: { line: lastLine, ch: oldLines[lastLine].length } };
        }
        return { text: `${inserted}\n`, from: { line: start, ch: 0 } };
    }

    const from: EditorPosition = { line: start, ch: 0 };
    const to: EditorPosition = { line: oldEnd, ch: oldLines[oldEnd].length };

    if (newEnd < start) {
        // Pure deletion — also consume the newline that joined the removed block.
        if (oldEnd + 1 < oldLines.length) {
            return { text: '', from, to: { line: oldEnd + 1, ch: 0 } };
        }
        if (start > 0) {
            return { text: '', from: { line: start - 1, ch: oldLines[start - 1].length }, to };
        }
        return { text: '', from, to };
    }

    return { text: newLines.slice(start, newEnd + 1).join('\n'), from, to };
}
