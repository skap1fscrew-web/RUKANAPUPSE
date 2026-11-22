import meloryLogo from "./assets/melory-logo.png";
import dropriseLogo from "./assets/droprise-logo.png";

export default function ProjectSwitch({ project, onChange, disabled }) {
  return <div role="group" aria-label="Проект" className="inline-flex h-[42px] shrink-0 items-center gap-1 rounded-xl bg-neutral-200/70 p-1">
    {[["melori", meloryLogo, "Мелори · Одежда"], ["droprise", dropriseLogo, "Droprise · Электроника"]].map(([id, logo, label]) =>
      <button key={id} type="button" title={label} aria-label={label} aria-pressed={project === id} disabled={disabled}
        onClick={() => onChange(id)}
        className={"grid h-[34px] place-items-center overflow-hidden rounded-lg border bg-white transition disabled:opacity-50 " + (id === "melori" ? "w-[88px] " : "w-10 ") + (project === id ? "border-neutral-900 shadow-sm" : "border-transparent opacity-60 hover:opacity-100")}>
        <img src={logo} alt="" className={id === "melori" ? "h-7 w-20 object-cover object-center" : "h-7 w-7 object-contain"} />
      </button>
    )}
  </div>;
}
