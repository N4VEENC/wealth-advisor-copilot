/**
 * Minimal renderer for the AI's narrative text: splits into paragraphs/lists
 * and renders **bold** spans. Deliberately not a full markdown library —
 * the AI's output here only ever uses these two conventions, and this is
 * just enough to avoid showing literal asterisks to the advisor.
 */
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    )
  )
}

export function NarrativeText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/)

  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground">
      {blocks.map((block, blockIndex) => {
        const lines = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
        const isList = lines.length > 0 && lines.every((line) => /^[*-]\s+/.test(line))

        if (isList) {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.replace(/^[*-]\s+/, ""), `${blockIndex}-${lineIndex}`)}</li>
              ))}
            </ul>
          )
        }

        // The AI occasionally prefixes a block with markdown heading hashes
        // even though the system prompt only asks for plain paragraphs —
        // strip them rather than showing literal "###" to the advisor.
        const heading = lines[0]?.match(/^#{1,6}\s+(.*)$/)
        if (heading && lines.length === 1) {
          return (
            <p key={blockIndex} className="font-semibold text-foreground">
              {renderInline(heading[1], `${blockIndex}`)}
            </p>
          )
        }

        return (
          <p key={blockIndex}>
            {renderInline(lines.join(" ").replace(/^#{1,6}\s+/, ""), `${blockIndex}`)}
          </p>
        )
      })}
    </div>
  )
}
