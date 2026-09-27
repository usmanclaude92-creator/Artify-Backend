/**
 * Phase 3 — TipTap-based rich-text composer for Post/Page bodies. Replaces
 * the plain `<textarea>` that used to be the entire body field even though
 * the storage/rendering layer has stored and rendered real, sanitized HTML
 * since Phase 5 (`server/utils/sanitizeHtml.ts`'s ALLOWED_TAGS list was
 * already written in anticipation of this — see its header comment).
 *
 * The extension set here is deliberately scoped to exactly what
 * sanitizeContentHtml allows: anything this editor can produce survives
 * the server's sanitizer unchanged, and nothing it can't produce needs a
 * tag the sanitizer would strip anyway. No custom marks/nodes beyond
 * TipTap's own StarterKit (which bundles Underline) + Link/Image/Table.
 */
import React, { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  Unlink,
  Image as ImageIcon,
  Table as TableIcon,
  Undo,
  Redo,
} from "lucide-react";
import { mediaApi, type CmsMedia } from "../../lib/api";
import { MediaPickerModal } from "./MediaPickerModal";

const ToolbarButton: React.FC<{ onClick: () => void; active?: boolean; disabled?: boolean; label: string; children: React.ReactNode }> = ({
  onClick,
  active,
  disabled,
  label,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="p-1.5 rounded-md disabled:opacity-40"
    style={active ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
  >
    {children}
  </button>
);

const Toolbar: React.FC<{ editor: Editor }> = ({ editor }) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const insertImage = async (media: CmsMedia) => {
    setPickerOpen(false);
    try {
      const { url } = await mediaApi.getEmbedUrl(media.id);
      editor.chain().focus().setImage({ src: url, alt: media.altText ?? undefined }).run();
    } catch {
      // Embed URL fetch failed (permission/network) — leave the editor state unchanged rather than insert a broken image.
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
      <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="w-3.5 h-3.5" />
      </ToolbarButton>
      <span className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />
      <ToolbarButton
        label="Heading 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <span className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />
      <ToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="w-3.5 h-3.5" />
      </ToolbarButton>
      <span className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />
      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
        <LinkIcon className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Remove link" disabled={!editor.isActive("link")} onClick={() => editor.chain().focus().unsetLink().run()}>
        <Unlink className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Insert image from Media Library" onClick={() => setPickerOpen(true)}>
        <ImageIcon className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="Insert table"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <TableIcon className="w-3.5 h-3.5" />
      </ToolbarButton>
      <span className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />
      <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo className="w-3.5 h-3.5" />
      </ToolbarButton>
      <MediaPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(m) => void insertImage(m)} />
    </div>
  );
};

export const RichTextEditor: React.FC<{ value: string; onChange: (html: string) => void; placeholder?: string }> = ({
  value,
  onChange,
  placeholder,
}) => {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
    ],
    content: value,
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getHTML()),
    editorProps: {
      attributes: {
        class: "rich-text-editor-content px-3 py-2 text-sm focus:outline-none min-h-[240px]",
      },
    },
  });

  // Keep the editor's content in sync when a different post/page is loaded
  // into the same mounted form (edit-modal reopen with a new `post` prop) —
  // TipTap owns its own DOM state and won't pick up a changed `value` prop
  // on its own the way a controlled `<textarea>` would.
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  if (!editor) return null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-app)" }}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
};
