import { ComponentAspect, ComponentUI } from '@teambit/component';
import { UIRuntime } from '@teambit/ui';
import React, { ComponentType } from 'react';
import { SlotRegistry, Slot } from '@teambit/harmony';
import { CodeAspect } from './code.aspect';
import { CodeSection } from './code.section';
import { CodePage } from './ui/code-tab-page';

export type FileIconMatch = {
  icon: string;
  match: ((file: string) => boolean) | RegExp;
};
export type FileIconSlot = SlotRegistry<FileIconMatch[]>;
export type DrawerSlot = SlotRegistry<ComponentType>;
export class CodeUI {
  constructor(
    /**
     * register an icon for a specific file type. pass icon and a match method/regexp
     */
    private fileIconSlot?: FileIconSlot
  ) {}
  getCodePage = () => {
    return <CodePage fileIconSlot={this.fileIconSlot} />;
  };
  registerEnvFileIcon(icons: FileIconMatch[]) {
    this.fileIconSlot?.register(icons);
    return this;
  }
  static dependencies = [ComponentAspect];

  static runtime = UIRuntime;

  static slots = [Slot.withType<string>()];

  static async provider([component]: [ComponentUI], config, [fileIconSlot]: [FileIconSlot]) {
    const ui = new CodeUI(fileIconSlot);
    const section = new CodeSection(ui);

    // overrides the default tsx react icon with the typescript icon
    ui.registerEnvFileIcon([{ icon: 'https://static.bit.dev/file-icons/file_type_typescript.svg', match: /\.tsx$/ }]);
    component.registerRoute(section.route);
    component.registerWidget(section.navigationLink, section.order);
    return ui;
  }
}

CodeAspect.addRuntime(CodeUI);