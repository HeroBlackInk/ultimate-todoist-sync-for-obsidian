/**
 * Reducing a vault task line to the text that is compared against Todoist.
 *
 * This is the comparator behind every "did the task change?" decision, so a
 * fragment left behind here — a second link, a stray id block — reads as an edit
 * the user never made, and produces a conflict on a line nobody touched.
 *
 * Kept free of imports so it can be unit-tested directly.
 */

const DUE_DATE_EMOJI = '🗓️|📅|📆|🗓';

/**
 * All markers are stripped globally and case-insensitively — Todoist's legacy
 * URL is `showTask`, camel-cased, which a lowercase pattern silently missed,
 * leaving the whole link in the compared text.
 *
 * All markers are stripped globally. A line can legitimately carry more than one
 * of several of these (older versions of the plugin could write a second link and
 * id block onto the same line), and a non-global strip left the extras in the
 * compared text.
 */
const STRIP_PATTERNS: RegExp[] = [
    // %%[todoist_id:: abc123]%%
    /%%\[\w+::\s*\w+\]%%/g,
    // [link](https://todoist.com/showtask?id=123)
    /\[([^\]]*)\]\(https?:\/\/todoist\.com\/showtask\?id=\S*\)/gi,
    // [link](https://app.todoist.com/app/task/abc123)
    /\[([^\]]*)\]\(https?:\/\/app\.todoist\.com\/app\/task\/\S*\)/gi,
    // [link](https://todoist.com/app/task/abc123) — old domain, new path
    /\[([^\]]*)\]\(https?:\/\/todoist\.com\/app\/task\/\S*\)/gi,
    // [link](todoist://task?id=abc123)
    /\[([^\]]*)\]\(todoist:\/\/task\?id=\S*\)/gi,
    // A bare task URL, which older builds and other plugins wrote without markdown
    /(?:^|\s)(?:https?:\/\/(?:app\.)?todoist\.com\/(?:app\/task\/|showtask\?id=)|todoist:\/\/task\?id=)\S+/gi,
];

const REMOVE_PRIORITY = /\s!!([1-4])\s/g;
const REMOVE_TAGS = /#[\w一-龥-]+/g;
const REMOVE_DUE_DATE = new RegExp(`(${DUE_DATE_EMOJI})\\s?\\d{4}-\\d{2}-\\d{2}`, 'g');
const REMOVE_CHECKBOX = /^(-|\*)\s+\[(x|X| )\]\s/;
const REMOVE_CHECKBOX_WITH_INDENTATION = /^([ \t]*)?(-|\*)\s+\[(x|X| )\]\s/;
const TRIM_EDGES = /^\s+|\s+$/g;

/**
 * The task text as Todoist stores it: no checkbox, tags, due date, priority,
 * links or plugin metadata.
 */
export function stripTaskContent(lineText: string): string {
    let content = lineText;
    for (const pattern of STRIP_PATTERNS) {
        content = content.replace(pattern, '');
    }

    return content
        .replace(REMOVE_PRIORITY, ' ')
        .replace(REMOVE_TAGS, '')
        .replace(REMOVE_DUE_DATE, '')
        .replace(REMOVE_CHECKBOX, '')
        .replace(REMOVE_CHECKBOX_WITH_INDENTATION, '')
        .replace(TRIM_EDGES, '');
}
