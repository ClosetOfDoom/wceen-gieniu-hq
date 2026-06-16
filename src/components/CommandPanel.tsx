import { COMMANDS, type CommandKey } from '../brain/responses'

interface Props {
  onCommand: (key: CommandKey) => void
  loading: boolean
}

export function CommandPanel({ onCommand, loading }: Props) {
  return (
    <div>
      <div className="panel-label">Commands</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
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
