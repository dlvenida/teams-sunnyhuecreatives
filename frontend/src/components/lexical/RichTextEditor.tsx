import { useEffect } from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { $getRoot, type EditorState, type LexicalEditor } from "lexical"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { ListItemNode, ListNode } from "@lexical/list"
import { LinkNode } from "@lexical/link"

const theme = {
  paragraph: "mb-1",
  text: { bold: "font-bold", italic: "italic" },
}

function onError(error: Error) {
  console.error(error)
}

interface LexicalEditorProps {
  initialValue?: Record<string, unknown> | null
  onChange: (lexical: Record<string, unknown>, plain: string) => void
  placeholder?: string
}

function InitialContentPlugin({ initialValue }: { initialValue?: Record<string, unknown> | null }) {
  useEffect(() => {
    // content loaded via editorState in config
  }, [initialValue])
  return null
}

export function RichTextEditor({ initialValue, onChange, placeholder = "Describe the task..." }: LexicalEditorProps) {
  const initialConfig = {
    namespace: "SHCEditor",
    theme,
    onError,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
    editorState: initialValue
      ? JSON.stringify(initialValue)
      : undefined,
  }

  const handleChange = (editorState: EditorState, _editor: LexicalEditor) => {
    editorState.read(() => {
      const root = $getRoot()
      const plain = root.getTextContent()
      const lexical = editorState.toJSON() as unknown as Record<string, unknown>
      onChange(lexical, plain)
    })
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="lexical-editor relative">
        <RichTextPlugin
          contentEditable={<ContentEditable className="outline-none min-h-[80px]" />}
          placeholder={<span className="absolute top-3 left-3 text-muted-foreground pointer-events-none">{placeholder}</span>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <OnChangePlugin onChange={handleChange} />
        <InitialContentPlugin initialValue={initialValue} />
      </div>
    </LexicalComposer>
  )
}

export function plainTextToLexical(text: string): Record<string, unknown> {
  return {
    root: {
      children: [
        {
          children: [{ detail: 0, format: 0, mode: "normal", style: "", text, type: "text", version: 1 }],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  }
}

export function htmlToPlain(html: string): string {
  const div = document.createElement("div")
  div.innerHTML = html
  return div.textContent || ""
}
