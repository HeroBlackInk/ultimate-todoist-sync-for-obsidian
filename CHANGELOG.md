## CHANGELOG

### prelease [1.1.0] - 2023-XX-XX

- New feature
  - add sync from tasks from todoist to obsidian
    - respects due date and time for tasks in the following format: YYYY-MM-DDThh:mm
    - the first bullet point below a task in obsidian will be used as notice for task
  - add new options to configure the behaviour of the plugin to different needs
    - enable / disable the insertion of todoist links
    - use daily notes for new tasks from todoist or use a template note and create a new note for each task
      - this comes with append mode: In daily notes, you can select to append to the note at the end of file or below a specific pattern
    - select a todoist project to pull tasks from
    - remove the tag sign from text and leave the tag name in place
      - this helps, if you use your tag in text like any other word in a sentence
      - the default behaviour is, that tags will be removed entirely from text
      - exceptions from this behaviour can be specified
    - labels are synced from todoist to obsidian
      - can be disabled through settings
- fix various bugs
  - default project now works, also if you rename a project in todoist
  - respect dueDate from obsidian to todoist

### prelease [1.0.38] - 2023-06-09

https://github.com/HeroBlackInk/ultimate-todoist-sync-for-obsidian/releases/tag/v1.0.38-beta

- New feature
    - 1.0.38 beta now supports date formats for tasks.
    - Todoist task link is added.

### prelease [1.0.37] - 2023-06-05

https://github.com/HeroBlackInk/ultimate-todoist-sync-for-obsidian/releases/tag/v1.0.37-beta

- New feature
    - Two-way automatic synchronization, no longer need to manually click the sync button.
    - Full vault sync option, automatically adding `#todoist` to all tasks.
    - Notes/comments one-way synchronization from Todoist to Obsidian.
- Bug fix
    - Fixed the bug of time zone conversion.
    - Removed the "#" from the Todoist label.
    - Update the obsidian link in Todoist after moving or renaming a file.
