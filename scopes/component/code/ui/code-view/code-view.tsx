import { H1 } from '@teambit/documenter.ui.heading';
import classNames from 'classnames';
import React, { HTMLAttributes, useMemo } from 'react';
import { CodeSnippet } from '@teambit/documenter.ui.code-snippet';

import styles from './code-view.module.scss';

export type CodeViewProps = {
  fileContent?: string;
  currentFile?: string;
  icon: string;
} & HTMLAttributes<HTMLDivElement>;

export function CodeView({ className, fileContent, currentFile, icon }: CodeViewProps) {
  const title = useMemo(() => currentFile?.split('/').pop(), [currentFile]);
  const lang = useMemo(() => currentFile?.split('.').pop(), [currentFile]);
  if (!fileContent) return null; // is there a state where the is no file content? what should be presented then?
  return (
    <div className={classNames(styles.codeView, className)}>
      <H1 size="sm" className={styles.fileName}>
        {currentFile && <img className={styles.img} src={icon} />}
        <span>{title}</span>
      </H1>
      <CodeSnippet
        className={styles.codeSnippetWrapper}
        frameClass={styles.codeSnippet}
        showLineNumbers
        language={lang}
      >
        {fileContent || ''}
      </CodeSnippet>
    </div>
  );
}
