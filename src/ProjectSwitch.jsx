export default function ProjectSwitch({ project, onChange, disabled }) {
  return <div role="group" aria-label="Проект" className="inline-flex h-[42px] shrink-0 items-center rounded-xl bg-neutral-200/70 p-1">
    {[["melori", "М", "Мелори · Одежда"], ["droprise", "Д", "Droprise · Электроника"]].map(([id, letter, label]) =>
      <button key={id} type="button" title={label} aria-label={label} aria-pressed={project === id} disabled={disabled}
        onClick={() => onChange(id)} className={"grid h-[34px] w-9 place-items-center rounded-lg text-sm font-semibold transition disabled:opacity-50 " + (project === id ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-white/60 hover:text-neutral-900")}>{letter}</button>
    )}
  </div>;
}
