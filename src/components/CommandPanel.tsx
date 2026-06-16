import { COMMANDS, type CommandKey } from '../brain/responses'

interface Props {
  onCommand: (key: CommandKey) => void
  loading: boolean
}

export function CommandPanel({ onCommand, loading }: Props) {
  return (
    <div>
      <div
        style={{
          fontSize: '0.7rem',
          color: '#555',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '12px',
        }}
      >
        Commands
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        {COMMANDS.map(cmd => (
          <button
            key={cmd.key}
            className="btn-cmd"
            disabled={loading}
            onClick={() => onCommand(cmd.key)}
          >
            {cmd.label}
          </button>
        ))}
      </div>
    </div>
  )
}
