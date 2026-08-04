// Unit tests for computeLineRangeEdit (src/vault/editorContentDiff.ts).
//
// Run with `npm test`, which compiles the module under test to tests/.build first.
//
// Sync writes go through an open editor as a single range replacement, so a wrong
// range silently corrupts the user's note. Every case here asserts two things:
// applying the edit reproduces the target content exactly, and the positions it
// reports are in range for the document it is applied to.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeLineRangeEdit } from '../.build/vault/editorContentDiff.mjs';

/** Minimal stand-in for Obsidian's Editor, strict about out-of-range positions. */
class FakeEditor {
	constructor(text) {
		this.text = text;
	}

	getValue() {
		return this.text;
	}

	#offset(pos, label) {
		const lines = this.text.split('\n');
		assert.ok(
			pos.line >= 0 && pos.line < lines.length,
			`${label}.line ${pos.line} out of range (0..${lines.length - 1})`
		);
		assert.ok(
			pos.ch >= 0 && pos.ch <= lines[pos.line].length,
			`${label}.ch ${pos.ch} out of range on line ${pos.line} (0..${lines[pos.line].length})`
		);
		let offset = 0;
		for (let i = 0; i < pos.line; i++) offset += lines[i].length + 1;
		return offset + pos.ch;
	}

	replaceRange(replacement, from, to) {
		const start = this.#offset(from, 'from');
		const end = to === undefined ? start : this.#offset(to, 'to');
		assert.ok(end >= start, 'to must not precede from');
		this.text = this.text.slice(0, start) + replacement + this.text.slice(end);
	}
}

function applyEdit(oldContent, newContent) {
	const editor = new FakeEditor(oldContent);
	const edit = computeLineRangeEdit(oldContent, newContent);
	if (edit) editor.replaceRange(edit.text, edit.from, edit.to);
	return editor.getValue();
}

function assertRoundTrip(oldContent, newContent, label) {
	assert.equal(applyEdit(oldContent, newContent), newContent, label);
}

const TASK = '- [ ] buy milk #todoist';
const TASK_WITH_ID = '- [ ] buy milk [link](todoist://task?id=1) #todoist %%[todoist_id:: 1]%%';

test('returns null when content is unchanged', () => {
	assert.equal(computeLineRangeEdit('a\nb', 'a\nb'), null);
});

test('writes a todoist_id back onto the task line', () => {
	assertRoundTrip(TASK, TASK_WITH_ID, 'single-line document');
	assertRoundTrip(`# Notes\n${TASK}\ntail`, `# Notes\n${TASK_WITH_ID}\ntail`, 'mid document');
	assertRoundTrip(`# Notes\n${TASK}`, `# Notes\n${TASK_WITH_ID}`, 'last line');
	assertRoundTrip(`${TASK}\ntail`, `${TASK_WITH_ID}\ntail`, 'first line');
});

test('touches only the changed line', () => {
	const edit = computeLineRangeEdit('a\n- [ ] x\nb', 'a\n- [x] x\nb');
	assert.deepEqual(edit.from, { line: 1, ch: 0 });
	assert.deepEqual(edit.to, { line: 1, ch: '- [ ] x'.length });
	assert.equal(edit.text, '- [x] x');
});

test('inserts lines (note sync)', () => {
	assertRoundTrip('a\n- [ ] x\nb', 'a\n- [ ] x\n\t- note\nb', 'after a middle line');
	assertRoundTrip('a\n- [ ] x', 'a\n- [ ] x\n\t- note', 'after the last line');
	assertRoundTrip('a\nb', 'new\na\nb', 'at the very start');
	assertRoundTrip('a\nb', 'a\nX\nY\nb', 'two lines at once');
	assertRoundTrip('', 'a\nb', 'into an empty document');
	assertRoundTrip('a', 'a\n', 'trailing blank line');
});

test('deletes lines', () => {
	assertRoundTrip('a\nX\nb', 'a\nb', 'from the middle');
	assertRoundTrip('a\nX', 'a', 'the last line');
	assertRoundTrip('X\na', 'a', 'the first line');
	assertRoundTrip('X\nY\nZ', 'Y', 'all but one');
	assertRoundTrip('a\nb', '', 'the whole document');
	assertRoundTrip('a\n', 'a', 'trailing blank line');
	assertRoundTrip('a', '', 'a single-line document');
});

test('handles repeated lines without drifting', () => {
	assertRoundTrip('x\nx\nx', 'x\ny\nx', 'middle changed');
	assertRoundTrip('x\nx\nx', 'x\nx', 'one removed');
	assertRoundTrip('x\nx', 'x\nx\nx', 'one added');
});

test('replaces wholesale when nothing is in common', () => {
	assertRoundTrip('a\nb\nc', 'x\ny\nz');
});

test('round-trips randomised document pairs', () => {
	const alphabet = ['a', 'b', 'c', '', '- [ ] t #todoist', '\t- note'];
	const pick = (n) => Math.floor(Math.random() * n);
	const randomDoc = () =>
		Array.from({ length: pick(6) }, () => alphabet[pick(alphabet.length)]).join('\n');

	for (let i = 0; i < 20000; i++) {
		const oldContent = randomDoc();
		const newContent = randomDoc();
		assert.equal(
			applyEdit(oldContent, newContent),
			newContent,
			`iteration ${i}: ${JSON.stringify(oldContent)} -> ${JSON.stringify(newContent)}`
		);
	}
});
