export function ProgressSteps({ active = 0, steps }: { active?: number; steps: string[] }) {
  return (
    <div className="progress-steps" role="list" aria-label="Progress">
      {steps.map((step, index) => (
        <div key={step} className={`progress-step ${index <= active ? 'step-active' : ''}`} role="listitem" aria-current={index === active ? 'step' : undefined}>
          <span aria-hidden>{index < active ? '✓' : index + 1}</span>
          <small>{step}</small>
        </div>
      ))}
    </div>
  )
}
