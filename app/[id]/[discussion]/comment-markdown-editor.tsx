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

type CommentMarkdownEditorProps = {
  markdown: string;
  onChange: (markdown: string) => void;
  placeholder: string;
};

export default function CommentMarkdownEditor(props: CommentMarkdownEditorProps) {
  return (
    <MDXEditor
      markdown={props.markdown}
      onChange={(nextMarkdown) => props.onChange(nextMarkdown)}
      placeholder={props.placeholder}
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
            <>
              <DiffSourceToggleWrapper>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <CreateLink />
                <Separator />
                <ListsToggle />
                <BlockTypeSelect />
              </DiffSourceToggleWrapper>
            </>
          )
        })
      ]}
    />
  );
}
