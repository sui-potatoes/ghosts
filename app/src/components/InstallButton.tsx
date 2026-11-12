import { useInstall } from "../install.ts";

/** "Install app" entry: renders only when the browser offers an install (or on iOS Safari, a hint). */
export function InstallButton({ className = "btn" }: { className?: string }) {
    const install = useInstall();
    if (install.kind === "prompt")
        return (
            <button className={className} onClick={() => void install.install()}>
                Install app
            </button>
        );
    if (install.kind === "ios")
        return <p className="label normal-case text-muted">Install: Share → Add to Home Screen</p>;
    return null;
}
