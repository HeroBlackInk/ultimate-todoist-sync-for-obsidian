// Unit tests for stripTaskContent (src/data/taskContent.ts).
//
// Run with `npm test`.
//
// This is what a vault line is reduced to before being compared with Todoist.
// Anything left behind reads as a local edit, so the line gets pushed — or, with
// a revision mismatch, reported as a conflict on a task nobody touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stripTaskContent } from '../.build/data/taskContent.mjs';

const ID = '6X7rfFVPjhLTMwsz';
const META = `%%[todoist_id:: ${ID}]%%`;

test('strips checkbox, tag and id metadata', () => {
	assert.equal(stripTaskContent(`- [ ] buy milk #todoist ${META}`), 'buy milk');
	assert.equal(stripTaskContent(`- [x] buy milk #todoist ${META}`), 'buy milk');
	assert.equal(stripTaskContent(`\t- [ ] buy milk #todoist ${META}`), 'buy milk');
});

test('strips every link format the plugin has written', () => {
	const links = [
		// Todoist's pre-migration URL is camel-cased; a lowercase-only pattern
		// missed it and left the whole link in the compared content.
		`[link](https://todoist.com/showTask?id=12345)`,
		`[link](https://Todoist.com/ShowTask?id=12345)`,
		`[link](https://app.todoist.com/app/task/${ID})`,
		`[link](https://app.todoist.com/app/task/buy-milk-${ID})`,
		`[link](https://todoist.com/app/task/12345)`,
		`[link](https://todoist.com/showtask?id=12345)`,
		`[link](todoist://task?id=${ID})`,
	];
	for (const link of links) {
		assert.equal(stripTaskContent(`- [ ] buy milk ${link} #todoist ${META}`), 'buy milk', link);
	}
});

test('strips repeated links and id blocks on one line', () => {
	// Older builds could process a line twice, leaving two of each. A non-global
	// strip kept the second one in the compared text, which read as an edit.
	const link = `[link](https://app.todoist.com/app/task/${ID})`;
	assert.equal(stripTaskContent(`- [ ] buy milk ${link} ${link} #todoist ${META}`), 'buy milk');
	assert.equal(stripTaskContent(`- [ ] buy milk ${link} #todoist ${META} ${META}`), 'buy milk');
	assert.equal(
		stripTaskContent(`- [ ] buy milk [link](https://todoist.com/showtask?id=1) ${link} #todoist ${META}`),
		'buy milk'
	);
});

test('strips a bare task URL written without markdown', () => {
	assert.equal(stripTaskContent(`- [ ] buy milk https://app.todoist.com/app/task/${ID} #todoist ${META}`), 'buy milk');
	assert.equal(stripTaskContent(`- [ ] buy milk todoist://task?id=${ID} #todoist ${META}`), 'buy milk');
});

test('leaves unrelated links and text alone', () => {
	assert.equal(
		stripTaskContent(`- [ ] read [the docs](https://example.com/todoist) #todoist ${META}`),
		'read [the docs](https://example.com/todoist)'
	);
	assert.equal(stripTaskContent('- [ ] buy milk'), 'buy milk');
});

test('strips due date and priority markers', () => {
	assert.equal(stripTaskContent(`- [ ] buy milk 📅 2026-01-01 #todoist ${META}`), 'buy milk');
	assert.equal(stripTaskContent(`- [ ] buy milk !!4 #todoist ${META}`), 'buy milk');
	assert.equal(stripTaskContent(`- [ ] buy milk 🗓️ 2026-01-01 !!2 #todoist ${META}`), 'buy milk');
});

test('is stable when applied twice', () => {
	// Content read back from a line the plugin wrote must equal what it pushed.
	const line = `- [ ] buy milk [link](https://app.todoist.com/app/task/${ID}) #todoist ${META}`;
	const once = stripTaskContent(line);
	assert.equal(stripTaskContent(once), once);
});
