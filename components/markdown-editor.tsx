"use client";

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
  return (
    <MDXEditor
      markdown={props.markdown}
      onChange={(nextMarkdown) => props.onChange(nextMarkdown)}
      placeholder={props.placeholder}
      overlayContainer={props.overlayContainer ?? undefined}
      className="commentMdxEditor"
      contentEditableClassName="commentMdxContent"
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
