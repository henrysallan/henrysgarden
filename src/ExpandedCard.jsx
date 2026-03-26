import { useEffect, useRef, useState } from 'react'

/* ── Answer text keyed by node ID (questions are in LETTER_TEXT in BranchNetwork) ── */
const ANSWER_TEXT = {
  4:  'Placeholder answer for 1A.',
  5:  'Placeholder answer for 1B.',
  6:  'Placeholder answer for 2C.',
  7:  'Placeholder answer for 2D.',
  8:  'Placeholder answer for 3E.',
  9:  'Placeholder answer for 3F.',
  10: 'Placeholder answer for 1A-1.',
  11: 'Placeholder answer for 1A-2.',
  12: 'Placeholder answer for 1B-1.',
  13: 'Placeholder answer for 1B-2.',
  14: 'Placeholder answer for 2C-1.',
  15: 'Placeholder answer for 2C-2.',
  16: 'Placeholder answer for 2D-1.',
  17: 'Placeholder answer for 2D-2.',
  18: 'Placeholder answer for 3E-1.',
  19: 'Placeholder answer for 3E-2.',
  20: 'Placeholder answer for 3F-1.',
  21: 'Placeholder answer for 3F-2.',
}

const QUESTION_TEXT = {
  4:  'You taught yourself 3D and started a lab while in college in Ohio. How did that self-directed environment shape the way you learn new tools today?',
  5:  "Between 3D modeling, traditional design, and new tools like 'vibecoding,' how do you decide which medium is right for a specific idea?",
  6:  'Where do philosophy and visual design actually intersect in your day-to-day work?',
  7:  'Is there a specific philosophical concept or text that has fundamentally changed the way you approach making things?',
  8:  'How does your creative process shift when moving between freelance work and studio environments like The Collected Works or VM Groupe?',
  9:  'Has transitioning from Ohio to the New York design scene changed the kind of work you want to create?',
  10: "Since you learned by watching YouTube VFX artists, how much of your current workflow involves reverse-engineering other people's techniques versus inventing your own from scratch?",
  11: "How does that realization—that almost any technical skill is figure-out-able—change the scale or ambition of the projects you pitch today?",
  12: "When you build custom code to procedurally animate an idea, how do you know when the code is 'done' and the animation actually feels right?",
  13: "You mentioned using 3D tools for 2D results. Can you share a specific project where using the 'wrong' tool yielded a better aesthetic than the industry standard would have?",
  14: "How do you practically design for 'the humanity of the other' when you are working under the constraints of a fast-paced commercial brief?",
  15: 'You mentioned paying attention to history in your art. Are there specific design movements or historical periods you find yourself in dialogue with right now?',
  16: "What does a 'rich' moment in digital design actually look or feel like to you? Is it about friction, clarity, surprise, or something else?",
  17: 'When a commercial project naturally lacks that philosophical richness, how do you manufacture the drive to see it through to a high standard?',
  18: 'In your personal work, where you have total agency, how do you set constraints for yourself so that you actually finish the project?',
  19: 'When working on a highly guided studio project, where do you find the space to inject your own specific perspective or craft?',
  20: "Do you think being removed from a formal 'design scene' in Ohio allowed you to develop a more idiosyncratic style, free from local industry trends?",
  21: 'Now that you are working in New York, what specific cultural conversations or milieus do you feel your work is actively participating in?',
}

/**
 * ExpandedCard — HTML overlay that expands from the small in-scene popup
 * into a larger card filling a portion of the viewport.
 *
 * Props:
 *   nodeId     – the locked letter node ID (or null when hidden)
 *   onDismiss  – called when the × is clicked (parent triggers growth + cutscene)
 */
export function ExpandedCard({ nodeId, onDismiss }) {
  const [phase, setPhase] = useState('hidden') // hidden | entering | visible | leaving
  const [displayId, setDisplayId] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (nodeId !== null) {
      setDisplayId(nodeId)
      setPhase('entering')
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setPhase('visible'), 20)
    }
  }, [nodeId])

  const handleDismiss = () => {
    setPhase('leaving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setPhase('hidden')
      setDisplayId(null)
      onDismiss?.()
    }, 250) // match CSS transition duration
  }

  if (phase === 'hidden') return null

  const question = QUESTION_TEXT[displayId] || ''
  const answer = ANSWER_TEXT[displayId] || ''
  const isOpen = phase === 'visible'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        pointerEvents: isOpen ? 'auto' : 'none',
        cursor: 'auto',
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.25)',
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 0.25s ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onClick={handleDismiss}
      />

      {/* Card */}
      <div
        style={{
          position: 'relative',
          width: '480px',
          maxWidth: '90vw',
          maxHeight: '70vh',
          background: '#ffffff',
          padding: '40px',
          overflow: 'auto',
          transform: isOpen ? 'scale(1)' : 'scale(0.3)',
          opacity: isOpen ? 1 : 0,
          transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
          transformOrigin: 'center center',
          cursor: 'auto',
        }}
      >
        {/* Close button */}
        <button
          onClick={handleDismiss}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            fontSize: '20px',
            lineHeight: 1,
            cursor: 'pointer',
            color: '#000',
            fontFamily: 'Instrument Serif, serif',
            padding: '4px 8px',
          }}
        >
          ✕
        </button>

        {/* Question */}
        <p
          style={{
            fontFamily: 'Instrument Serif, serif',
            fontSize: '18px',
            lineHeight: 1.5,
            color: '#000',
            margin: 0,
            paddingRight: '24px',
          }}
        >
          {question}
        </p>

        {/* Divider */}
        <hr
          style={{
            border: 'none',
            borderTop: '1px solid #ddd',
            margin: '20px 0',
          }}
        />

        {/* Answer */}
        <p
          style={{
            fontFamily: 'Instrument Serif, serif',
            fontSize: '16px',
            lineHeight: 1.6,
            color: '#333',
            margin: 0,
          }}
        >
          {answer}
        </p>
      </div>
    </div>
  )
}
