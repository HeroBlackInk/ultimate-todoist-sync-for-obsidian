import { App, Modal ,Setting } from "obsidian";

export class SetDefalutProjectInTheFilepathModal extends Modal {
  constructor(app: App) {
    super(app);
    this.open()
  }

  onOpen() {
    console.log('test modal')
    let { contentEl } = this;
    contentEl.setText("Look at me, I'm a modal! 👀");
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}