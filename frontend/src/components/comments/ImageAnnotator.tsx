import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Eraser, Pen, Redo2, Save, Square, Type, Undo2, X } from "lucide-react"

/** All markup is always red — pen strokes, boxes and text. */
export const MARKUP_RED = "#ef4444"

type Mark =
  | { kind: "pen"; width: number; points: { x: number; y: number }[] }
  | { kind: "box"; width: number; x: number; y: number; w: number; h: number }
  | { kind: "text"; size: number; x: number; y: number; text: string }

type Tool = "pen" | "box" | "text"

/** Drawing tool: red pen, red boxes, and placeable red text on a comment image. */
export function ImageAnnotator({ imageUrl, title, saving, onSave, onClose }: {
  imageUrl: string; title: string; saving?: boolean
  onSave: (blob: Blob) => void; onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>("pen")
  const [width, setWidth] = useState(4)
  const [text, setText] = useState("")
  const [boxLabel, setBoxLabel] = useState("")
  const [textSize, setTextSize] = useState(28)
  const [marks, setMarks] = useState<Mark[]>([])
  const [redoStack, setRedoStack] = useState<Mark[]>([])
  const active = useRef<Mark | null>(null)

  const redraw = (all: Mark[]) => {
    const canvas = canvasRef.current, img = imgRef.current; if (!canvas || !img) return
    const ctx = canvas.getContext("2d"); if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const m of all) {
      ctx.strokeStyle = MARKUP_RED; ctx.fillStyle = MARKUP_RED; ctx.lineCap = "round"; ctx.lineJoin = "round"
      if (m.kind === "pen") {
        ctx.lineWidth = m.width; ctx.beginPath()
        m.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
        ctx.stroke()
      } else if (m.kind === "box") {
        ctx.lineWidth = m.width; ctx.strokeRect(m.x, m.y, m.w, m.h)
      } else {
        ctx.font = `700 ${m.size}px system-ui, sans-serif`
        ctx.textBaseline = "top"
        // white halo so red text stays readable on busy screenshots
        ctx.shadowColor = "rgba(255,255,255,0.9)"; ctx.shadowBlur = 4
        ctx.fillText(m.text, m.x, m.y)
        ctx.shadowBlur = 0
      }
    }
  }

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      const canvas = canvasRef.current; if (!canvas) return
      const maxW = Math.min(img.naturalWidth, 1100), scale = maxW / img.naturalWidth
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale)
      redraw([])
    }
    img.src = imageUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl])

  useEffect(() => { redraw(marks) }, [marks]) // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (canvasRef.current!.width / r.width), y: (e.clientY - r.top) * (canvasRef.current!.height / r.height) }
  }
  const commit = (m: Mark) => { setMarks(ms => [...ms, m]); setRedoStack([]) }

  const toolBtn = (t: Tool, Icon: typeof Pen, label: string) => (
    <button onClick={() => setTool(t)} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium ${tool === t ? "border-red-500 bg-red-50 text-red-600" : "text-muted-foreground"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-card p-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">✏️ Attach image with guide — {title}</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-2 text-[11px] text-muted-foreground">All markup is <b className="text-red-500">red</b>: draw freehand, drag a <b>box</b> around the spot, or add <b>text</b>. Saving attaches this image <b>with guide</b> (your red drawing, boxes with text, and text baked in).</p>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          {toolBtn("pen", Pen, "Pen")}
          {toolBtn("box", Square, "Box")}
          {toolBtn("text", Type, "Text")}
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><span className="h-3.5 w-3.5 rounded-full" style={{ background: MARKUP_RED }} /> Red</span>
          <select value={width} onChange={e => setWidth(Number(e.target.value))} className="rounded border bg-background px-1 py-0.5 text-xs">
            <option value={2}>Thin</option><option value={4}>Medium</option><option value={8}>Thick</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => { const s = marks[marks.length - 1]; if (s) { setRedoStack(r => [...r, s]); setMarks(marks.slice(0, -1)) } }}><Undo2 className="h-3 w-3" /> Undo</Button>
          <Button size="sm" variant="outline" onClick={() => { const s = redoStack[redoStack.length - 1]; if (s) { setMarks(m => [...m, s]); setRedoStack(redoStack.slice(0, -1)) } }}><Redo2 className="h-3 w-3" /> Redo</Button>
          <Button size="sm" variant="outline" onClick={() => { setMarks([]); setRedoStack([]) }}><Eraser className="h-3 w-3" /> Clear</Button>
        </div>

        {tool === "box" && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2">
            <Square className="h-3.5 w-3.5 text-red-500" />
            <Input value={boxLabel} onChange={e => setBoxLabel(e.target.value)} placeholder="Box label (optional) — text shown on the box, e.g. Fix this" className="h-8 min-w-[220px] flex-1 bg-white" />
            <span className="text-[11px] text-red-600">Then drag on the image to draw the box ↓</span>
          </div>
        )}

        {tool === "text" && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2">
            <Type className="h-3.5 w-3.5 text-red-500" />
            <Input value={text} onChange={e => setText(e.target.value)} placeholder="Type the label, then click on the image to place it" className="h-8 min-w-[220px] flex-1 bg-white" autoFocus />
            <select value={textSize} onChange={e => setTextSize(Number(e.target.value))} className="rounded border bg-white px-1 py-1 text-xs">
              <option value={20}>Small text</option><option value={28}>Medium text</option><option value={40}>Large text</option>
            </select>
            <span className="text-[11px] text-red-600">{text ? "Now click the image where the text should go ↓" : "Type something first"}</span>
          </div>
        )}

        <canvas ref={canvasRef} className={`w-full rounded-lg border bg-white ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
          onPointerDown={e => {
            const p = pos(e); (e.target as HTMLElement).setPointerCapture(e.pointerId)
            if (tool === "text") {
              if (text.trim()) { commit({ kind: "text", size: textSize, x: p.x, y: p.y, text: text.trim() }); setText("") }
            } else if (tool === "box") {
              active.current = { kind: "box", width, x: p.x, y: p.y, w: 0, h: 0 }
            } else {
              active.current = { kind: "pen", width, points: [p] }
            }
          }}
          onPointerMove={e => {
            if (!active.current) return
            const p = pos(e)
            if (active.current.kind === "pen") active.current.points.push(p)
            else if (active.current.kind === "box") { active.current.w = p.x - active.current.x; active.current.h = p.y - active.current.y }
            redraw([...marks, active.current])
          }}
          onPointerUp={() => {
            if (!active.current) return
            const m = active.current; active.current = null
            if (m.kind === "box" && (Math.abs(m.w) < 4 || Math.abs(m.h) < 4)) { redraw(marks); return }
            if (m.kind === "box" && boxLabel.trim()) {
              const label: Mark = { kind: "text", size: textSize, x: m.w >= 0 ? m.x : m.x + m.w, y: Math.max(0, (m.h >= 0 ? m.y : m.y + m.h) - textSize - 6), text: boxLabel.trim() }
              setMarks(ms => [...ms, m, label]); setRedoStack([]); setBoxLabel("")
              return
            }
            commit(m)
          }} />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="gold" size="sm" disabled={saving} onClick={() => canvasRef.current?.toBlob(b => b && onSave(b), "image/png")}>
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save image with guide"}
          </Button>
        </div>
      </div>
    </div>
  )
}
