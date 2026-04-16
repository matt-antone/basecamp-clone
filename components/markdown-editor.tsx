"use client";

import { useRef } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  DiffSourceToggleWrapper,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  toolbarPlugin
} from "@mdxeditor/editor";

type MarkdownEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  placeholder: string;
  overlayContainer?: HTMLElement | null;
};

export default function MarkdownEditor(props: MarkdownEditorProps) {
  const initialMarkdownRef = useRef(props.markdown);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  return (
    <MDXEditor
      markdown={initialMarkdownRef.current}
      onChange={(nextMarkdown) => onChangeRef.current(nextMarkdown)}
      placeholder={props.placeholder}
      overlayContainer={props.overlayContainer ?? undefined}
      className="commentMdxEditor"
      contentEditableClassName="markdownContent"
      plugins={[
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        markdownShortcutPlugin(),
        toolbarPlugin({
          toolbarContents: () => (
            <DiffSourceToggleWrapper>
              <UndoRedo />
              <Separator />
              <BoldItalicUnderlineToggles />
              <CreateLink />
              <Separator />
              <ListsToggle />
              <BlockTypeSelect />
            </DiffSourceToggleWrapper>
          )
        })
      ]}
    />
  );
}
